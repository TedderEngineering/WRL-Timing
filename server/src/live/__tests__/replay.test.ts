import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));
vi.mock("../../middleware/auth.js", async (orig) => ({ ...(await orig<typeof import("../../middleware/auth.js")>()), requireAuth: (_q: unknown, _s: unknown, next: () => void) => next() }));
import { decode, encode } from "@msgpack/msgpack";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fakeHttp } from "../../intake/__tests__/fake-http.js";
import { feedUrls, type FeedLap } from "../feed.js";
import { getLiveSnapshot, liveUrls, resolveLiveSlug, setLiveHttp } from "../poller.js";
import { HOLD_S, REPLAYS, ReplaySource, isReplaySlug, listReplays, setReplayFeed, type ReplayDef, type ReplayStore } from "../replay.js";
import { liveRouter } from "../../routes/live.js";

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8"));
const LAPS = (): FeedLap[] => json("laps.json").laps;

// The synthetic race: green at 23:40 track time, the last lap done at 00:10:40.1 of race time.
const DEF: ReplayDef = { slug: "replay-synthetic-park-2026-saturday-8-hour", source: "synthetic-park-2026-saturday-8-hour", eventId: 9001, fromS: 300 };
const END_S = 640.1;
const CYCLE_S = END_S - DEF.fromS + HOLD_S;
/** A wall clock showing race second r (in run `run`). */
const showing = (r: number, run = 1000) => (run * CYCLE_S + (r - DEF.fromS)) * 1000;

const routes = () => ({
  [feedUrls.sessions(9001)]: JSON.stringify([
    { sid: 6, eid: 9001, n: "Practice 1", st: "2026-05-02T15:00:00", et: "2026-05-02T16:00:00", tz: -6, il: false, pq: true },
    { sid: 7, eid: 9001, n: "Saturday 8 Hour", st: "2026-05-02T23:30:00", et: "2026-05-03T07:45:00", tz: -6, il: false },
  ]),
  [feedUrls.event(9001)]: JSON.stringify({ n: "World Racing League - Synthetic Park 2026", t: "Synthetic Park" }),
  [liveUrls.sessionLaps(9001, 7)]: JSON.stringify(LAPS()),
  [feedUrls.flags(9001, 7)]: JSON.stringify([
    { f: 1, s: "2026-05-02T23:40:00", e: "2026-05-02T23:46:00" },
    { f: 2, s: "2026-05-02T23:46:00", e: "2026-05-02T23:52:00" },
    { f: 5, s: "2026-05-02T23:52:00", e: null },
  ]),
  [feedUrls.control(9001, 7)]: JSON.stringify(json("control.json")),
  [liveUrls.trackMap(9001)]: JSON.stringify(json("sebring-track.json")),
  [liveUrls.state(9001)]: Buffer.from(encode(Object.assign(new Array(36).fill(null), { 2: 7, 13: [["11", "Synthetic Racing", "", "GTO"], ["7", "Example Motorsport", "", "GTU"]] }))),
});

/** A recorder chunk: a start line, two states (race seconds 320 and 330) and the track map. */
function recording(): ReplayStore {
  const car = (n: string, llp: number, lat: number) => Object.assign(new Array(70).fill(null), { 2: n, 4: n === "11" ? "GTO" : "GTU", 15: llp, 20: 1, 21: 1, 47: lat, 48: -81.35, 54: 99 });
  const state = (run: string, cars: unknown[]) => Object.assign(new Array(36).fill(null), { 2: 7, 5: "07:54:00", 6: "23:45:20", 7: run, 13: [["11", "Synthetic Racing", "", "GTO"]], 14: cars, 15: 1 });
  const lines = [
    { t: 1, k: "start", slug: DEF.source, eventId: 9001, sessionId: 7 },
    { t: 2, k: "state", d: state("00:01:00.000", [car("11", 0, 27.45)]) }, // before the replay starts: not kept
    { t: 3, k: "track", d: json("sebring-track.json") },
    { t: 4, k: "hub", m: "ReceiveCarPatches", a: [[]] },
    { t: 5, k: "state", d: state("00:05:20.000", [car("11", 2, 27.451), car("7", 2, 27.452)]) },
    { t: 6, k: "state", d: state("00:05:30.000", [car("11", 3, 27.453), car("7", 2, 27.454)]) },
  ];
  const gz = gzipSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
  const root = `live-recordings/${DEF.source}`;
  return {
    list: async (p) => (p === root ? ["20260502", "notes.txt"] : p === `${root}/20260502` ? ["234500Z-00000.jsonl.gz"] : []),
    download: async (p) => (p === `${root}/20260502/234500Z-00000.jsonl.gz` ? gz : null),
  };
}

describe("live replay source", () => {
  it("plays the race from its laps when there is no recording", async () => {
    let now = showing(400);
    const src = new ReplaySource(DEF, () => fakeHttp(routes()), null, () => now);
    await src.load();
    expect(src.sessionId).toBe(7);
    expect(src.endS).toBe(END_S);
    expect(src.raceSecond()).toBeCloseTo(400, 6);

    // Laps done by 6:40 of race time; flags cut there (the yellow still showing).
    const laps = src.lapsAt(400);
    expect(laps.every((l) => (l.ttm ?? "") <= "00:06:40")).toBe(true);
    expect(laps.map((l) => `${l.n}/${l.llp}`)).toContain("11/2");
    expect(laps.map((l) => `${l.n}/${l.llp}`)).not.toContain("11/3");
    expect(src.flagsAt(400)).toEqual([
      { f: 1, s: "2026-05-02T23:40:00", e: "2026-05-02T23:46:00" },
      { f: 2, s: "2026-05-02T23:46:00", e: null },
    ]);

    // The state: the race clock, the entry list, each car on the map with its last lap.
    const st = decode(src.stateAt(400)) as unknown[];
    expect(st[2]).toBe(7);
    expect(st[7]).toBe("00:06:40.000");
    expect(st[15]).toBe(2);
    expect((st[13] as unknown[]).length).toBe(2);
    const cars = st[14] as unknown[][];
    const c11 = cars.find((c) => c[2] === "11")!;
    expect(c11[15]).toBe(2);
    expect(typeof c11[47]).toBe("number");
    expect(Math.abs((c11[47] as number) - 27.45)).toBeLessThan(0.05);

    // Holds at the finish, then starts again in the next run.
    now = showing(END_S + 60);
    expect(src.raceSecond()).toBe(END_S);
    const run = src.cycle();
    now = showing(DEF.fromS + 1, 1001);
    expect(src.cycle()).toBe(run + 1);
    expect(src.raceSecond()).toBeCloseTo(DEF.fromS + 1, 6);
  });

  it("serves the recorded states, and the laps their cars had done", async () => {
    const now = showing(325);
    const src = new ReplaySource(DEF, () => fakeHttp(routes()), recording(), () => now);
    await src.load();
    const st = decode(src.stateAt(325)) as unknown[];
    expect(st[7]).toBe("00:05:20.000");
    expect(((st[14] as unknown[][])[0] as unknown[])[47]).toBe(27.451);
    // Car 11 had done lap 2 in the recorded state (its lap 3 at 8:40 is not in yet).
    expect(src.lapsAt(325).filter((l) => l.n === "11").map((l) => l.llp)).toEqual([1, 2]);
    expect(src.lapsAt(335).filter((l) => l.n === "11").map((l) => l.llp)).toEqual([1, 2, 3]);
    // The recording's own track map is served.
    const map = await src.client().getJson<{ len: number }>(liveUrls.trackMap(9001));
    expect(map?.len).toBeCloseTo(5734.36, 1);
  });

  it("names replays by their address", () => {
    expect(isReplaySlug("replay-sebring-international-raceway-2026-sunday-7-hour")).toBe(true);
    expect(isReplaySlug("sebring-international-raceway-2026-sunday-7-hour")).toBe(false);
    expect(REPLAYS.every((r) => r.slug === `replay-${r.source}`)).toBe(true);
  });
});

describe("live replay pages", () => {
  afterEach(() => {
    const i = REPLAYS.indexOf(DEF);
    if (i >= 0) REPLAYS.splice(i, 1);
    setReplayFeed(null);
    setLiveHttp(null);
  });

  it("serves a replay like a live race, with no key, and lists it for the admin", async () => {
    REPLAYS.push(DEF);
    const now = showing(400);
    // The live feed is never asked.
    const live = fakeHttp({});
    setLiveHttp(live);
    setReplayFeed(fakeHttp(routes()), null, () => now);

    const ids = await resolveLiveSlug(DEF.slug);
    expect(ids).toEqual({ eventId: 9001, sessionId: 7 });
    const snap = await getLiveSnapshot(ids!.eventId, ids!.sessionId, DEF.slug);
    expect(snap.meta?.sessionName).toBe("Saturday 8 Hour");
    expect(snap.ended).toBe(false);
    expect(snap.chart?.data.maxLap).toBe(3); // car 7's lap 3 at 6:33.5
    expect(snap.chart?.status.flag).toBe("Yellow");
    expect(live.calls.length).toBe(0);
    expect(listReplays().find((r) => r.slug === DEF.slug)).toMatchObject({ ready: true, fromS: 300, endS: END_S });

    const app = express();
    app.use("/api/live", liveRouter);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/live`;
      const head = await fetch(`${base}/${DEF.slug}/head`);
      expect(head.status).toBe(200);
      const body = (await head.json()) as { v: number; live: { sessionName: string } };
      expect(body.v).toBeGreaterThan(0);
      expect(body.live.sessionName).toBe("Saturday 8 Hour");
      // A live race still needs the key.
      expect((await fetch(`${base}/synthetic-park-2026-saturday-8-hour/head`)).status).toBe(401);
    } finally {
      server.close();
    }
  });

  it("starts the race again as a new epoch", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      REPLAYS.push(DEF);
      let now = showing(END_S + 10);
      setLiveHttp(fakeHttp({}));
      setReplayFeed(fakeHttp(routes()), null, () => now);
      const a = await getLiveSnapshot(9001, 7, DEF.slug);
      expect(a.chart?.data.maxLap).toBe(5);
      now = showing(DEF.fromS + 2, 1001);
      await vi.advanceTimersByTimeAsync(5_000);
      const b = await getLiveSnapshot(9001, 7, DEF.slug);
      expect(b.epoch).not.toBe(a.epoch);
      expect(b.v).toBe(1);
      expect(b.chart?.data.maxLap).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

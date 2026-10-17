/**
 * RaceTrace Live: a timed session read while it is still running (synthetic
 * fixtures cut off mid-race; no network).
 */
import { afterEach, describe, expect, it } from "vitest";
import { encode } from "@msgpack/msgpack";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fakeHttp } from "../../intake/__tests__/fake-http.js";
import { feedUrls, type FeedLap } from "../feed.js";
import { buildLiveChart, closeOpenFlags, LiveNoLapsError, resultsFromState, trackLocalNow, type LiveSessionMeta } from "../build.js";
import { getLiveSnapshot, listLiveSessions, liveSlug, liveUrls, setLiveHttp } from "../poller.js";
import { liveRouter } from "../../routes/live.js";

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8"));
const LAPS = (): FeedLap[] => json("laps.json").laps;
/** The race after lap `n`: every car's laps up to n. */
const upTo = (n: number) => LAPS().filter((l) => (l.llp ?? 0) <= n);

const META: LiveSessionMeta = {
  eventId: 9001,
  sessionId: 7,
  slug: "synthetic-park-2026-saturday-8-hour",
  eventName: "Synthetic Park 2026",
  sessionName: "Saturday 8 Hour",
  track: "Synthetic Park",
  tzOffsetHours: -6,
  date: "2026-05-02",
};

/** A msgpack SessionState array (decode-functions.ts field order) with only the fields the chart reads. */
function stateArray(o: { sessionId?: number; tod?: string; run?: string; ttg?: string; flag?: number; entries?: string[][]; positions?: { n: string; c: string; llp: number; ovp: number; clp: number }[] }) {
  const a: unknown[] = new Array(36).fill(null);
  a[0] = 9001;
  a[2] = o.sessionId ?? 7;
  a[5] = o.ttg ?? "07:35:00";
  a[6] = o.tod ?? "00:05:00";
  a[7] = o.run ?? "00:25:00";
  a[13] = o.entries ?? [];
  a[14] = (o.positions ?? []).map((p) => {
    const x: unknown[] = new Array(40).fill(null);
    x[2] = p.n;
    x[4] = p.c;
    x[15] = p.llp;
    x[20] = p.ovp;
    x[21] = p.clp;
    return x;
  });
  a[15] = o.flag ?? 1;
  return a;
}

describe("live build", () => {
  it("throws LiveNoLapsError before the first completed lap", async () => {
    await expect(buildLiveChart({ meta: META, laps: [], results: null, flags: null, control: null })).rejects.toBeInstanceOf(LiveNoLapsError);
  });

  it("builds chart data from the laps so far, with no results, flags or control log", async () => {
    const c = await buildLiveChart({ meta: META, laps: upTo(2), results: null, flags: null, control: null });
    expect(c.data.maxLap).toBe(2);
    expect(Object.keys(c.data.cars).sort()).toEqual(["11", "7"]);
    expect(c.status.leaderLap).toBe(2);
    expect(c.status.warnings.some((w) => /flagsCsv/.test(w))).toBe(true);
    expect(c.race.id).toBe("live-synthetic-park-2026-saturday-8-hour");
    expect(c.race.series).toBe("WRL");
  });

  it("grows as laps complete", async () => {
    const a = await buildLiveChart({ meta: META, laps: upTo(2), results: null, flags: null, control: null });
    const b = await buildLiveChart({ meta: META, laps: upTo(4), results: null, flags: null, control: null });
    expect(b.data.maxLap).toBeGreaterThan(a.data.maxLap);
  });

  it("names cars and orders them from the session state", async () => {
    const st = resultsFromState(
      stateArray({
        entries: [
          ["11", "Synthetic Racing", "Synthetic Racing LLC", "GTO"],
          ["7", "Example Motorsport", "Example", "GTU"],
        ],
        positions: [
          { n: "7", c: "GTU", llp: 3, ovp: 1, clp: 1 },
          { n: "11", c: "GTO", llp: 3, ovp: 2, clp: 1 },
        ],
        flag: 2,
      })
    )!;
    expect(st.sessionId).toBe(7);
    expect(st.currentFlag).toBe(2);
    expect(st.results.eventEntries?.[0]).toEqual({ no: "11", nm: "Synthetic Racing", t: "Synthetic Racing LLC", c: "GTO" });
    const c = await buildLiveChart({ meta: META, laps: upTo(3), results: st.results, flags: null, control: null, currentFlag: st.currentFlag, timeToGo: st.timeToGo });
    expect(c.data.cars["11"].team).toMatch(/Synthetic Racing/);
    expect(c.status.flag).toBe("Yellow");
    expect(c.status.timeToGo).toBe("07:35:00");
  });

  it("ignores cars the feed has not placed yet (-999)", () => {
    const st = resultsFromState(stateArray({ positions: [{ n: "7", c: "GTU", llp: 0, ovp: -999, clp: -999 }] }))!;
    expect(st.results.carPositions).toEqual([]);
    expect(resultsFromState({ not: "a state" })).toBeNull();
  });

  it("runs the flag that is still showing until now", () => {
    const now = Date.parse("2026-05-03T05:55:00Z"); // 23:55 track time (UTC-6)
    expect(trackLocalNow(now, -6)).toBe("2026-05-02T23:55:00");
    const f = closeOpenFlags([{ f: 1, s: "2026-05-02T23:40:00", e: "2026-05-02T23:46:00" }, { f: 2, s: "2026-05-02T23:46:00", e: null }], trackLocalNow(now, -6));
    expect(f[1].e).toBe("2026-05-02T23:55:00");
    expect(f[0].e).toBe("2026-05-02T23:46:00");
  });

  it("reads the open flags into the chart's FCY periods", async () => {
    const now = Date.parse("2026-05-03T05:55:00Z");
    const flags = json("flags.json").map((f: { f: number; s: string; e: string | null }) => (f.f === 5 ? { ...f, f: 2, e: null } : f));
    const c = await buildLiveChart({ meta: META, laps: upTo(5), results: null, flags, control: json("control.json"), now });
    expect(c.status.warnings.some((w) => /flagsCsv/.test(w))).toBe(false);
    expect(c.data.maxLap).toBe(5);
  });
});

describe("live poller and routes", () => {
  afterEach(() => setLiveHttp(null));

  const liveSessions = JSON.stringify([{ sid: 7, eid: 9001, n: "Saturday 8 Hour", st: "2026-05-02T23:40:00", et: null, tz: -6, il: true }]);
  const routes = (laps: FeedLap[]) => ({
    [feedUrls.sessions(9001)]: liveSessions,
    [feedUrls.event(9001)]: JSON.stringify({ n: "World Racing League - Synthetic Park 2026", t: "Synthetic Park" }),
    [liveUrls.state(9001)]: Buffer.from(encode(stateArray({ entries: [["11", "Synthetic Racing", "", "GTO"]], positions: [{ n: "11", c: "GTO", llp: 2, ovp: 1, clp: 1 }] }))),
    [liveUrls.sessionLaps(9001, 7)]: JSON.stringify(laps),
    [feedUrls.flags(9001, 7)]: JSON.stringify([{ f: 1, s: "2026-05-02T23:40:00", e: null }]),
    [feedUrls.control(9001, 7)]: "[]",
    [feedUrls.liveAndRecent()]: JSON.stringify([
      { eid: 9001, oid: 1, en: "World Racing League - Synthetic Park 2026", t: "Synthetic Park", l: true },
      { eid: 9002, oid: 7, en: "Another Club 2026", l: true },
    ]),
  });

  it("waits before the first lap, then serves the chart", async () => {
    const h = fakeHttp(routes([]));
    setLiveHttp(h);
    const a = await getLiveSnapshot(9001, 7, "synthetic-park-2026-saturday-8-hour");
    expect(a.chart).toBeNull();
    expect(a.waiting).toMatch(/first completed lap/);
    expect(a.meta?.eventName).toBe("Synthetic Park 2026");

    const h2 = fakeHttp(routes(upTo(3)));
    setLiveHttp(h2);
    const b = await getLiveSnapshot(9001, 7, "synthetic-park-2026-saturday-8-hour");
    expect(b.chart?.data.maxLap).toBe(3);
    expect(b.chart?.status.flag).toBe("Green");
    expect(b.etag).toMatch(/^"[0-9a-f]{20}"$/);
    // One poller per session: a second viewer does not call the feed again.
    const calls = h2.calls.length;
    await getLiveSnapshot(9001, 7, "synthetic-park-2026-saturday-8-hour");
    expect(h2.calls.length).toBe(calls);
  });

  it("lists only live WRL sessions", async () => {
    setLiveHttp(fakeHttp(routes([])));
    const xs = await listLiveSessions();
    expect(xs).toEqual([{ slug: "synthetic-park-2026-saturday-8-hour", eventId: 9001, sessionId: 7, eventName: "Synthetic Park 2026", sessionName: "Saturday 8 Hour", track: "Synthetic Park", startedAt: "2026-05-02T23:40:00" }]);
  });

  it("GET /api/live/:slug returns chart-data shape, gzip and 304", async () => {
    setLiveHttp(fakeHttp(routes(upTo(4))));
    const app = express();
    app.use("/api/live", liveRouter);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/live`;
      // The list names sessions by slug only.
      const list = await (await fetch(base)).json();
      expect(list).toEqual({ sessions: [{ slug: "synthetic-park-2026-saturday-8-hour", eventName: "Synthetic Park 2026", sessionName: "Saturday 8 Hour", track: "Synthetic Park", startedAt: "2026-05-02T23:40:00" }] });
      const r = await fetch(`${base}/synthetic-park-2026-saturday-8-hour`, { headers: { "accept-encoding": "gzip" } });
      expect(r.status).toBe(200);
      const text = await r.clone().text();
      // The feed's event and session ids, and its name, never reach a viewer.
      expect(text).not.toMatch(/\b9001\b|"eventId"|"sessionId"|red\s*mist/i);
      const body = (await r.json()) as { data: { maxLap: number }; race: { id: string }; live: { status: { leaderLap: number } } };
      expect(body.data.maxLap).toBe(4);
      expect(body.race.id).toBe("live-synthetic-park-2026-saturday-8-hour");
      expect(body.live.status.leaderLap).toBe(4);
      const etag = r.headers.get("etag")!;
      const again = await fetch(`${base}/synthetic-park-2026-saturday-8-hour`, { headers: { "if-none-match": etag } });
      expect(again.status).toBe(304);
      expect((await fetch(`${base}/Bad_Slug`)).status).toBe(400);
      expect((await fetch(`${base}/no-such-race`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe("live slugs", () => {
  it("names a session from its event and session, never its ids", () => {
    expect(liveSlug("Sebring International Raceway 2026", "Saturday 8 Hour")).toBe("sebring-international-raceway-2026-saturday-8-hour");
    expect(liveSlug("Road Atlanta 2026", "GTO/GTU · Sunday 7 Hour!")).toBe("road-atlanta-2026-gto-gtu-sunday-7-hour");
  });
});

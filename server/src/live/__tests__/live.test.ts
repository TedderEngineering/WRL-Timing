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
import { getLiveSnapshot, listLiveSessions, listRecentSessions, liveSlug, liveUrls, resolveLiveSlug, setLiveHttp } from "../poller.js";
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
function stateArray(o: { sessionId?: number; tod?: string; run?: string; ttg?: string; flag?: number; entries?: string[][]; positions?: { n: string; c: string; llp: number; ovp: number; clp: number; lat?: number; lon?: number; mph?: number }[] }) {
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
    if (p.lat !== undefined) {
      x.length = 70;
      x[47] = p.lat;
      x[48] = p.lon ?? null;
      x[54] = p.mph ?? null;
    }
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
    expect(xs).toEqual([
      { slug: "synthetic-park-2026-saturday-8-hour", eventId: 9001, sessionId: 7, eventName: "Synthetic Park 2026", sessionName: "Saturday 8 Hour", track: "Synthetic Park", startedAt: "2026-05-02T23:40:00.000Z", endedAt: null, kind: "race" },
    ]);
  });

  it("leaves out open track time and a practice the feed has marked live for days", async () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString().replace("Z", "");
    setLiveHttp(
      fakeHttp({
        [feedUrls.liveAndRecent()]: JSON.stringify([{ eid: 9004, oid: 1, en: "World Racing League - Synthetic Park 2026", t: "Synthetic Park", l: true }]),
        [feedUrls.sessions(9004)]: JSON.stringify([
          { sid: 95, eid: 9004, n: "Max Track Time", st: iso(now - 50 * 3600_000), et: null, tz: -4, il: true, pq: true },
          { sid: 13, eid: 9004, n: "Race Practice 1", st: iso(now - 40 * 3600_000), et: null, tz: -4, il: true, pq: true },
          { sid: 16, eid: 9004, n: "Race Practice 4", st: iso(now - 600_000), et: null, tz: -4, il: true, pq: true },
        ]),
      })
    );
    expect((await listLiveSessions()).map((s) => s.sessionName)).toEqual(["Race Practice 4"]);
    // Their pages still resolve.
    expect(await resolveLiveSlug("synthetic-park-2026-max-track-time")).toEqual({ eventId: 9004, sessionId: 95 });
  });

  it("GET /api/live/next/:id gives the scheduled session and its event's entry list", async () => {
    const r = routes([]);
    r[feedUrls.liveAndRecent()] = JSON.stringify([{ eid: 9001, oid: 1, en: "World Racing League - Sebring International Raceway 2026", t: "Sebring International Raceway", l: true }]);
    r[liveUrls.state(9001)] = Buffer.from(
      encode(stateArray({ entries: [["119", "AE Victory Racing", "AE Victory Racing", "GTO"], ["38", "Palomar Racing", "", "GP1"], ["2", "ACP - TANGERINE", "ACP - TANGERINE", "GTO"]] }))
    );
    setLiveHttp(fakeHttp(r));
    const app = express();
    app.use("/api/live", liveRouter);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/live/next`;
      const ok = await fetch(`${base}/wrl-2026-sebring-race-2`);
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { session: { sessionName: string; source?: string }; entries: { car: string; team: string; cls: string }[] };
      expect(body.session.sessionName).toBe("Race 2 · 7 Hour");
      expect(body.session).not.toHaveProperty("source");
      expect(body.entries).toEqual([
        { car: "38", team: "Palomar Racing", cls: "GP1" },
        { car: "2", team: "ACP - TANGERINE", cls: "GTO" },
        { car: "119", team: "AE Victory Racing", cls: "GTO" },
      ]);
      expect((await fetch(`${base}/no-such-race`)).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it("lists sessions that ended within two hours, and keeps their addresses working", async () => {
    const ended = new Date(Date.now() - 3600_000).toISOString().replace("Z", "");
    const old = new Date(Date.now() - 5 * 3600_000).toISOString().replace("Z", "");
    const today = new Date().toISOString().slice(0, 10);
    setLiveHttp(
      fakeHttp({
        [feedUrls.liveAndRecent()]: JSON.stringify([{ eid: 9003, oid: 1, en: "World Racing League - Synthetic Park 2026", t: "Synthetic Park", l: false, ed: today }]),
        [feedUrls.sessions(9003)]: JSON.stringify([
          { sid: 4, eid: 9003, n: "GTO/GTU Qualifying", st: old, et: old, tz: -4, il: false, pq: true },
          { sid: 5, eid: 9003, n: "Saturday 8 Hour", st: old, et: ended, tz: -4, il: false, pq: false },
        ]),
      })
    );
    expect(await listLiveSessions()).toEqual([]);
    const recent = await listRecentSessions();
    expect(recent.map((r) => [r.slug, r.kind, r.endedAt])).toEqual([["synthetic-park-2026-saturday-8-hour", "race", `${ended}Z`]]);
    // An older session of the event is no longer "just finished", but its page still resolves.
    expect(await resolveLiveSlug("synthetic-park-2026-gto-gtu-qualifying")).toEqual({ eventId: 9003, sessionId: 4 });
  });

  it("serves the track outline and every car's place on it, without coordinates or ids", async () => {
    const sebring = readFileSync(new URL("./fixtures/sebring-track.json", import.meta.url), "utf8");
    const p0 = (JSON.parse(sebring) as { pts: { lat: number; lon: number }[] }).pts[10];
    const r = routes(upTo(3));
    r[liveUrls.state(9001)] = Buffer.from(encode(stateArray({ entries: [["11", "Synthetic Racing", "", "GTO"]], positions: [{ n: "11", c: "GTO", llp: 2, ovp: 1, clp: 1, lat: p0.lat, lon: p0.lon, mph: 98 }] })));
    r[liveUrls.trackMap(9001)] = sebring;
    setLiveHttp(fakeHttp(r));
    const app = express();
    app.use("/api/live", liveRouter);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/live/synthetic-park-2026-saturday-8-hour`;
      const tr = await fetch(`${base}/track`);
      expect(tr.status).toBe(200);
      const track = (await tr.json()) as { len: number; pts: number[][] };
      expect(track.len).toBeCloseTo(5734.4, 1);
      expect(track.pts.length).toBe(93);
      const pr = await fetch(`${base}/pos`);
      expect(pr.status).toBe(200);
      const text = await pr.text();
      expect(text).not.toMatch(/27\.45|-81\.3|\b9001\b|lat|lon/);
      const pos = JSON.parse(text) as { ageMs: number; cars: [string, number | null, number | null, number][] };
      expect(pos.cars).toHaveLength(1);
      expect(pos.cars[0][0]).toBe("11");
      expect(pos.cars[0][1]).toBeGreaterThan(400);
      expect(pos.cars[0][1]).toBeLessThan(600);
      expect(pos.cars[0][2]).toBe(98);
      expect(pr.headers.get("cdn-cache-control")).toBe("max-age=2");
    } finally {
      server.close();
    }
  });

  it("GET /api/live/:slug returns chart-data shape, gzip and 304", async () => {
    setLiveHttp(fakeHttp(routes(upTo(4))));
    const app = express();
    app.use("/api/live", liveRouter);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/live`;
      // The list names sessions by slug only.
      const list = (await (await fetch(base)).json()) as { sessions: unknown[]; upcoming: unknown; recent: unknown[] };
      expect(list.sessions).toEqual([
        { slug: "synthetic-park-2026-saturday-8-hour", eventName: "Synthetic Park 2026", sessionName: "Saturday 8 Hour", track: "Synthetic Park", startedAt: "2026-05-02T23:40:00.000Z", endedAt: null, kind: "race", status: null },
      ]);
      expect(Array.isArray(list.upcoming)).toBe(true);
      expect(list.recent).toEqual([]);
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

describe("live route, compact format", () => {
  afterEach(() => setLiveHttp(null));

  it("sends a full copy, then nothing new for the same version, brotli-compressed", async () => {
    const liveSessions = JSON.stringify([{ sid: 7, eid: 9001, n: "Saturday 8 Hour", st: "2026-05-02T23:40:00", et: null, tz: -6, il: true }]);
    setLiveHttp(
      fakeHttp({
        [feedUrls.sessions(9001)]: liveSessions,
        [feedUrls.event(9001)]: JSON.stringify({ n: "World Racing League - Synthetic Park 2026", t: "Synthetic Park" }),
        [liveUrls.state(9001)]: Buffer.from(encode(stateArray({ entries: [["11", "Synthetic Racing", "", "GTO"]] }))),
        [liveUrls.sessionLaps(9001, 7)]: JSON.stringify(upTo(4)),
        [feedUrls.flags(9001, 7)]: "[]",
        [feedUrls.control(9001, 7)]: "[]",
        [feedUrls.liveAndRecent()]: JSON.stringify([{ eid: 9001, oid: 1, en: "World Racing League - Synthetic Park 2026", l: true }]),
      })
    );
    const app = express();
    app.use("/api/live", liveRouter);
    const server = app.listen(0);
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/live/synthetic-park-2026-saturday-8-hour`;
      const r = await fetch(`${url}?enc=2&v=0`, { headers: { "accept-encoding": "br" } });
      expect(r.headers.get("content-encoding")).toBe("br");
      const text = await r.clone().text();
      expect(text).not.toMatch(/\b9001\b|"eventId"|"sessionId"|red\s*mist/i);
      const body = (await r.json()) as { v: number; full?: { kind: string; total: number }; delta?: unknown };
      expect(body.v).toBe(1);
      expect(body.full?.kind).toBe("full");
      // Every lap of the chart (the parser drops duplicate feed rows, so not the feed's row count).
      const legacy = (await (await fetch(url)).json()) as { data: { cars: Record<string, { laps: unknown[] }> } };
      expect(body.full?.total).toBe(Object.values(legacy.data.cars).reduce((n, c) => n + c.laps.length, 0));
      const same = (await (await fetch(`${url}?enc=2&v=1`)).json()) as Record<string, unknown>;
      expect(same.v).toBe(1);
      expect(same.full).toBeUndefined();
      expect(same.delta).toBeUndefined();
      expect(same.live).toBeTruthy();
      // An unknown version gets a full copy.
      const old = (await (await fetch(`${url}?enc=2&v=999`)).json()) as Record<string, unknown>;
      expect(old.full).toBeTruthy();
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

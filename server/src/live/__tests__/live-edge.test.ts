/**
 * The edge-cached live routes and push: head, update files, full copies,
 * cache headers, and the Server-Sent Events stream, against a fast-ticking
 * poller on a synthetic feed whose laps grow. No network.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// The sign-in checks have their own tests (key.test.ts); here every request is let through.
vi.mock("../../models/prisma.js", () => ({ prisma: {} }));
vi.mock("../key.js", async (orig) => ({ ...(await orig<typeof import("../key.js")>()), requireLiveKey: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../middleware/auth.js", async (orig) => ({ ...(await orig<typeof import("../../middleware/auth.js")>()), requireAuth: (_q: unknown, _s: unknown, next: () => void) => next() }));

import { readFileSync } from "node:fs";
import { encode } from "@msgpack/msgpack";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { fakeHttp } from "../../intake/__tests__/fake-http.js";
import type { FeedLap } from "../feed.js";

process.env.LIVE_TICK_MS = "40";
process.env.LIVE_LAPS_MS = "1";
process.env.LIVE_SLOW_MS = "100000";

const LAPS: FeedLap[] = JSON.parse(readFileSync(new URL("./fixtures/laps.json", import.meta.url), "utf-8")).laps;

let server: Server;
let base: string;
let setLiveHttp: (h: unknown) => void;
let shown = 2;

beforeAll(async () => {
  const feed = await import("../feed.js");
  const poller = await import("../poller.js");
  const { liveRouter } = await import("../../routes/live.js");
  setLiveHttp = poller.setLiveHttp as (h: unknown) => void;
  const state: unknown[] = new Array(36).fill(null);
  state[2] = 7;
  state[5] = "07:00:00";
  state[6] = "00:05:00";
  state[7] = "00:25:00";
  state[13] = [["11", "Synthetic Racing", "", "GTO"]];
  state[14] = [];
  state[15] = 1;
  poller.setLiveHttp(
    fakeHttp({
      [feed.feedUrls.sessions(9001)]: JSON.stringify([{ sid: 7, eid: 9001, n: "Saturday 8 Hour", st: "2026-05-02T23:40:00", et: null, tz: -6, il: true }]),
      [feed.feedUrls.event(9001)]: JSON.stringify({ n: "World Racing League - Synthetic Park 2026", t: "Synthetic Park" }),
      [poller.liveUrls.state(9001)]: Buffer.from(encode(state)),
      // The race grows one lap per car each time the test moves `shown` on.
      [poller.liveUrls.sessionLaps(9001, 7)]: () => JSON.stringify(LAPS.filter((l) => (l.llp ?? 0) <= shown)),
      [feed.feedUrls.flags(9001, 7)]: "[]",
      [feed.feedUrls.control(9001, 7)]: "[]",
      [feed.feedUrls.liveAndRecent()]: JSON.stringify([{ eid: 9001, oid: 1, en: "World Racing League - Synthetic Park 2026", l: true }]),
    })
  );
  const app = express();
  app.use("/api/live", liveRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/live/synthetic-park-2026-saturday-8-hour`;
});

afterAll(() => {
  server?.close();
  setLiveHttp?.(null);
});

type Head = { epoch: string; v: number; ageMs: number; live: { status?: { leaderLap: number } } };
const head = async () => (await (await fetch(`${base}/head`)).json()) as Head;
async function untilVersion(min: number): Promise<Head> {
  for (let i = 0; i < 100; i++) {
    const h = await head();
    if (h.v >= min) return h;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`never reached version ${min}`);
}

describe("edge-cached live routes", () => {
  it("serves a head the edge may keep 4 s, without the feed's ids", async () => {
    const r = await fetch(`${base}/head`);
    expect(r.headers.get("cdn-cache-control")).toBe("max-age=4");
    const text = await r.text();
    expect(text).not.toMatch(/\b9001\b|"eventId"|"sessionId"|red\s*mist/i);
    const h = JSON.parse(text) as Head;
    expect(h.v).toBeGreaterThan(0);
    expect(h.epoch).toMatch(/^[0-9a-z]+$/);
  });

  it("serves the current version in full, immutable, and refuses an old epoch", async () => {
    const h = await head();
    const r = await fetch(`${base}/full/${h.epoch}/${h.v}`, { headers: { "accept-encoding": "br" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("cdn-cache-control")).toMatch(/immutable/);
    expect(r.headers.get("content-encoding")).toBe("br");
    const body = (await r.json()) as { full: { kind: string; v: number } };
    expect(body.full).toMatchObject({ kind: "full", v: h.v });
    const stale = await fetch(`${base}/full/oldepoch/${h.v}`);
    expect(stale.status).toBe(404);
    expect(stale.headers.get("cdn-cache-control")).toBe("no-store");
  });

  it("serves each step as its own immutable update file", async () => {
    const h1 = await head();
    shown = 4;
    const h2 = await untilVersion(h1.v + 1);
    const r = await fetch(`${base}/d/${h2.epoch}/${h2.v}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toMatch(/immutable/);
    const d = (await r.json()) as { kind: string; base: number; v: number };
    expect(d).toMatchObject({ kind: "delta", base: h2.v - 1, v: h2.v });
    expect((await fetch(`${base}/d/${h2.epoch}/${h2.v + 50}`)).status).toBe(404);
  });

  it("pushes the head on connect and when the chart changes", async () => {
    const ctrl = new AbortController();
    const r = await fetch(`${base}/events`, { signal: ctrl.signal });
    expect(r.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(r.headers.get("cdn-cache-control")).toBe("no-store");
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const heads = () => [...text.matchAll(/event: head\ndata: (.*)\n\n/g)].map((m) => JSON.parse(m[1]) as Head);
    const read = async (until: () => boolean) => {
      for (let i = 0; i < 200 && !until(); i++) text += dec.decode((await reader.read()).value);
    };
    await read(() => heads().length >= 1);
    const first = heads()[0];
    shown = 5;
    await read(() => heads().some((h) => h.v > first.v));
    expect(heads().at(-1)!.v).toBeGreaterThan(first.v);
    ctrl.abort();
  });
});

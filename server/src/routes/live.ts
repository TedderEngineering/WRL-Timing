/**
 * RaceTrace Live (public, no login): WRL sessions still running.
 *
 *   GET /api/live          live WRL sessions right now, by RaceTrace slug
 *   GET /api/live/:slug?enc=2&v=<version the page holds, 0 for none>
 *       { live, v } plus, when the chart changed since `v`:
 *         delta: what changed since `v` (wire.ts), when `v` is still kept, or
 *         full:  the whole chart, compact (wire.ts), otherwise.
 *
 * Edge-cached (every phone asks the same question, so Vercel's CDN answers):
 *   GET /api/live/:slug/head               { epoch, v, ageMs, live }: CDN-cached 4 s
 *   GET /api/live/:slug/d/:epoch/:v        the changes from v − 1 to v: immutable
 *   GET /api/live/:slug/full/:epoch/:v     the whole chart at v (compact): immutable
 *   GET /api/live/:slug/events             push (Server-Sent Events): the head on
 *       every change, a ping every 15 s; capped at LIVE_MAX_STREAMS, after which
 *       phones poll the head instead.
 *
 *   GET /api/live/:slug    (no enc) the chart in the /api/races/:id/chart-data
 *       shape plus `live`, ETag / If-None-Match → 304: pages loaded before
 *       the compact format.
 *
 * Bodies are brotli-compressed when the browser accepts it, else gzip.
 * X-Live-Age-Ms says how old the race clock in `live.status` is.
 *
 * The timing system's event and session ids never leave the server: the slug
 * ("sebring-international-raceway-2026-saturday-8-hour") is the public name.
 */
import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";
import { Router, type Request, type Response } from "express";
import { getLiveSnapshot, listLiveSessions, listRecentSessions, liveStatusOf, publicListing, resolveLiveSlug, subscribeLive } from "../live/poller.js";
import { upcomingSessions } from "../live/schedule.js";
import { encodeDelta, encodeFull } from "../live/wire.js";

export const liveRouter = Router();

/** Bodies under this go uncompressed (not worth it). */
const MIN_COMPRESS = 1024;

/** Send JSON text compressed the best way the browser accepts. */
export function sendJson(req: Request, res: Response, body: string) {
  res.type("application/json");
  res.set("Vary", "Accept-Encoding");
  const accept = String(req.headers["accept-encoding"] ?? "");
  if (body.length < MIN_COMPRESS) {
    res.send(body);
    return;
  }
  if (/\bbr\b/.test(accept)) {
    res.set("Content-Encoding", "br");
    res.send(
      brotliCompressSync(body, {
        params: { [zc.BROTLI_PARAM_QUALITY]: 5, [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_TEXT, [zc.BROTLI_PARAM_SIZE_HINT]: body.length },
      })
    );
    return;
  }
  if (/\bgzip\b/.test(accept)) {
    res.set("Content-Encoding", "gzip");
    res.send(gzipSync(body));
    return;
  }
  res.send(body);
}

/** Compressed bodies of immutable responses (update files, full copies), compressed once for every phone. */
const packed = new Map<string, Buffer>();
const PACKED_MAX = 600;

/** Send immutable JSON, compressing it once per encoding and keeping the bytes. */
function sendPacked(req: Request, res: Response, key: string, body: () => string) {
  const accept = String(req.headers["accept-encoding"] ?? "");
  const encoding = /\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : "identity";
  const k = `${key}|${encoding}`;
  let buf = packed.get(k);
  if (!buf) {
    const text = body();
    buf =
      encoding === "br"
        ? brotliCompressSync(text, { params: { [zc.BROTLI_PARAM_QUALITY]: 9, [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_TEXT, [zc.BROTLI_PARAM_SIZE_HINT]: text.length } })
        : encoding === "gzip"
          ? gzipSync(text, { level: 9 })
          : Buffer.from(text);
    if (packed.size >= PACKED_MAX) packed.delete(packed.keys().next().value as string);
    packed.set(k, buf);
  }
  res.type("application/json");
  res.set("Vary", "Accept-Encoding");
  if (encoding !== "identity") res.set("Content-Encoding", encoding);
  res.send(buf);
}

const IMMUTABLE = "public, max-age=31536000, immutable";
/** Not cached anywhere: errors, misses and anything that changes. */
function noStore(res: Response) {
  res.set("Cache-Control", "no-store");
  res.set("CDN-Cache-Control", "no-store");
}

const SLUG = /^[\p{Ll}\p{N}][\p{Ll}\p{N}-]{0,99}$/u;

/** The session behind a slug, or a 400/404 already sent. */
async function sessionFor(req: Request, res: Response): Promise<{ eventId: number; sessionId: number; slug: string } | null> {
  const slug = String(req.params.slug);
  if (!SLUG.test(slug)) {
    noStore(res);
    res.status(400).json({ error: "Bad live race address", code: "BAD_LIVE_SLUG" });
    return null;
  }
  const ids = await resolveLiveSlug(slug);
  if (!ids) {
    noStore(res);
    res.status(404).json({ error: "No live race at this address", code: "LIVE_NOT_FOUND" });
    return null;
  }
  return { ...ids, slug };
}

type Snap = Awaited<ReturnType<typeof getLiveSnapshot>>;

function liveOf(slug: string, snap: Snap) {
  return {
    slug,
    updatedAt: snap.updatedAt,
    waiting: snap.waiting,
    // The reason stays in the server log: it can name the timing system's ids.
    delayed: !!snap.lastError,
    ended: snap.ended,
    eventName: snap.meta?.eventName ?? null,
    sessionName: snap.meta?.sessionName ?? null,
    track: snap.meta?.track ?? null,
    ...(snap.chart ? { status: snap.chart.status } : {}),
  };
}

/** What every phone polls (or is pushed): the version to be at, and the live status. */
function headOf(slug: string, snap: Snap) {
  return {
    epoch: snap.epoch,
    v: snap.chart ? snap.v : 0,
    // How old the race clock in live.status is now (an edge-cached copy adds its Age header).
    ageMs: snap.updatedAt ? Math.max(0, Date.now() - Date.parse(snap.updatedAt)) : 0,
    live: liveOf(slug, snap),
  };
}

liveRouter.get("/:slug/head", async (req, res, next) => {
  try {
    const s = await sessionFor(req, res);
    if (!s) return;
    const snap = await getLiveSnapshot(s.eventId, s.sessionId, s.slug);
    // The edge keeps it 4 s: however many phones poll, the server sees a request per edge location every 4 s.
    res.set("Cache-Control", "public, max-age=2");
    res.set("CDN-Cache-Control", "max-age=4");
    sendJson(req, res, JSON.stringify(headOf(s.slug, snap)));
  } catch (e) {
    next(e);
  }
});

liveRouter.get("/:slug/d/:epoch/:v", async (req, res, next) => {
  try {
    const s = await sessionFor(req, res);
    if (!s) return;
    const snap = await getLiveSnapshot(s.eventId, s.sessionId, s.slug);
    const v = Number(req.params.v);
    const step = req.params.epoch === snap.epoch ? snap.steps.get(v) : undefined;
    if (!step) {
      noStore(res);
      res.status(404).json({ error: "No such update (ask for a full copy)", code: "LIVE_NO_STEP" });
      return;
    }
    res.set("Cache-Control", IMMUTABLE);
    res.set("CDN-Cache-Control", IMMUTABLE);
    sendPacked(req, res, `d|${s.slug}|${snap.epoch}|${v}`, () => step);
  } catch (e) {
    next(e);
  }
});

liveRouter.get("/:slug/full/:epoch/:v", async (req, res, next) => {
  try {
    const s = await sessionFor(req, res);
    if (!s) return;
    const snap = await getLiveSnapshot(s.eventId, s.sessionId, s.slug);
    const v = Number(req.params.v);
    const chart = req.params.epoch === snap.epoch ? snap.charts.get(v) : undefined;
    if (!chart) {
      noStore(res);
      res.status(404).json({ error: "No such version (read the head again)", code: "LIVE_NO_VERSION" });
      return;
    }
    res.set("Cache-Control", IMMUTABLE);
    res.set("CDN-Cache-Control", IMMUTABLE);
    sendPacked(req, res, `full|${s.slug}|${snap.epoch}|${v}`, () =>
      JSON.stringify({ race: chart.race, full: encodeFull(v, chart.data, chart.annotations) })
    );
  } catch (e) {
    next(e);
  }
});

/** Push streams open across all sessions; beyond this, phones poll the edge-cached head. */
export const MAX_STREAMS = Number(process.env.LIVE_MAX_STREAMS || 400);
let openStreams = 0;

liveRouter.get("/:slug/events", async (req, res, next) => {
  try {
    const s = await sessionFor(req, res);
    if (!s) return;
    noStore(res);
    if (openStreams >= MAX_STREAMS) {
      res.status(503).json({ error: "Busy: polling instead", code: "LIVE_STREAMS_FULL" });
      return;
    }
    openStreams += 1;
    res.status(200);
    res.set({ "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    let last = "";
    const send = async () => {
      const snap = await getLiveSnapshot(s.eventId, s.sessionId, s.slug);
      const head = headOf(s.slug, snap);
      // Same version and status as last sent: nothing to push.
      const key = JSON.stringify({ ...head, ageMs: 0, live: { ...head.live, updatedAt: null } });
      if (key === last) return;
      last = key;
      res.write(`event: head\ndata: ${JSON.stringify(head)}\n\n`);
    };
    await send();
    const unsubscribe = subscribeLive(s.eventId, s.sessionId, s.slug, () => void send().catch(() => undefined));
    const ping = setInterval(() => res.write(`event: ping\ndata: {}\n\n`), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
      openStreams -= 1;
    });
  } catch (e) {
    next(e);
  }
});

/** The compact full chart for the current version of each session, stringified once. */
const fullCache = new Map<string, { v: number; json: string }>();
/** Recent deltas per session ("base>v" → JSON), so viewers on the same version share one. */
const deltaCache = new Map<string, Map<string, string>>();

/**
 * What is on now, coming up and just finished: the site banner (every page, every minute) and
 * /live. Sessions live on the timing feed (with the running poller's lap and flag), sessions from
 * the published schedule starting within a day and a half, and sessions that ended in the last two
 * hours. Cached at the edge like the rest of /api/live.
 */
liveRouter.get("/", async (_req, res, next) => {
  try {
    const [live, recent] = await Promise.all([listLiveSessions(), listRecentSessions()]);
    const sessions = live.map((r) => ({ ...publicListing(r), status: liveStatusOf(r.eventId, r.sessionId) }));
    const upcoming = upcomingSessions(Date.now(), [...live, ...recent]);
    res.set("Cache-Control", "public, max-age=30");
    res.set("CDN-Cache-Control", "max-age=30");
    res.json({ sessions, upcoming, recent: recent.map(publicListing) });
  } catch (e) {
    next(e);
  }
});

liveRouter.get("/:slug", async (req, res, next) => {
  try {
    const slug = String(req.params.slug);
    if (!/^[\p{Ll}\p{N}][\p{Ll}\p{N}-]{0,99}$/u.test(slug)) {
      res.status(400).json({ error: "Bad live race address", code: "BAD_LIVE_SLUG" });
      return;
    }
    const ids = await resolveLiveSlug(slug);
    if (!ids) {
      res.status(404).json({ error: "No live race at this address", code: "LIVE_NOT_FOUND" });
      return;
    }
    const { eventId, sessionId } = ids;
    const snap = await getLiveSnapshot(eventId, sessionId, slug);
    noStore(res);
    const live = {
      slug,
      updatedAt: snap.updatedAt,
      waiting: snap.waiting,
      // The reason stays in the server log: it can name the timing system's ids.
      delayed: !!snap.lastError,
      ended: snap.ended,
      eventName: snap.meta?.eventName ?? null,
      sessionName: snap.meta?.sessionName ?? null,
      track: snap.meta?.track ?? null,
      ...(snap.chart ? { status: snap.chart.status } : {}),
    };
    if (!snap.chart) {
      res.json({ live });
      return;
    }
    // How old the race clock in `status` is, so the page can keep it ticking.
    if (snap.updatedAt) res.set("X-Live-Age-Ms", String(Math.max(0, Date.now() - Date.parse(snap.updatedAt))));

    if (req.query.enc === "2") {
      const have = Number(req.query.v);
      const liveJson = JSON.stringify(live);
      const raceJson = JSON.stringify(snap.chart.race);
      if (have === snap.v) {
        sendJson(req, res, `{"v":${snap.v},"live":${liveJson}}`);
        return;
      }
      const base = Number.isInteger(have) && have > 0 ? snap.versions.get(have) : undefined;
      if (base && snap.prefixes) {
        let byBase = deltaCache.get(slug);
        if (!byBase) deltaCache.set(slug, (byBase = new Map()));
        const key = `${have}>${snap.v}`;
        let json = byBase.get(key);
        if (!json) {
          json = JSON.stringify(encodeDelta(have, base, snap.v, snap.chart.data, snap.chart.annotations, snap.prefixes));
          // Only deltas to the current version are worth keeping.
          for (const k of [...byBase.keys()]) if (!k.endsWith(`>${snap.v}`)) byBase.delete(k);
          if (byBase.size >= 16) byBase.clear();
          byBase.set(key, json);
        }
        sendJson(req, res, `{"v":${snap.v},"race":${raceJson},"live":${liveJson},"delta":${json}}`);
        return;
      }
      let full = fullCache.get(slug);
      if (!full || full.v !== snap.v) {
        full = { v: snap.v, json: JSON.stringify(encodeFull(snap.v, snap.chart.data, snap.chart.annotations)) };
        fullCache.set(slug, full);
      }
      sendJson(req, res, `{"v":${snap.v},"race":${raceJson},"live":${liveJson},"full":${full.json}}`);
      return;
    }

    // Pages loaded before the compact format: the chart-data shape, ETag / 304.
    if (snap.etag) {
      res.set("ETag", snap.etag);
      if (!snap.lastError && req.headers["if-none-match"] === snap.etag) {
        res.status(304).end();
        return;
      }
    }
    sendJson(req, res, JSON.stringify({ race: snap.chart.race, data: snap.chart.data, annotations: snap.chart.annotations, live }));
  } catch (e) {
    next(e);
  }
});

/**
 * RaceTrace Live (public, no login): WRL sessions still running.
 *
 *   GET /api/live          live WRL sessions right now, by RaceTrace slug
 *   GET /api/live/:slug?enc=2&v=<version the page holds, 0 for none>
 *       { live, v } plus, when the chart changed since `v`:
 *         delta: what changed since `v` (wire.ts), when `v` is still kept, or
 *         full:  the whole chart, compact (wire.ts), otherwise.
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
import { getLiveSnapshot, listLiveSessions, publicListing, resolveLiveSlug } from "../live/poller.js";
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

/** The compact full chart for the current version of each session, stringified once. */
const fullCache = new Map<string, { v: number; json: string }>();
/** Recent deltas per session ("base>v" → JSON), so viewers on the same version share one. */
const deltaCache = new Map<string, Map<string, string>>();

liveRouter.get("/", async (_req, res, next) => {
  try {
    const sessions = (await listLiveSessions()).map(publicListing);
    res.set("Cache-Control", "public, max-age=30");
    res.json({ sessions });
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
    res.set("Cache-Control", "no-cache");
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

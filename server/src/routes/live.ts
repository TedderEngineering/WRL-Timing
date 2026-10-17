/**
 * RaceTrace Live (public, no login): WRL sessions still running.
 *
 *   GET /api/live          live WRL sessions right now, by RaceTrace slug
 *   GET /api/live/:slug    the chart so far, in the /api/races/:id/chart-data
 *       shape plus `live` (status, updatedAt, …). ETag / If-None-Match → 304
 *       while nothing changed.
 *
 * The timing system's event and session ids never leave the server: the slug
 * ("sebring-international-raceway-2026-saturday-8-hour") is the public name.
 */
import { gzipSync } from "node:zlib";
import { Router } from "express";
import { getLiveSnapshot, listLiveSessions, publicListing, resolveLiveSlug } from "../live/poller.js";

export const liveRouter = Router();

/** The last gzipped body per session (one build serves every viewer until the next tick). */
const gzCache = new Map<string, { key: string; gz: Buffer }>();

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
    if (snap.etag) {
      res.set("ETag", snap.etag);
      if (!snap.lastError && req.headers["if-none-match"] === snap.etag) {
        res.status(304).end();
        return;
      }
    }
    const body = JSON.stringify({ race: snap.chart.race, data: snap.chart.data, annotations: snap.chart.annotations, live });
    res.type("application/json");
    if (/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
      const id = slug;
      const key = `${snap.etag}|${snap.updatedAt}|${snap.lastError ?? ""}`;
      let hit = gzCache.get(id);
      if (!hit || hit.key !== key) {
        hit = { key, gz: gzipSync(body) };
        gzCache.set(id, hit);
      }
      res.set("Content-Encoding", "gzip");
      res.set("Vary", "Accept-Encoding");
      res.send(hit.gz);
      return;
    }
    res.send(body);
  } catch (e) {
    next(e);
  }
});

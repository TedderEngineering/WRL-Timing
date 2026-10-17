/**
 * RaceTrace Live (public, no login): WRL sessions still running on RedMist.
 *
 *   GET /api/live                               live WRL sessions right now
 *   GET /api/live/redmist/:eventId/:sessionId   the chart so far, in the
 *       /api/races/:id/chart-data shape plus `live` (status, updatedAt, …).
 *       ETag / If-None-Match → 304 while nothing changed.
 */
import { gzipSync } from "node:zlib";
import { Router } from "express";
import { getLiveSnapshot, listLiveSessions } from "../live/poller.js";

export const liveRouter = Router();

/** The last gzipped body per session (one build serves every viewer until the next tick). */
const gzCache = new Map<string, { key: string; gz: Buffer }>();

liveRouter.get("/", async (_req, res, next) => {
  try {
    const sessions = await listLiveSessions();
    res.set("Cache-Control", "public, max-age=30");
    res.json({ sessions });
  } catch (e) {
    next(e);
  }
});

liveRouter.get("/redmist/:eventId/:sessionId", async (req, res, next) => {
  try {
    const eventId = Number(req.params.eventId);
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isInteger(sessionId) || sessionId <= 0) {
      res.status(400).json({ error: "Bad event or session id", code: "BAD_LIVE_ID" });
      return;
    }
    const snap = await getLiveSnapshot(eventId, sessionId);
    res.set("Cache-Control", "no-cache");
    const live = {
      eventId,
      sessionId,
      updatedAt: snap.updatedAt,
      waiting: snap.waiting,
      lastError: snap.lastError,
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
      const id = `${eventId}/${sessionId}`;
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

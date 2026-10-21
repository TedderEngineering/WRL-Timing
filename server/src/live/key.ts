/**
 * The live-timing key: what lets a signed-in viewer read a live race while Vercel's edge still
 * answers most of the requests.
 *
 * Live pages poll the same URLs every few seconds from every phone, and the edge caches those
 * answers (routes/live.ts). A sign-in check per request would bypass that cache. Instead a
 * signed-in viewer asks GET /api/live/key once an hour and adds `k=<key>` to the live URLs: every
 * viewer in that hour shares the key, so the edge still holds one copy per URL, and a request
 * without a valid key gets 401. The key changes every hour; the previous hour's key is still
 * accepted, so a page never fails at the turn of the hour.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

export const LIVE_KEY_PERIOD_MS = 3600_000;

export function liveKeyFor(period: number): string {
  return createHmac("sha256", `live-key:${env.JWT_ACCESS_SECRET}`).update(String(period)).digest("base64url").slice(0, 22);
}

/** The key for now, and when the next one starts. */
export function currentLiveKey(now = Date.now()): { k: string; renewAt: string } {
  const period = Math.floor(now / LIVE_KEY_PERIOD_MS);
  return { k: liveKeyFor(period), renewAt: new Date((period + 1) * LIVE_KEY_PERIOD_MS).toISOString() };
}

/** This hour's key or the last hour's. */
export function liveKeyValid(k: unknown, now = Date.now()): boolean {
  if (typeof k !== "string" || k.length !== 22) return false;
  const period = Math.floor(now / LIVE_KEY_PERIOD_MS);
  const given = Buffer.from(k);
  return [period, period - 1].some((p) => {
    const want = Buffer.from(liveKeyFor(p));
    return want.length === given.length && timingSafeEqual(want, given);
  });
}

/** 401 (never cached) unless the request carries a valid key in `k`. */
export function requireLiveKey(req: Request, res: Response, next: NextFunction): void {
  if (liveKeyValid(req.query.k)) {
    next();
    return;
  }
  res.set("Cache-Control", "no-store");
  res.set("CDN-Cache-Control", "no-store");
  res.status(401).json({ error: "Sign in to watch live timing", code: "LIVE_KEY_REQUIRED" });
}

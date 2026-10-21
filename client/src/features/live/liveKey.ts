/**
 * The live-timing key (server live/key.ts): a signed-in viewer asks for it once an hour and adds
 * `k=` to every live race URL. Every viewer shares the hour's key, so Vercel's edge still answers
 * the polling for everyone; nobody signed out can read a live race.
 */
import { api } from "../../lib/api";

let cached: { k: string; renewAt: number } | null = null;
let pending: Promise<string> | null = null;

/** The hour's key; `fresh` asks again (after a 401). */
export function liveKey(fresh = false): Promise<string> {
  if (!fresh && cached && Date.now() < cached.renewAt) return Promise.resolve(cached.k);
  pending ??= api
    .get<{ k: string; renewAt: string }>("/live/key")
    .then((r) => {
      cached = { k: r.k, renewAt: Date.parse(r.renewAt) || Date.now() + 30 * 60_000 };
      return r.k;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** A live race URL (anything under /live/ but the listing itself) takes the key. */
export function needsLiveKey(path: string): boolean {
  return /^\/live\/[^?]/.test(path);
}

export function withLiveKey(path: string, k: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}k=${encodeURIComponent(k)}`;
}

/** Tests: forget the key. */
export function resetLiveKey(): void {
  cached = null;
  pending = null;
}

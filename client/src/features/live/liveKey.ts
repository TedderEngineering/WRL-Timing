/**
 * The live-timing key (server live/key.ts): a signed-in viewer asks for it once an hour and adds
 * `k=` to every live race URL. Every viewer shares the hour's key, so Vercel's edge still answers
 * the polling for everyone; nobody signed out can read a live race.
 */
import { api } from "../../lib/api";

/**
 * Kept on the device until it turns over (index.html reads it to start a live page's first
 * requests before the app has loaded). It is the hour's shared key, not the viewer's own; signing
 * out forgets it.
 */
export const LIVE_KEY_STORE = "rt.live.key";

function stored(): { k: string; renewAt: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LIVE_KEY_STORE) ?? "null") as { k?: unknown; renewAt?: unknown } | null;
    return v && typeof v.k === "string" && typeof v.renewAt === "number" && Date.now() < v.renewAt ? { k: v.k, renewAt: v.renewAt } : null;
  } catch {
    return null;
  }
}

let cached: { k: string; renewAt: number } | null = typeof localStorage === "undefined" ? null : stored();
let pending: Promise<string> | null = null;

/** The hour's key; `fresh` asks again (after a 401). */
export function liveKey(fresh = false): Promise<string> {
  if (!fresh && cached && Date.now() < cached.renewAt) return Promise.resolve(cached.k);
  pending ??= api
    .get<{ k: string; renewAt: string }>("/live/key")
    .then((r) => {
      cached = { k: r.k, renewAt: Date.parse(r.renewAt) || Date.now() + 30 * 60_000 };
      try {
        localStorage.setItem(LIVE_KEY_STORE, JSON.stringify(cached));
      } catch {
        /* private window: for this visit only */
      }
      return r.k;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** A replay of a finished race (server live/replay.ts): open to everyone, signed in or not. */
export function isReplaySlug(slug: string | undefined | null): boolean {
  return !!slug && slug.startsWith("replay-");
}

/** A live race URL (anything under /live/ but the listing itself and replays) takes the key. */
export function needsLiveKey(path: string): boolean {
  return /^\/live\/(?!replay-)[^?]/.test(path);
}

export function withLiveKey(path: string, k: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}k=${encodeURIComponent(k)}`;
}

/** Forget the key (signing out; tests). */
export function resetLiveKey(): void {
  cached = null;
  pending = null;
  try {
    localStorage.removeItem(LIVE_KEY_STORE);
  } catch {
    /* nothing kept */
  }
}

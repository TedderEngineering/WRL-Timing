import type { LiveListing } from "../features/live/banner";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { applyDelta, applyFull, type WireDelta, type WireFull } from "../features/chart/live-wire";
import { liveKey, needsLiveKey, withLiveKey } from "../features/live/liveKey";

/** How often the page asks the server (the server reads the timing every 5 s too). */
export const LIVE_POLL_MS = 5_000;
/** On data saver or a 2G connection. */
export const LIVE_POLL_SAVER_MS = 30_000;
/** A full copy of the chart this often, whatever the deltas say (insurance). */
export const LIVE_FULL_EVERY_MS = 10 * 60_000;
/** Further behind than this many versions, a full copy is cheaper than the update files. */
export const LIVE_MAX_STEPS = 8;
/** A push stream that says nothing (not even its 15 s ping) for this long is treated as dead. */
const STREAM_SILENT_MS = 40_000;

/** What the server pushes and the edge caches: the version to be at, and the live status. */
interface LiveHead {
  epoch: string;
  v: number;
  ageMs: number;
  live: LiveInfo;
}

/**
 * Where the shared live requests go: the site's own /api, which Vercel's edge caches and
 * forwards to the API. Not the API host itself (VITE_API_URL, used for logins across the sites),
 * which has no CDN in front: requests there would all reach the server.
 */
export const LIVE_API_BASE: string = import.meta.env.VITE_LIVE_API_URL || "/api";

/** A public request without the login, so every phone asks the same question and the CDN can answer. */
export async function getPublic<T>(path: string): Promise<{ body: T; edgeAgeMs: number }> {
  // A live race URL takes the hour's key (signed in only); a 401 means the key turned over.
  const keyed = needsLiveKey(path);
  let res = await fetch(`${LIVE_API_BASE}${keyed ? withLiveKey(path, await liveKey()) : path}`, { credentials: "omit" });
  if (keyed && res.status === 401) res = await fetch(`${LIVE_API_BASE}${withLiveKey(path, await liveKey(true))}`, { credentials: "omit" });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  // A copy the edge has held adds its Age (seconds) to how old the race clock is.
  const age = Number(res.headers.get("Age"));
  return { body: (await res.json()) as T, edgeAgeMs: Number.isFinite(age) && age > 0 ? age * 1000 : 0 };
}

interface NetworkInformationLike extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
}

function connection(): NetworkInformationLike | null {
  return (typeof navigator !== "undefined" && (navigator as Navigator & { connection?: NetworkInformationLike }).connection) || null;
}

/** Data saver on, or a 2G connection: check every 30 s instead of 5 s. */
export function savingData(c: NetworkInformationLike | null = connection()): boolean {
  return !!c && (c.saveData === true || c.effectiveType === "2g" || c.effectiveType === "slow-2g");
}

export interface LiveStatus {
  leaderLap: number;
  carCount: number;
  flag: string | null;
  runningRaceTime: string | null;
  timeToGo: string | null;
  warnings: string[];
}

export interface LiveInfo {
  /** RaceTrace's name for the session (the page address). */
  slug: string;
  updatedAt: string | null;
  waiting: string | null;
  /** The server could not read the timing on its last try (it keeps the last good chart). */
  delayed: boolean;
  ended: boolean;
  eventName: string | null;
  sessionName: string | null;
  track: string | null;
  status?: LiveStatus;
}

export interface LiveRaceMeta {
  id: string;
  name: string;
  date: string;
  track: string;
  series: string;
  season: number;
}

interface LiveResponse {
  v?: number;
  race?: LiveRaceMeta;
  full?: WireFull;
  delta?: WireDelta;
  live: LiveInfo;
}

export interface UseLiveChartData {
  data: RaceChartData | null;
  annotations: AnnotationData | null;
  race: LiveRaceMeta | null;
  live: LiveInfo | null;
  /** When this page last heard from the server (ms). */
  checkedAt: number | null;
  /** When (this device's clock, ms) the race time and time to go in `live.status` were true. */
  clockAt: number | null;
  error: string | null;
  isLoading: boolean;
  /** Checking every 30 s because the phone is saving data. */
  saver: boolean;
  /** Updates arrive by push (not polling). */
  streaming: boolean;
  refresh: () => void;
}

/**
 * The live chart for a session (by slug), refreshed every LIVE_POLL_MS while the page is visible
 * (LIVE_POLL_SAVER_MS when saving data). Each request names the chart version the page holds; the
 * server answers with nothing new, only what changed (a delta), or a full copy.
 */
export function useLiveChartData(slug: string | undefined): UseLiveChartData {
  const [data, setData] = useState<RaceChartData | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationData | null>(null);
  const [race, setRace] = useState<LiveRaceMeta | null>(null);
  const [live, setLive] = useState<LiveInfo | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [clockAt, setClockAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saver, setSaver] = useState(() => savingData());
  const inFlight = useRef(false);
  /** The chart this page holds (epoch and version, and the objects deltas apply to). */
  const held = useRef<{ epoch: string; v: number; data: RaceChartData | null; annotations: AnnotationData | null; fullAt: number }>({
    epoch: "",
    v: 0,
    data: null,
    annotations: null,
    fullAt: 0,
  });
  /** "edge": head + update files (pushed or polled). "legacy": the per-phone request, if the edge routes are missing. */
  const mode = useRef<"edge" | "legacy">("edge");
  const edgeFailures = useRef(0);
  /** The push stream is up and talking (polling then stops). */
  const [streaming, setStreaming] = useState(false);
  const latestHead = useRef<LiveHead | null>(null);
  /** A head arrived while an update was being fetched. */
  const pendingHead = useRef(false);

  const show = useCallback((next: { data: RaceChartData; annotations: AnnotationData }, v: number, epoch: string, raceMeta?: LiveRaceMeta) => {
    held.current = { ...held.current, epoch, v, data: next.data, annotations: next.annotations };
    setData(next.data);
    setAnnotations(next.annotations);
    if (raceMeta) setRace(raceMeta);
  }, []);

  /** Bring the chart to the head's version: update files when a few behind, a full copy otherwise. */
  const sync = useCallback(
    async (head: LiveHead, edgeAgeMs: number) => {
      if (!slug) return;
      setCheckedAt(Date.now());
      setError(null);
      setClockAt(Date.now() - head.ageMs - edgeAgeMs);
      setLive(head.live);
      latestHead.current = head;
      if (!head.v) {
        setIsLoading(false); // no lap yet: the page shows "waiting"
        return;
      }
      if (inFlight.current) {
        pendingHead.current = true; // caught up once the current fetch ends
        return;
      }
      const h = held.current;
      if (h.epoch === head.epoch && h.v === head.v) return;
      inFlight.current = true;
      const base = `/live/${encodeURIComponent(slug)}`;
      try {
        const behind = head.v - h.v;
        const stepsOk = h.epoch === head.epoch && !!h.data && !!h.annotations && behind > 0 && behind <= LIVE_MAX_STEPS && Date.now() - h.fullAt < LIVE_FULL_EVERY_MS;
        if (stepsOk) {
          let cur = { data: h.data!, annotations: h.annotations! };
          let ok = true;
          for (let v = h.v + 1; v <= head.v && ok; v++) {
            try {
              const { body } = await getPublic<WireDelta>(`${base}/d/${head.epoch}/${v}`);
              const next = applyDelta(cur.data, cur.annotations, body);
              if (next) cur = next;
              else ok = false;
            } catch {
              ok = false;
            }
          }
          if (ok) {
            show(cur, head.v, head.epoch);
            return;
          }
        }
        const { body } = await getPublic<{ race: LiveRaceMeta; full: WireFull }>(`${base}/full/${head.epoch}/${head.v}`);
        const next = applyFull(body.full);
        held.current.fullAt = Date.now();
        show(next, head.v, head.epoch, body.race);
      } catch (e) {
        // The version just went (a 4 s old head): the next head brings a newer one.
        if ((e as { status?: number }).status !== 404) setError(e instanceof Error ? e.message : "Could not reach RaceTrace");
      } finally {
        inFlight.current = false;
        setIsLoading(false);
        if (pendingHead.current && latestHead.current) {
          pendingHead.current = false;
          const latest = latestHead.current;
          setTimeout(() => void syncRef.current?.(latest, 0), 0);
        }
      }
    },
    [slug, show]
  );
  const syncRef = useRef<typeof sync | null>(null);
  syncRef.current = sync;

  /** The per-phone request (before the edge routes): used only if the head is missing. */
  const loadLegacy = useCallback(async () => {
    if (!slug || inFlight.current) return;
    inFlight.current = true;
    let again = false;
    try {
      const h = held.current;
      const v = h.data && Date.now() - h.fullAt < LIVE_FULL_EVERY_MS ? h.v : 0;
      const res = await api.fetchResponse(`/live/${encodeURIComponent(slug)}?enc=2&v=${v}`);
      setCheckedAt(Date.now());
      setError(null);
      const body = (await res.json()) as LiveResponse;
      const age = Number(res.headers.get("X-Live-Age-Ms"));
      setClockAt(Date.now() - (Number.isFinite(age) && age >= 0 ? age : 0));
      setLive(body.live);
      let next: { data: RaceChartData; annotations: AnnotationData } | null = null;
      if (body.full) {
        next = applyFull(body.full);
        held.current.fullAt = Date.now();
      } else if (body.delta && h.data && h.annotations) {
        next = applyDelta(h.data, h.annotations, body.delta);
        // A delta that does not fit: ask again for a full copy at once.
        if (!next) {
          held.current = { ...h, v: 0, fullAt: 0 };
          again = true;
        }
      }
      if (next && typeof body.v === "number") show(next, body.v, "", body.race);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach RaceTrace");
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
    if (again) void loadLegacy();
  }, [slug, show]);

  /** One poll: the edge-cached head, or the per-phone request in legacy mode. */
  const load = useCallback(async () => {
    if (!slug) return;
    if (mode.current === "legacy") return loadLegacy();
    try {
      const { body, edgeAgeMs } = await getPublic<LiveHead>(`/live/${encodeURIComponent(slug)}/head`);
      edgeFailures.current = 0;
      await sync(body, edgeAgeMs);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404 && !latestHead.current) {
        // No head route on this server (or no such race): try the per-phone request.
        mode.current = "legacy";
        return loadLegacy();
      }
      if (++edgeFailures.current >= 3) mode.current = "legacy";
      setError(e instanceof Error ? e.message : "Could not reach RaceTrace");
      setIsLoading(false);
    }
  }, [slug, sync, loadLegacy]);

  // Data saver can change while the page is open.
  useEffect(() => {
    const c = connection();
    if (!c) return;
    const onChange = () => setSaver(savingData(c));
    c.addEventListener("change", onChange);
    return () => c.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    held.current = { epoch: "", v: 0, data: null, annotations: null, fullAt: 0 };
    mode.current = "edge";
    edgeFailures.current = 0;
    latestHead.current = null;
    setData(null);
    setRace(null);
    setLive(null);
    setIsLoading(true);
    void load();
  }, [load]);

  // Push: the server sends the head whenever the chart or the status changes. If the stream
  // cannot open, goes quiet or keeps failing, the page polls instead (and retries push later).
  useEffect(() => {
    if (!slug || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let lastMessage = 0;
    let errors = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    // The page left while the key was on its way: open nothing.
    let closed = false;
    const stop = (retryInMs: number | null) => {
      es?.close();
      es = null;
      setStreaming(false);
      if (watchdog) clearInterval(watchdog);
      watchdog = null;
      if (retryInMs !== null && !closed) retry = setTimeout(() => void open(), retryInMs);
    };
    const open = async () => {
      if (mode.current === "legacy") return;
      errors = 0;
      const path = `/live/${encodeURIComponent(slug)}/events`;
      let k: string | null = null;
      if (needsLiveKey(path)) {
        try {
          k = await liveKey();
        } catch {
          stop(15_000); // no key yet (signed out, offline): polling carries on, the stream tries again
          return;
        }
      }
      if (closed) return;
      es = new EventSource(`${LIVE_API_BASE}${k === null ? path : withLiveKey(path, k)}`);
      lastMessage = Date.now();
      es.addEventListener("head", (ev) => {
        lastMessage = Date.now();
        errors = 0;
        setStreaming(true);
        try {
          void sync(JSON.parse((ev as MessageEvent).data) as LiveHead, 0);
        } catch {
          // a bad message: the next one, or polling, catches up
        }
      });
      es.addEventListener("ping", () => {
        lastMessage = Date.now();
      });
      es.onerror = () => {
        setStreaming(false);
        // The browser reconnects by itself; after a few failures in a row, poll and try again in 5 min.
        if (++errors >= 3) stop(5 * 60_000);
      };
      watchdog = setInterval(() => {
        if (Date.now() - lastMessage > STREAM_SILENT_MS) stop(60_000);
      }, 5_000);
    };
    void open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      stop(null);
    };
  }, [slug, sync]);

  // Polling while push is not working (and in legacy mode).
  useEffect(() => {
    if (streaming) return;
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, saver ? LIVE_POLL_SAVER_MS : LIVE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, saver, streaming]);

  return { data, annotations, race, live, checkedAt, clockAt, error, isLoading, saver: saver && !streaming, streaming, refresh: () => void load() };
}

export type { LiveListed as LiveSessionListing, LiveListing, UpcomingListed } from "../features/live/banner";

/** What is live, coming up and just finished: through the edge, without the login (every page asks). */
export async function fetchLiveListing(): Promise<LiveListing> {
  return (await getPublic<LiveListing>("/live")).body;
}

export function fetchLiveSessions() {
  return fetchLiveListing();
}

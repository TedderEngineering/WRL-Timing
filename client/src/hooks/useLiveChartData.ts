import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { applyDelta, applyFull, type WireDelta, type WireFull } from "../features/chart/live-wire";

/** How often the page asks the server (the server reads the timing every 5 s too). */
export const LIVE_POLL_MS = 5_000;
/** On data saver or a 2G connection. */
export const LIVE_POLL_SAVER_MS = 30_000;
/** A full copy of the chart this often, whatever the deltas say (insurance). */
export const LIVE_FULL_EVERY_MS = 10 * 60_000;

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
  /** The chart this page holds (version, and the objects deltas apply to). */
  const held = useRef<{ v: number; data: RaceChartData | null; annotations: AnnotationData | null; fullAt: number }>({ v: 0, data: null, annotations: null, fullAt: 0 });

  const load = useCallback(async () => {
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
          held.current = { v: 0, data: h.data, annotations: h.annotations, fullAt: 0 };
          again = true;
        }
      }
      if (next && typeof body.v === "number") {
        held.current = { ...held.current, v: body.v, data: next.data, annotations: next.annotations };
        setData(next.data);
        setAnnotations(next.annotations);
        if (body.race) setRace(body.race);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach RaceTrace");
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
    if (again) void load();
  }, [slug]);

  // Data saver can change while the page is open.
  useEffect(() => {
    const c = connection();
    if (!c) return;
    const onChange = () => setSaver(savingData(c));
    c.addEventListener("change", onChange);
    return () => c.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    held.current = { v: 0, data: null, annotations: null, fullAt: 0 };
    setData(null);
    setRace(null);
    setLive(null);
    setIsLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
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
  }, [load, saver]);

  return { data, annotations, race, live, checkedAt, clockAt, error, isLoading, saver, refresh: () => void load() };
}

export interface LiveSessionListing {
  slug: string;
  eventName: string;
  sessionName: string;
  track: string;
  startedAt: string | null;
}

export function fetchLiveSessions() {
  return api.get<{ sessions: LiveSessionListing[] }>("/live");
}

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { AnnotationData, RaceChartData } from "@shared/types";

/** How often the page asks the server (the server reads RedMist on its own clock). */
export const LIVE_POLL_MS = 30_000;

export interface LiveStatus {
  leaderLap: number;
  carCount: number;
  flag: string | null;
  runningRaceTime: string | null;
  timeToGo: string | null;
  warnings: string[];
}

export interface LiveInfo {
  eventId: number;
  sessionId: number;
  updatedAt: string | null;
  waiting: string | null;
  lastError: string | null;
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
  race?: LiveRaceMeta;
  data?: RaceChartData;
  annotations?: AnnotationData;
  live: LiveInfo;
}

export interface UseLiveChartData {
  data: RaceChartData | null;
  annotations: AnnotationData | null;
  race: LiveRaceMeta | null;
  live: LiveInfo | null;
  /** When this page last heard from the server (ms). */
  checkedAt: number | null;
  error: string | null;
  isLoading: boolean;
  refresh: () => void;
}

/** The live chart for a RedMist session, refreshed every LIVE_POLL_MS while the page is visible. */
export function useLiveChartData(eventId: string | undefined, sessionId: string | undefined): UseLiveChartData {
  const [data, setData] = useState<RaceChartData | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationData | null>(null);
  const [race, setRace] = useState<LiveRaceMeta | null>(null);
  const [live, setLive] = useState<LiveInfo | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const etag = useRef<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!eventId || !sessionId || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await api.fetchResponse(`/live/redmist/${eventId}/${sessionId}`, {
        headers: etag.current ? { "If-None-Match": etag.current } : {},
      });
      setCheckedAt(Date.now());
      setError(null);
      if (res.status === 304) return;
      etag.current = res.headers.get("ETag");
      const body = (await res.json()) as LiveResponse;
      setLive(body.live);
      if (body.data && body.race) {
        setData(body.data);
        setAnnotations(body.annotations ?? ({} as AnnotationData));
        setRace(body.race);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach RaceTrace");
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, [eventId, sessionId]);

  useEffect(() => {
    etag.current = null;
    setData(null);
    setRace(null);
    setLive(null);
    setIsLoading(true);
    void load();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, LIVE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return { data, annotations, race, live, checkedAt, error, isLoading, refresh: () => void load() };
}

export interface LiveSessionListing {
  eventId: number;
  sessionId: number;
  eventName: string;
  sessionName: string;
  track: string;
  startedAt: string | null;
}

export function fetchLiveSessions() {
  return api.get<{ sessions: LiveSessionListing[] }>("/live");
}

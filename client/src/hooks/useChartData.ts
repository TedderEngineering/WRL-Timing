import { useState, useEffect, useRef } from "react";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../features/auth/AuthContext";
import type { ChartDataResponse, RaceChartData, AnnotationData } from "@shared/types";

export interface ChartDataError {
  message: string;
  code?: string;
  status?: number;
}

interface UseChartDataResult {
  data: RaceChartData | null;
  annotations: AnnotationData | null;
  raceMeta: ChartDataResponse["race"] | null;
  isLoading: boolean;
  error: ChartDataError | null;
}

export function useChartData(raceId: string | undefined): UseChartDataResult {
  const { isLoading: authLoading } = useAuth();
  const [data, setData] = useState<RaceChartData | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationData | null>(null);
  const [raceMeta, setRaceMeta] = useState<ChartDataResponse["race"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ChartDataError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Track which raceId the current data belongs to, so we never return
  // stale data from a previous race during the gap between id change
  // and effect execution.
  const [fetchedId, setFetchedId] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Wait for auth to resolve so the request carries the token
    if (authLoading) return;

    if (!raceId) {
      setIsLoading(false);
      setError({ message: "No race ID provided" });
      setFetchedId(undefined);
      return;
    }

    // Cancel previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setData(null);
    setAnnotations(null);
    setRaceMeta(null);
    setFetchedId(undefined);

    api
      .get<ChartDataResponse>(`/races/${raceId}/chart-data`, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setData(response.data as unknown as RaceChartData);
        setAnnotations((response.annotations || {}) as unknown as AnnotationData);
        setRaceMeta(response.race);
        setFetchedId(raceId);
        setIsLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiClientError) {
          setError({ message: err.message, code: err.code, status: err.status });
        } else {
          setError({ message: err.message || "Failed to load chart data" });
        }
        setFetchedId(raceId);
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [raceId, authLoading]);

  // If raceId changed but the effect hasn't run yet, the stored data
  // belongs to a previous race. Return null to prevent stale-data
  // consumption (e.g. chart init using wrong car numbers).
  const isStale = raceId !== fetchedId;

  return {
    data: isStale ? null : data,
    annotations: isStale ? null : annotations,
    raceMeta: isStale ? null : raceMeta,
    isLoading: authLoading || isLoading || isStale,
    error: isStale ? null : error,
  };
}

// ─── Race list fetching ──────────────────────────────────────────────────────

export interface RaceListItem {
  id: string;
  name: string;
  date: string;
  track: string;
  series: string;
  season: number;
  status: string;
  premium: boolean;
  maxLap: number | null;
  totalCars: number | null;
  entryCount: number;
  favoriteCount: number;
  isFavorited: boolean;
  accessibleToFree?: boolean;
  createdAt: string;
}

interface RaceListResult {
  races: RaceListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface FilterOptions {
  series: string[];
  tracks: string[];
  seasons: number[];
}

export function useRaceList(params: {
  page?: number;
  series?: string;
  track?: string;
  season?: number;
  search?: string;
}) {
  const [result, setResult] = useState<RaceListResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.series) query.set("series", params.series);
    if (params.track) query.set("track", params.track);
    if (params.season) query.set("season", String(params.season));
    if (params.search) query.set("search", params.search);

    api
      .get<RaceListResult>(`/races?${query}`)
      .then((data) => {
        setResult(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load races");
        setIsLoading(false);
      });
  }, [params.page, params.series, params.track, params.season, params.search]);

  return { result, isLoading, error };
}

export function useFilterOptions() {
  const [filters, setFilters] = useState<FilterOptions | null>(null);

  useEffect(() => {
    api.get<FilterOptions>("/races/filters").then(setFilters).catch(() => {});
  }, []);

  return filters;
}

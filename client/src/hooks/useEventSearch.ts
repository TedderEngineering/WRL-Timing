import { useState, useEffect, useRef } from "react";
import type { SearchResult } from "@shared/types";
import { searchEvents } from "../lib/api";

interface SearchFilters {
  series?: string;
  season?: string;
}

interface UseEventSearchReturn {
  results: SearchResult[] | null;
  freeAccessRaceIds: string[];
  isSearching: boolean;
}

/**
 * Debounced event search hook.
 * Returns null results when query is empty (signals "show default grid").
 * Min 2 chars before triggering search. 300ms debounce. AbortController cancellation.
 */
export function useEventSearch(
  query: string,
  filters: SearchFilters = {},
): UseEventSearchReturn {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [freeAccessRaceIds, setFreeAccessRaceIds] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();

    // Search mode only activates with 2+ character query
    if (q.length < 2) {
      abortRef.current?.abort();
      setResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    const timer = setTimeout(async () => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const data = await searchEvents(
        { q, series: filters.series, season: filters.season },
        controller.signal,
      );

      // Only update if this request wasn't aborted
      if (!controller.signal.aborted) {
        setResults(data.events);
        setFreeAccessRaceIds(data.freeAccessRaceIds);
        setIsSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [query, filters.series, filters.season]);

  return { results, freeAccessRaceIds, isSearching };
}

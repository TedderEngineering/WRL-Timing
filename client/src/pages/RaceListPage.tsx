import { useState, useEffect, useMemo } from "react";
import { fetchEvents } from "../lib/api";
import { EventCard } from "../components/EventCard";
import { SearchBar } from "../components/SearchBar";
import { useEventSearch } from "../hooks/useEventSearch";
import { useFilterOptions } from "../hooks/useChartData";
import { useAuth } from "../features/auth/AuthContext";
import { hasFullAccess } from "../lib/utils";
import { SeriesBadge } from "../components/SeriesBadge";
import type { EventSummary } from "@shared/types";

const FALLBACK_SERIES = ["IMSA", "SRO", "WRL"];

type SortKey = "date-desc" | "date-asc" | "track-az";

export function RaceListPage() {
  const { user } = useAuth();
  const fullAccess = hasFullAccess(user);

  const [searchQuery, setSearchQuery] = useState("");
  const [seriesFilters, setSeriesFilters] = useState<Set<string> | null>(null);
  const [seasonFilter, setSeasonFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("date-desc");

  // Default event list (cached -- not refetched on search clear)
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [freeAccessRaceIds, setFreeAccessRaceIds] = useState<string[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const filters = useFilterOptions();

  // Build the canonical series list from DB + fallbacks
  const allSeries = useMemo(() => {
    const dbSeries = filters?.sanctioningBodies ?? [];
    const merged = new Set([...FALLBACK_SERIES, ...dbSeries]);
    return Array.from(merged);
  }, [filters]);

  // Initialize series filters once allSeries is known
  if (seriesFilters === null && allSeries.length > 0) {
    setSeriesFilters(new Set(allSeries));
  }
  const activeFilters = seriesFilters ?? new Set(allSeries);

  const allSelected = activeFilters.size >= allSeries.length;

  // Derive a single series string for the API (or undefined if multi/all)
  const seriesParam = activeFilters.size === 1 ? [...activeFilters][0] : undefined;

  // Fetch default events on mount and when filters change
  useEffect(() => {
    setEventsLoading(true);
    setEventsError(null);
    fetchEvents({
      series: allSelected ? undefined : seriesParam,
      season: seasonFilter || undefined,
    })
      .then((data) => {
        setFreeAccessRaceIds(data.freeAccessRaceIds);
        const eventsList = data.events;
        // Client-side multi-series filter when not all selected and more than one
        if (!allSelected && activeFilters.size > 1) {
          setEvents(eventsList.filter((ev) => activeFilters.has(ev.series)));
        } else if (!allSelected && activeFilters.size === 0) {
          setEvents([]);
        } else {
          setEvents(eventsList);
        }
      })
      .catch(() => setEventsError("Failed to load events"))
      .finally(() => setEventsLoading(false));
  }, [seriesParam, activeFilters.size, seasonFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side sort
  const sortedEvents = useMemo(() => {
    const sorted = [...events];
    switch (sortBy) {
      case "date-asc":
        sorted.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        break;
      case "track-az":
        sorted.sort((a, b) => a.track.localeCompare(b.track));
        break;
      case "date-desc":
      default:
        sorted.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
        break;
    }
    return sorted;
  }, [events, sortBy]);

  // Compute per-event accessibility
  const freeSet = useMemo(() => new Set(freeAccessRaceIds), [freeAccessRaceIds]);

  const isEventAccessible = (ev: EventSummary): boolean => {
    if (fullAccess) return true;
    if (!ev.raceIds || ev.raceIds.length === 0) return false;
    return ev.raceIds.some((id) => freeSet.has(id));
  };

  // Live search (debounced, abortable)
  const {
    results: searchResults,
    freeAccessRaceIds: searchFreeIds,
    isSearching,
  } = useEventSearch(searchQuery, {
    series: seriesParam,
    season: seasonFilter || undefined,
  });

  const searchFreeSet = useMemo(() => new Set(searchFreeIds), [searchFreeIds]);

  const isSearchMode = searchResults !== null;

  // Filter search results client-side for multi-series
  const filteredSearchResults =
    searchResults && !allSelected && activeFilters.size > 0
      ? searchResults.filter((sr) => activeFilters.has(sr.series))
      : searchResults;

  const isSearchEventAccessible = (ev: EventSummary): boolean => {
    if (fullAccess) return true;
    // Search results include races directly — check race IDs
    const raceIds = ev.raceIds ?? (ev as any).races?.map((r: any) => r.id) ?? [];
    return raceIds.some((id: string) => searchFreeSet.has(id));
  };

  const toggleSeries = (s: string) => {
    setSeriesFilters((prev) => {
      const next = new Set(prev ?? allSeries);
      if (next.has(s)) {
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  };

  const hasActiveFilters = !allSelected || seasonFilter !== "" || searchQuery !== "";

  const clearFilters = () => {
    setSeriesFilters(new Set(allSeries));
    setSeasonFilter("");
    setSearchQuery("");
  };

  return (
    <div className="container-page py-8 lg:py-12">
      {/* Header + summary stats */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">Events</h1>
          <p className="mt-1 text-gray-500 dark:text-gray-400 text-sm">
            Browse race events and charts.
          </p>
        </div>
        {!eventsLoading && events.length > 0 && (
          <div className="flex gap-3">
            {[
              { label: "Total events", value: events.length },
            ].map((s) => (
              <div
                key={s.label}
                className="text-right px-3.5 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]"
              >
                <div className="text-lg font-bold text-gray-900 dark:text-white">{s.value}</div>
                <div className="text-[11px] text-gray-400 dark:text-white/35 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Search bar */}
      <SearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        isSearching={isSearching}
        className="mb-4"
      />

      {/* Filter + sort bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        {/* Series filter chips */}
        <div className="flex gap-2 flex-wrap">
          {allSeries.map((s) => {
            const active = activeFilters.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleSeries(s)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all duration-150 cursor-pointer"
                style={{
                  borderColor: active ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)",
                  background: active ? "rgba(255,255,255,0.06)" : "transparent",
                }}
              >
                <SeriesBadge series={s} size="sm" />
              </button>
            );
          })}
        </div>

        {/* Sort + season controls */}
        <div className="flex gap-2 items-center">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
          >
            <option value="date-desc">Date: Newest first</option>
            <option value="date-asc">Date: Oldest first</option>
            <option value="track-az">Track: A-Z</option>
          </select>

          {filters && filters.seasons.length > 0 && (
            <select
              value={seasonFilter}
              onChange={(e) => setSeasonFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
            >
              <option value="">All Seasons</option>
              {filters.seasons.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Active filters summary */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 mb-4 text-sm text-gray-500 dark:text-gray-400">
          <span>
            Showing {isSearchMode ? (filteredSearchResults?.length ?? 0) : sortedEvents.length} of {events.length} events
          </span>
          <button
            onClick={clearFilters}
            className="text-brand-500 dark:text-brand-400 hover:text-brand-400 dark:hover:text-brand-300 transition-colors"
          >
            Clear filters ×
          </button>
        </div>
      )}

      {/* Search results mode */}
      {isSearchMode && (
        <>
          {isSearching ? (
            <SkeletonGrid />
          ) : !filteredSearchResults || filteredSearchResults.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-lg text-gray-500 dark:text-gray-400">
                No events match &ldquo;{searchQuery}&rdquo;
              </p>
              <button
                onClick={() => setSearchQuery("")}
                className="mt-2 text-brand-600 hover:underline text-sm"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredSearchResults.map((sr) => (
                <div key={sr.id} className="relative">
                  <EventCard
                    event={sr}
                    searchRaces={sr.races}
                    matchedOn={sr.matchedOn}
                    accessible={isSearchEventAccessible(sr)}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Default event grid */}
      {!isSearchMode && (
        <>
          {eventsLoading && <SkeletonGrid />}
          {eventsError && (
            <div className="text-center py-20 text-red-500">{eventsError}</div>
          )}
          {!eventsLoading && !eventsError && sortedEvents.length === 0 && (
            <div className="text-center py-20">
              <p className="text-lg text-gray-500 dark:text-gray-400">No events found.</p>
            </div>
          )}
          {!eventsLoading && sortedEvents.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sortedEvents.map((ev) => (
                <div key={ev.id} className="relative">
                  <EventCard
                    event={ev}
                    accessible={isEventAccessible(ev)}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- Skeleton grid ----

function SkeletonGrid() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="rounded-xl bg-gray-900 border border-gray-800 p-5 space-y-3">
          <div className="flex justify-between">
            <div className="h-5 w-14 bg-gray-800 rounded-full animate-pulse" />
            <div className="h-4 w-24 bg-gray-800 rounded animate-pulse" />
          </div>
          <div className="h-6 w-3/4 bg-gray-800 rounded animate-pulse" />
          <div className="h-4 w-1/3 bg-gray-800/60 rounded animate-pulse ml-auto" />
        </div>
      ))}
    </div>
  );
}

import { useState, useEffect } from "react";
import { fetchEvents } from "../lib/api";
import { EventCard } from "../components/EventCard";
import { SearchBar } from "../components/SearchBar";
import { useEventSearch } from "../hooks/useEventSearch";
import { useFilterOptions } from "../hooks/useChartData";
import { SERIES_COLORS } from "../lib/series-colors";
import type { EventSummary } from "@shared/types";


export function RaceListPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [seriesFilters, setSeriesFilters] = useState<Set<string>>(
    () => new Set(Object.keys(SERIES_COLORS)),
  );
  const [seasonFilter, setSeasonFilter] = useState("");

  // Default event list (cached — not refetched on search clear)
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const filters = useFilterOptions();

  const allSeries = Object.keys(SERIES_COLORS);
  const allSelected = seriesFilters.size === allSeries.length;

  // Derive a single series string for the API (or undefined if multi/all)
  const seriesParam = seriesFilters.size === 1 ? [...seriesFilters][0] : undefined;

  // Fetch default events on mount and when filters change
  useEffect(() => {
    setEventsLoading(true);
    setEventsError(null);
    fetchEvents({
      series: allSelected ? undefined : seriesParam,
      season: seasonFilter || undefined,
    })
      .then((data) => {
        // Client-side multi-series filter when not all selected and more than one
        if (!allSelected && seriesFilters.size > 1) {
          setEvents(data.filter((ev) => seriesFilters.has(ev.series.toUpperCase())));
        } else if (!allSelected && seriesFilters.size === 0) {
          setEvents([]);
        } else {
          setEvents(data);
        }
      })
      .catch(() => setEventsError("Failed to load events"))
      .finally(() => setEventsLoading(false));
  }, [seriesParam, seriesFilters.size, seasonFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live search (debounced, abortable)
  const { results: searchResults, isSearching } = useEventSearch(searchQuery, {
    series: seriesParam,
    season: seasonFilter || undefined,
  });

  const isSearchMode = searchResults !== null;

  // Filter search results client-side for multi-series
  const filteredSearchResults =
    searchResults && !allSelected && seriesFilters.size > 0
      ? searchResults.filter((sr) => seriesFilters.has(sr.series.toUpperCase()))
      : searchResults;

  // Series filter pills
  const seriesList = allSeries;

  const toggleSeries = (s: string) => {
    setSeriesFilters((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  };

  return (
    <div className="container-page py-8 lg:py-12">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50">Events</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Browse race events and charts.
        </p>
      </div>

      {/* Search bar */}
      <SearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        isSearching={isSearching}
        className="mb-4"
      />

      {/* Filter row: series pills + season dropdown */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {seriesList.map((s) => {
          const active = seriesFilters.has(s);
          const col = SERIES_COLORS[s]?.bg ?? "#4B5563";
          return (
            <button
              key={s}
              onClick={() => toggleSeries(s)}
              className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border transition-all duration-150 cursor-pointer"
              style={{
                borderColor: active ? col : "#4B5563",
                background: active ? `${col}33` : "transparent",
                color: active ? col : "#9CA3AF",
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.borderColor = "#9CA3AF";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.borderColor = "#4B5563";
              }}
            >
              {s}
            </button>
          );
        })}

        {/* Season dropdown */}
        {filters && filters.seasons.length > 0 && (
          <select
            value={seasonFilter}
            onChange={(e) => setSeasonFilter(e.target.value)}
            className="ml-auto px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-sm text-gray-300"
          >
            <option value="">All Seasons</option>
            {filters.seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Search results mode ── */}
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
            <>
              <p className="text-sm text-gray-500 mb-4">
                Found {filteredSearchResults.length} event{filteredSearchResults.length !== 1 ? "s" : ""} matching &ldquo;{searchQuery}&rdquo;
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSearchResults.map((sr) => (
                  <EventCard
                    key={sr.id}
                    event={sr}
                    searchRaces={sr.races}
                    matchedOn={sr.matchedOn}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Default event grid ── */}
      {!isSearchMode && (
        <>
          {eventsLoading && <SkeletonGrid />}
          {eventsError && (
            <div className="text-center py-20 text-red-500">{eventsError}</div>
          )}
          {!eventsLoading && !eventsError && events.length === 0 && (
            <div className="text-center py-20">
              <p className="text-lg text-gray-500 dark:text-gray-400">No events found.</p>
            </div>
          )}
          {!eventsLoading && events.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {events.map((ev) => (
                <EventCard key={ev.id} event={ev} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Skeleton grid ──────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

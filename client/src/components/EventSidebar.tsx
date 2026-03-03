import { useState, useEffect, useCallback } from "react";
import type { EventSummary, EventWithRaces } from "@shared/types";
import { fetchEvents, fetchEvent } from "../lib/api";
import { cn } from "../lib/utils";

interface EventSidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onSelectRace: (raceId: string) => void;
  selectedRaceId: string | null;
}

function SeriesBadge({ series }: { series: string }) {
  const s = series.toUpperCase();
  const isImsa = s.includes("IMSA");
  const isWrl = s.includes("WRL");
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold rounded-full leading-none shrink-0",
        isImsa && "bg-blue-600/20 text-blue-400",
        isWrl && "bg-green-600/20 text-green-400",
        !isImsa && !isWrl && "bg-gray-600/20 text-gray-400"
      )}
    >
      {isImsa ? "IMSA" : isWrl ? "WRL" : s.slice(0, 4)}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-3 space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-4 bg-gray-800 rounded animate-pulse w-3/4" />
          <div className="h-3 bg-gray-800/60 rounded animate-pulse w-1/2" />
        </div>
      ))}
    </div>
  );
}

export default function EventSidebar({
  isCollapsed,
  onToggle,
  onSelectRace,
  selectedRaceId,
}: EventSidebarProps) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Event detail cache: eventId → full event with races
  const [eventCache, setEventCache] = useState<Record<string, EventWithRaces>>({});
  const [loadingEventId, setLoadingEventId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEvents();
      setEvents(data);
    } catch {
      setError("Failed to load events");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleEvent = useCallback(
    async (eventId: string) => {
      if (expandedId === eventId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(eventId);

      // Fetch detail if not cached
      if (!eventCache[eventId]) {
        setLoadingEventId(eventId);
        try {
          const detail = await fetchEvent(eventId);
          setEventCache((prev) => ({ ...prev, [eventId]: detail }));
          // Auto-select if only one race
          if (detail.races.length === 1) {
            onSelectRace(detail.races[0].id);
          }
        } catch {
          // leave cache empty — user can retry by collapsing/expanding
        } finally {
          setLoadingEventId(null);
        }
      } else {
        const cached = eventCache[eventId];
        if (cached.races.length === 1) {
          onSelectRace(cached.races[0].id);
        }
      }
    },
    [expandedId, eventCache, onSelectRace]
  );

  // Group events by season
  const bySeason: Record<string, EventSummary[]> = {};
  for (const ev of events) {
    (bySeason[ev.season] ??= []).push(ev);
  }
  const seasons = Object.keys(bySeason).sort((a, b) => b.localeCompare(a));

  return (
    <aside
      className={cn(
        "h-[calc(100vh-4rem)] bg-gray-900 border-r border-gray-800 flex flex-col transition-[width] duration-200 ease-in-out overflow-hidden",
        isCollapsed ? "w-14" : "w-[280px]"
      )}
    >
      {/* Toggle button */}
      <div className="flex items-center justify-end px-2 py-2 border-b border-gray-800">
        <button
          onClick={onToggle}
          className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg
            className={cn(
              "h-5 w-5 transition-transform duration-200",
              isCollapsed && "rotate-180"
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {isCollapsed ? (
          <CollapsedIcons
            events={events}
            selectedRaceId={selectedRaceId}
            eventCache={eventCache}
            onClickEvent={(id) => {
              onToggle(); // expand sidebar
              toggleEvent(id);
            }}
          />
        ) : loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="p-3 text-sm">
            <p className="text-red-400 mb-2">{error}</p>
            <button
              onClick={load}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Retry
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="p-3 text-sm text-gray-500">No events available</div>
        ) : (
          <div className="py-1">
            {seasons.map((season) => (
              <div key={season}>
                <div className="px-3 pt-3 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  {season}
                </div>
                {bySeason[season].map((ev) => {
                  const isExpanded = expandedId === ev.id;
                  const detail = eventCache[ev.id];
                  const isLoadingDetail = loadingEventId === ev.id;

                  return (
                    <div key={ev.id}>
                      {/* Event header */}
                      <button
                        onClick={() => toggleEvent(ev.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/60 transition-colors"
                      >
                        <svg
                          className={cn(
                            "h-3.5 w-3.5 text-gray-500 shrink-0 transition-transform duration-150",
                            isExpanded && "rotate-90"
                          )}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <SeriesBadge series={ev.series} />
                        <span className="text-sm text-gray-200 truncate flex-1">
                          {ev.name}
                        </span>
                        <span className="text-[10px] text-gray-500 shrink-0">
                          {ev.raceCount}
                        </span>
                      </button>

                      {/* Expanded race list */}
                      {isExpanded && (
                        <div className="pb-1">
                          {isLoadingDetail ? (
                            <div className="flex items-center gap-2 px-8 py-2">
                              <div className="h-3 w-3 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
                              <span className="text-xs text-gray-500">Loading...</span>
                            </div>
                          ) : detail ? (
                            detail.races.map((race) => {
                              const isActive = selectedRaceId === race.id;
                              const d = new Date(race.date);
                              const dateStr = d.toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              });
                              return (
                                <button
                                  key={race.id}
                                  onClick={() => onSelectRace(race.id)}
                                  className={cn(
                                    "w-full flex items-center gap-2 pl-10 pr-3 h-9 text-left transition-colors",
                                    isActive
                                      ? "bg-gray-800/50 border-l-2 border-blue-500"
                                      : "hover:bg-gray-800/40 border-l-2 border-transparent"
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "text-sm truncate flex-1",
                                      isActive ? "text-gray-100" : "text-gray-400"
                                    )}
                                  >
                                    {race.name}
                                  </span>
                                  <span className="text-[10px] text-gray-600 shrink-0">
                                    {dateStr}
                                  </span>
                                </button>
                              );
                            })
                          ) : (
                            <div className="px-8 py-2 text-xs text-gray-500">
                              Failed to load races
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Collapsed sidebar icons (placeholder, filled in Prompt 11) ──────────────

function CollapsedIcons({
  events: _events,
  selectedRaceId: _selectedRaceId,
  eventCache: _eventCache,
  onClickEvent: _onClickEvent,
}: {
  events: EventSummary[];
  selectedRaceId: string | null;
  eventCache: Record<string, EventWithRaces>;
  onClickEvent: (eventId: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-3">
      {/* Filled in Prompt 11 */}
    </div>
  );
}

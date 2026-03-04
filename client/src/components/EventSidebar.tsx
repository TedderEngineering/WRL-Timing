import { useState, useEffect, useCallback } from "react";
import type { EventSummary, EventWithRaces } from "@shared/types";
import { fetchEvents, fetchEvent } from "../lib/api";
import { cn } from "../lib/utils";
import { getSeriesColor } from "../lib/series-colors";

interface EventSidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onSelectRace: (raceId: string) => void;
  selectedRaceId: string | null;
  /** Auto-expand this event on mount (from URL ?event= param) */
  initialEventId?: string;
  /** Mobile drawer mode */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

function SeriesBadge({ series }: { series: string }) {
  const { bg, label } = getSeriesColor(series);
  return (
    <span
      className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold rounded-full leading-none shrink-0"
      style={{ backgroundColor: `${bg}33`, color: bg }}
    >
      {label}
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
  initialEventId,
  mobileOpen,
  onMobileClose,
}: EventSidebarProps) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(initialEventId ?? null);

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

  // Auto-expand initialEventId when events finish loading
  useEffect(() => {
    if (!initialEventId || loading || eventCache[initialEventId]) return;
    setExpandedId(initialEventId);
    setLoadingEventId(initialEventId);
    fetchEvent(initialEventId)
      .then((detail) => {
        setEventCache((prev) => ({ ...prev, [initialEventId]: detail }));
      })
      .catch(() => {})
      .finally(() => setLoadingEventId(null));
  }, [initialEventId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Wrap onSelectRace to auto-close mobile drawer
  const handleSelectRace = useCallback(
    (raceId: string) => {
      onSelectRace(raceId);
      onMobileClose?.();
    },
    [onSelectRace, onMobileClose]
  );

  // ── Shared content rendered inside both desktop aside and mobile drawer ──
  const expandedContent = (
    <>
      {loading ? (
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
                                onClick={() => handleSelectRace(race.id)}
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
    </>
  );

  return (
    <>
      {/* ── Desktop sidebar (md and above) ── */}
      <aside
        className={cn(
          "hidden md:flex h-[calc(100vh-4rem)] bg-gray-900 border-r border-gray-800 flex-col transition-[width] duration-200 ease-in-out overflow-hidden",
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

        <div className="flex-1 overflow-y-auto">
          {isCollapsed ? (
            <CollapsedIcons
              events={events}
              selectedRaceId={selectedRaceId}
              eventCache={eventCache}
              onClickEvent={(id) => {
                onToggle();
                toggleEvent(id);
              }}
            />
          ) : (
            expandedContent
          )}
        </div>
      </aside>

      {/* ── Mobile drawer (below md) ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={onMobileClose}
          />
          {/* Drawer panel */}
          <aside className="absolute inset-y-0 left-0 w-[85vw] max-w-[320px] bg-gray-900 border-r border-gray-800 flex flex-col animate-slide-in-left">
            {/* Header with close button */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
              <span className="text-sm font-semibold text-gray-200">Events</span>
              <button
                onClick={onMobileClose}
                className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
                aria-label="Close sidebar"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {expandedContent}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

// ─── Collapsed sidebar icons ────────────────────────────────────────────────

function CollapsedIcons({
  events,
  selectedRaceId,
  eventCache,
  onClickEvent,
}: {
  events: EventSummary[];
  selectedRaceId: string | null;
  eventCache: Record<string, EventWithRaces>;
  onClickEvent: (eventId: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-3 overflow-y-auto">
      {events.map((ev) => {
        const { bg, label } = getSeriesColor(ev.series);

        // Check if this event contains the selected race
        const detail = eventCache[ev.id];
        const hasActive =
          !!selectedRaceId &&
          !!detail?.races.some((r) => r.id === selectedRaceId);

        return (
          <div key={ev.id} className="relative group">
            <button
              onClick={() => onClickEvent(ev.id)}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-[10px] font-bold transition-colors shrink-0 hover:brightness-125"
              style={{ backgroundColor: `${bg}33`, color: bg }}
            >
              {label}
            </button>

            {/* Active dot */}
            {hasActive && (
              <span className="absolute -right-0.5 top-1 w-2 h-2 rounded-full bg-blue-500" />
            )}

            {/* Tooltip */}
            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              {ev.name}
              <span className="text-gray-500 ml-1">({ev.raceCount})</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

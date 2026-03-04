import { useState, useEffect, useCallback } from "react";
import type { EventWithRaces } from "@shared/types";
import { fetchEvent } from "../lib/api";
import { cn } from "../lib/utils";
import { getSeriesColor } from "../lib/series-colors";

interface EventSidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onSelectRace: (raceId: string) => void;
  selectedRaceId: string | null;
  /** The single event to display — sidebar fetches this event's races */
  selectedEventId?: string;
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
  selectedEventId,
  mobileOpen,
  onMobileClose,
}: EventSidebarProps) {
  const [eventData, setEventData] = useState<EventWithRaces | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the single event when selectedEventId changes
  useEffect(() => {
    if (!selectedEventId) {
      setEventData(null);
      return;
    }

    // Skip refetch if we already have this event
    if (eventData?.id === selectedEventId) return;

    setLoading(true);
    setError(null);
    fetchEvent(selectedEventId)
      .then((detail) => {
        setEventData(detail);
        // Auto-select if only one race and none selected
        if (detail.races.length === 1 && !selectedRaceId) {
          onSelectRace(detail.races[0].id);
        }
      })
      .catch(() => setError("Failed to load event"))
      .finally(() => setLoading(false));
  }, [selectedEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wrap onSelectRace to auto-close mobile drawer
  const handleSelectRace = useCallback(
    (raceId: string) => {
      onSelectRace(raceId);
      onMobileClose?.();
    },
    [onSelectRace, onMobileClose],
  );

  const dateRange = eventData
    ? formatDateRange(eventData.startDate, eventData.endDate)
    : "";

  // ── Expanded sidebar content ──
  const sidebarContent = (
    <>
      {/* Collapse button at top */}
      <div className="flex items-center justify-end px-2 py-2 border-b border-gray-800">
        <button
          onClick={onToggle}
          className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          aria-label="Collapse sidebar"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scroll">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="p-3 text-sm">
            <p className="text-red-400 mb-2">{error}</p>
          </div>
        ) : !eventData ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-xs text-gray-600 text-center">
              Select an event to see its races
            </p>
          </div>
        ) : (
          <>
            {/* Event header */}
            <div className="px-3 pt-3 pb-2 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-gray-100 leading-snug">
                {eventData.track}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <SeriesBadge series={eventData.series} />
                <span className="text-[11px] text-gray-500">{dateRange}</span>
              </div>
            </div>

            {/* Flat race list */}
            <div className="py-1">
              {eventData.races.map((race) => {
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
                      "w-full flex items-center gap-2 px-3 h-9 text-left transition-colors",
                      isActive
                        ? "bg-gray-800/50 border-l-2 border-blue-500"
                        : "hover:bg-gray-800/40 border-l-2 border-transparent",
                    )}
                  >
                    <span
                      className={cn(
                        "text-sm truncate flex-1",
                        isActive ? "text-gray-100" : "text-gray-400",
                      )}
                    >
                      {race.name}
                    </span>
                    <span className="text-[10px] text-gray-600 shrink-0">
                      {dateStr}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* ── Desktop sidebar (md and above) ── */}
      {isCollapsed ? (
        /* Thin grab handle — 16px wide strip */
        <div
          className="hidden md:flex h-[calc(100vh-4rem)] items-center justify-center cursor-pointer transition-[width] duration-200 ease-in-out w-4 shrink-0"
          onClick={onToggle}
          role="button"
          aria-label="Expand sidebar"
        >
          <div className="w-[3px] h-10 rounded-full bg-white/20 hover:bg-white/50 transition-colors" />
        </div>
      ) : (
        /* Expanded sidebar — 280px */
        <aside className="hidden md:flex h-[calc(100vh-4rem)] bg-gray-900 border-r border-gray-800 flex-col transition-[width] duration-200 ease-in-out w-[280px] overflow-hidden">
          {sidebarContent}
        </aside>
      )}

      {/* ── Mobile drawer (below md) ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={onMobileClose} />
          {/* Drawer panel */}
          <aside className="absolute inset-y-0 left-0 w-[85vw] max-w-[320px] bg-gray-900 border-r border-gray-800 flex flex-col animate-slide-in-left">
            {/* Header with close button */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
              <span className="text-sm font-semibold text-gray-200">Races</span>
              <button
                onClick={onMobileClose}
                className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
                aria-label="Close sidebar"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll">
              {loading ? (
                <LoadingSkeleton />
              ) : error ? (
                <div className="p-3 text-sm">
                  <p className="text-red-400 mb-2">{error}</p>
                </div>
              ) : !eventData ? (
                <div className="flex-1 flex items-center justify-center p-4">
                  <p className="text-xs text-gray-600 text-center">
                    Select an event to see its races
                  </p>
                </div>
              ) : (
                <>
                  <div className="px-3 pt-3 pb-2 border-b border-gray-800">
                    <h2 className="text-sm font-semibold text-gray-100 leading-snug">
                      {eventData.track}
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                      <SeriesBadge series={eventData.series} />
                      <span className="text-[11px] text-gray-500">{dateRange}</span>
                    </div>
                  </div>
                  <div className="py-1">
                    {eventData.races.map((race) => {
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
                            "w-full flex items-center gap-2 px-3 h-9 text-left transition-colors",
                            isActive
                              ? "bg-gray-800/50 border-l-2 border-blue-500"
                              : "hover:bg-gray-800/40 border-l-2 border-transparent",
                          )}
                        >
                          <span
                            className={cn(
                              "text-sm truncate flex-1",
                              isActive ? "text-gray-100" : "text-gray-400",
                            )}
                          >
                            {race.name}
                          </span>
                          <span className="text-[10px] text-gray-600 shrink-0">
                            {dateStr}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

  if (s.toDateString() === e.toDateString()) {
    return s.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  }
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${s.toLocaleDateString("en-US", opts)}–${e.toLocaleDateString("en-US", opts)}, ${s.getFullYear()}`;
}

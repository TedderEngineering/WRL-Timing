import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { EventSummary, EventRace, SearchMatchedOn } from "@shared/types";
import { fetchEvent } from "../lib/api";
import { getSeriesColor } from "../lib/series-colors";
import { cn } from "../lib/utils";

interface EventCardProps {
  event: EventSummary;
  /** Pre-loaded races (e.g. from search results) */
  searchRaces?: EventRace[];
  matchedOn?: SearchMatchedOn;
  /** Start expanded (used when search matched a race-level field) */
  defaultExpanded?: boolean;
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

  if (s.toDateString() === e.toDateString()) {
    return s.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  }
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })}\u2013${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${s.toLocaleDateString("en-US", opts)}\u2013${e.toLocaleDateString("en-US", opts)}, ${s.getFullYear()}`;
}

export function EventCard({
  event,
  searchRaces,
  matchedOn,
  defaultExpanded,
}: EventCardProps) {
  const navigate = useNavigate();
  const { bg } = getSeriesColor(event.series);
  const seriesLabel = getSeriesColor(event.series).label;
  const dateRange = formatDateRange(event.startDate, event.endDate);

  // Auto-expand when search matched a race-level field
  const autoExpand =
    defaultExpanded ??
    (matchedOn === "race" || matchedOn === "sub_series");

  const [expanded, setExpanded] = useState(autoExpand);
  const [races, setRaces] = useState<EventRace[] | null>(searchRaces ?? null);
  const [loadingRaces, setLoadingRaces] = useState(false);

  const singleRace = event.raceCount === 1;

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (singleRace) return;

    if (!expanded && !races) {
      // Fetch races on first expand
      setLoadingRaces(true);
      fetchEvent(event.id)
        .then((detail) => setRaces(detail.races))
        .catch(() => {})
        .finally(() => setLoadingRaces(false));
    }
    setExpanded((p) => !p);
  };

  const handleCardClick = () => {
    navigate(`/chart?event=${event.id}`);
  };

  const handleRaceClick = (e: React.MouseEvent, raceId: string) => {
    e.stopPropagation();
    navigate(`/chart?event=${event.id}&race=${raceId}`);
  };

  return (
    <div
      className="rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-600 transition-colors overflow-hidden cursor-pointer"
      onClick={handleCardClick}
    >
      <div className="p-5">
        {/* Top row: series badge + date */}
        <div className="flex items-center justify-between mb-3">
          <span
            className="inline-flex items-center px-2 py-0.5 text-[11px] font-bold rounded-full leading-none"
            style={{ backgroundColor: bg, color: "#fff" }}
          >
            {seriesLabel}
          </span>
          <span className="text-xs text-gray-500">{dateRange}</span>
        </div>

        {/* Track name — main headline */}
        <h3 className="text-lg font-bold text-white leading-tight truncate">
          {event.track}
        </h3>

        {/* Bottom row: race count + expand toggle */}
        <div className="flex items-center justify-end mt-3">
          {!singleRace ? (
            <button
              onClick={handleToggleExpand}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <span>
                {event.raceCount} race{event.raceCount !== 1 ? "s" : ""}
              </span>
              <svg
                className={cn(
                  "h-3 w-3 transition-transform duration-150",
                  expanded && "rotate-90",
                )}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          ) : (
            <span className="text-xs text-gray-500">1 race</span>
          )}
        </div>
      </div>

      {/* Expanded race list */}
      {expanded && !singleRace && (
        <div className="border-t border-gray-800">
          {loadingRaces ? (
            <div className="px-5 py-3 flex items-center gap-2">
              <div className="h-3 w-3 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
              <span className="text-xs text-gray-500">Loading...</span>
            </div>
          ) : races ? (
            races.map((race) => (
              <button
                key={race.id}
                onClick={(e) => handleRaceClick(e, race.id)}
                className="w-full text-left px-5 py-2.5 hover:bg-gray-800/60 transition-colors border-b border-gray-800/50 last:border-b-0"
              >
                <span className="text-sm text-gray-300">
                  {race.subSeries || event.series}
                  {race.roundNumber != null && (
                    <span className="text-gray-500">
                      {" "}
                      &middot; Round {race.roundNumber}
                    </span>
                  )}
                </span>
                {race.name &&
                  race.name !== (race.subSeries || event.series) && (
                    <span className="block text-xs text-gray-600 mt-0.5">
                      {race.name}
                    </span>
                  )}
              </button>
            ))
          ) : (
            <div className="px-5 py-3 text-xs text-gray-500">
              Failed to load races
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { EventSummary, EventRace, SearchMatchedOn } from "@shared/types";
import { fetchEvent } from "../lib/api";
import { cn } from "../lib/utils";
import { SeriesBadge } from "./SeriesBadge";

interface EventCardProps {
  event: EventSummary;
  /** Pre-loaded races (e.g. from search results) */
  searchRaces?: EventRace[];
  matchedOn?: SearchMatchedOn;
  /** Start expanded (used when search matched a race-level field) */
  defaultExpanded?: boolean;
}

export function EventCard({
  event,
  searchRaces,
  matchedOn,
  defaultExpanded,
}: EventCardProps) {
  const navigate = useNavigate();

  const dateStr = new Date(event.startDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

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
      setLoadingRaces(true);
      fetchEvent(event.id)
        .then((detail) => setRaces(detail.races))
        .catch(() => {})
        .finally(() => setLoadingRaces(false));
    }
    setExpanded((p) => !p);
  };

  const handleCardClick = () => {
    // For single-race events with races already loaded, include race ID to skip loading
    if (singleRace && races && races.length > 0) {
      navigate(`/chart?event=${event.id}&race=${races[0].id}`);
    } else {
      navigate(`/chart?event=${event.id}`);
    }
  };

  const handleRaceClick = (e: React.MouseEvent, raceId: string) => {
    e.stopPropagation();
    navigate(`/chart?event=${event.id}&race=${raceId}`);
  };

  return (
    <div
      className="group relative rounded-xl overflow-hidden transition-all border border-gray-200 dark:border-gray-800 hover:border-brand-400 dark:hover:border-brand-600 hover:shadow-lg cursor-pointer"
      onClick={handleCardClick}
    >
      {/* Top color bar */}
      <div className="h-1.5 bg-gradient-to-r from-brand-500 to-cyan-500" />

      <div className="p-5">
        {/* Meta row */}
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-2">
          <SeriesBadge series={event.series} />
          <span>{dateStr}</span>
        </div>

        {/* Title — use track name; show event.name only when it differs meaningfully */}
        {(() => {
          // Strip year from event.name to compare with track
          const nameNoYear = event.name.replace(/\s*\d{4}$/, "").trim();
          const showEventName = nameNoYear.toLowerCase() !== event.track.toLowerCase()
            && !event.track.toLowerCase().includes(nameNoYear.toLowerCase())
            && !nameNoYear.toLowerCase().includes(event.track.toLowerCase());
          return (
            <>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors leading-tight">
                {showEventName ? event.name.replace(/\s*\d{4}$/, "") : event.track}
              </h3>
              {showEventName && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {event.track}
                </p>
              )}
            </>
          );
        })()}

        {/* Stats row */}
        <div className="flex items-center justify-between mt-3 text-xs text-gray-500 dark:text-gray-400">
          <span>
            {event.raceCount} race{event.raceCount !== 1 ? "s" : ""}
          </span>
          {!singleRace && (
            <button
              onClick={handleToggleExpand}
              className="flex items-center gap-1 hover:text-gray-300 transition-colors"
            >
              <span>Details</span>
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
          )}
        </div>
      </div>

      {/* Expanded race list */}
      {expanded && !singleRace && (
        <div className="border-t border-gray-200 dark:border-gray-800">
          {loadingRaces ? (
            <div className="px-5 py-3 flex items-center gap-2">
              <div className="h-3 w-3 border-2 border-gray-400 dark:border-gray-600 border-t-gray-200 dark:border-t-gray-300 rounded-full animate-spin" />
              <span className="text-xs text-gray-500">Loading...</span>
            </div>
          ) : races ? (
            races.map((race) => (
              <button
                key={race.id}
                onClick={(e) => handleRaceClick(e, race.id)}
                className="w-full text-left px-5 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors border-b border-gray-100 dark:border-gray-800/50 last:border-b-0"
              >
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {race.subSeries || event.series}
                  {race.roundNumber != null && (
                    <span className="text-gray-400 dark:text-gray-500">
                      {" "}
                      &middot; Round {race.roundNumber}
                    </span>
                  )}
                </span>
                {race.name &&
                  race.name !== (race.subSeries || event.series) && (
                    <span className="block text-xs text-gray-400 dark:text-gray-600 mt-0.5">
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

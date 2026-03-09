import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { EventSummary, EventRace, SearchMatchedOn } from "@shared/types";
import { fetchEvent } from "../lib/api";
import { cn } from "../lib/utils";
import { SeriesBadge } from "./SeriesBadge";
import { UpgradePrompt } from "./UpgradePrompt";

const SERIES_BORDER: Record<string, string> = {
  WRL: "linear-gradient(to right, #CC0000, #111111)",
  IMSA: "#0057B8",
  SRO: "#C41E3A",
};

interface EventCardProps {
  event: EventSummary;
  /** Pre-loaded races (e.g. from search results) */
  searchRaces?: EventRace[];
  matchedOn?: SearchMatchedOn;
  /** Start expanded (used when search matched a race-level field) */
  defaultExpanded?: boolean;
  /** Whether the event is accessible to the current user */
  accessible?: boolean;
}

export function EventCard({
  event,
  searchRaces,
  matchedOn,
  defaultExpanded,
  accessible = true,
}: EventCardProps) {
  const navigate = useNavigate();
  const [showUpgrade, setShowUpgrade] = useState(false);

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
    if (!accessible) {
      setShowUpgrade(true);
      return;
    }
    // For single-race events with races already loaded, include race ID to skip loading
    if (singleRace && races && races.length > 0) {
      navigate(`/chart?event=${event.id}&race=${races[0].id}`);
    } else {
      navigate(`/chart?event=${event.id}`);
    }
  };

  const handleRaceClick = (e: React.MouseEvent, raceId: string) => {
    e.stopPropagation();
    if (!accessible) {
      setShowUpgrade(true);
      return;
    }
    navigate(`/chart?event=${event.id}&race=${raceId}`);
  };

  return (
    <>
      <div
        className={cn(
          "group relative rounded-xl overflow-hidden transition-all border cursor-pointer",
          accessible
            ? "border-gray-200 dark:border-gray-800 hover:border-brand-400 dark:hover:border-brand-600 hover:shadow-lg"
            : "border-gray-200/50 dark:border-gray-800/50",
        )}
        onClick={handleCardClick}
        style={
          !accessible
            ? { filter: "blur(2.25px) grayscale(0.4)", opacity: 0.45 }
            : undefined
        }
      >
        {/* Series color top border */}
        <div
          className="h-[3px]"
          style={{
            background: SERIES_BORDER[event.series.toUpperCase()] || "#4B5563",
          }}
        />

        <div className="p-5">
          {/* Meta row */}
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-2">
            <SeriesBadge series={event.series} size="sm" />
            <span>&middot;</span>
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
            {!singleRace && accessible && (
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
        {expanded && !singleRace && accessible && (
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

      {/* Lock overlay — sits outside the blurred card so it's crisp */}
      {!accessible && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer rounded-xl"
          onClick={(e) => {
            e.stopPropagation();
            setShowUpgrade(true);
          }}
        >
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-900/80 border border-gray-700">
            <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-xs font-medium text-gray-300">Pro</span>
          </div>
        </div>
      )}

      <UpgradePrompt open={showUpgrade} onClose={() => setShowUpgrade(false)} />
    </>
  );
}

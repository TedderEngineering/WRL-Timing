import { useState } from "react";
import { Link } from "react-router-dom";
import type { EventSummary, EventWithRaces, EventRace } from "@shared/types";
import { fetchEvent } from "../lib/api";
import { getSeriesColor } from "../lib/series-colors";

/** Format event date range: "Jan 24–26, 2025" or "Apr 12, 2025" */
function formatDateRange(startDate: string, endDate: string): string {
  const s = new Date(startDate);
  const e = new Date(endDate);

  const sMonth = s.toLocaleDateString("en-US", { month: "short" });
  const sDay = s.getDate();
  const year = s.getFullYear();

  if (s.toDateString() === e.toDateString()) {
    return `${sMonth} ${sDay}, ${year}`;
  }

  const eMonth = e.toLocaleDateString("en-US", { month: "short" });
  const eDay = e.getDate();

  if (sMonth === eMonth) {
    return `${sMonth} ${sDay}–${eDay}, ${year}`;
  }
  return `${sMonth} ${sDay} – ${eMonth} ${eDay}, ${year}`;
}

/** Build race row label: "WeatherTech Championship · Round 1" */
function raceRowLabel(race: EventRace, parentSeries: string): { primary: string; secondary: string | null } {
  const seriesName = race.subSeries || parentSeries;
  let primary = seriesName;
  if (race.roundNumber != null) {
    primary += ` · Round ${race.roundNumber}`;
  }
  // Show race name as secondary line if it differs from series
  const secondary = race.name !== seriesName ? race.name : null;
  return { primary, secondary };
}

export function EventCard({ event }: { event: EventSummary }) {
  const { bg, text, label } = getSeriesColor(event.series);
  const dateStr = formatDateRange(event.startDate, event.endDate);
  const multiRace = event.raceCount > 1;

  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<EventWithRaces | null>(null);
  const [loading, setLoading] = useState(false);

  const handleExpand = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!detail) {
      setLoading(true);
      try {
        setDetail(await fetchEvent(event.id));
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
  };

  // Single-race: whole card links to first race
  const cardHref = multiRace ? `/chart?event=${event.id}` : `/chart?event=${event.id}`;

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-600 transition-colors overflow-hidden">
      <Link to={cardHref} className="block p-5">
        {/* Top row: series badge + date */}
        <div className="flex items-center justify-between mb-4">
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold"
            style={{ backgroundColor: bg, color: text }}
          >
            {label}
          </span>
          <span className="text-xs text-gray-500">{dateStr}</span>
        </div>

        {/* Track name */}
        <h3 className="text-lg font-bold text-white truncate">
          {event.track}
        </h3>

        {/* Bottom row: race count + expand chevron */}
        <div className="flex items-center justify-end mt-3">
          {multiRace ? (
            <button
              onClick={handleExpand}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors py-1"
            >
              {event.raceCount} races
              <svg
                className={`h-3 w-3 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <span className="text-xs text-gray-500">1 race</span>
          )}
        </div>
      </Link>

      {/* Expanded race list */}
      {expanded && (
        <div className="border-t border-gray-800">
          {loading ? (
            <div className="flex items-center gap-2 px-5 py-3">
              <div className="h-3 w-3 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
              <span className="text-xs text-gray-500">Loading...</span>
            </div>
          ) : detail ? (
            detail.races.map((race) => {
              const { primary, secondary } = raceRowLabel(race, event.series);
              return (
                <Link
                  key={race.id}
                  to={`/chart?event=${event.id}&race=${race.id}`}
                  className="block px-5 py-2.5 hover:bg-gray-800/60 transition-colors"
                >
                  <div className="text-sm text-gray-200">{primary}</div>
                  {secondary && (
                    <div className="text-xs text-gray-500 mt-0.5">{secondary}</div>
                  )}
                </Link>
              );
            })
          ) : (
            <div className="px-5 py-3 text-xs text-gray-500">Failed to load races</div>
          )}
        </div>
      )}
    </div>
  );
}

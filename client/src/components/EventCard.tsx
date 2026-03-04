import { Link } from "react-router-dom";
import type { EventSummary, SearchMatchedOn } from "@shared/types";

interface EventCardProps {
  event: EventSummary;
  searchRaces?: unknown;
  matchedOn?: SearchMatchedOn;
}

export function EventCard({ event }: EventCardProps) {
  const dateStr = new Date(event.startDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="group relative rounded-xl overflow-hidden transition-all border border-gray-200 dark:border-gray-800 hover:border-brand-400 dark:hover:border-brand-600 hover:shadow-lg">
      {/* Top color bar */}
      <div className="h-1.5 bg-gradient-to-r from-brand-500 to-cyan-500" />

      <Link to={`/chart?event=${event.id}`} className="block p-5">
        {/* Meta row */}
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-2">
          <span className="font-semibold text-brand-600 dark:text-brand-400">
            {event.series}
          </span>
          <span>·</span>
          <span>{dateStr}</span>
        </div>

        {/* Event name */}
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors leading-tight">
          {event.name}
        </h3>

        {/* Track */}
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          {event.track}
        </p>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
          <span>{event.raceCount} race{event.raceCount !== 1 ? "s" : ""}</span>
        </div>
      </Link>
    </div>
  );
}

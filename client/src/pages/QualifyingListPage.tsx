import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

interface QualifyingSessionSummary {
  id: string;
  name: string;
  sessionName: string;
  date: string;
  track: string;
  series: string;
  season: number;
}

export function QualifyingListPage() {
  const [sessions, setSessions] = useState<QualifyingSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ sessions: QualifyingSessionSummary[] }>("/qualifying")
      .then((res) => setSessions(res.sessions))
      .catch(() => setError("Failed to load qualifying sessions"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container-page py-8">
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
        Qualifying Sessions
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
        Sector analysis and qualifying performance data.
      </p>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-10 w-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <p className="text-red-500 mt-8">{error}</p>
      )}

      {!loading && !error && sessions.length === 0 && (
        <p className="text-gray-500 dark:text-gray-400 mt-8">
          No qualifying sessions available yet.
        </p>
      )}

      {!loading && sessions.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {sessions.map((s) => (
            <Link
              key={s.id}
              to={`/qualifying/${s.id}`}
              className="block rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 hover:border-brand-400 dark:hover:border-brand-500 transition-colors"
            >
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                {s.name}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {s.track}
              </p>
              <div className="flex items-center gap-3 mt-3 text-xs text-gray-400 dark:text-gray-500">
                <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium">
                  {s.series}
                </span>
                <span>{s.season}</span>
                <span>
                  {new Date(s.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { useRaceList, useFilterOptions } from "../hooks/useChartData";
import { api } from "../lib/api";


export function RaceListPage() {
  const { isAuthenticated } = useAuth();
  const [page, setPage] = useState(1);
  const [series, setSeries] = useState("");
  const [season, setSeason] = useState<number | undefined>();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const filters = useFilterOptions();
  const params = useMemo(
    () => ({ page, series: series || undefined, season, search: search || undefined }),
    [page, series, season, search]
  );
  const { result, isLoading, error } = useRaceList(params);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleFavorite = async (raceId: string) => {
    if (!isAuthenticated) return;
    try {
      await api.post(`/races/${raceId}/favorite`);
      // Optimistic UI would be better, but this works for now
      window.location.reload();
    } catch {
      // ignore
    }
  };

  return (
    <div className="container-page py-8 lg:py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50">
          Races
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Browse race charts from the World Racing League.
        </p>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap gap-3 mb-6 items-end">
        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Search
          </label>
          <div className="flex">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Race name, track..."
              className="flex-1 px-3 py-2 rounded-l-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-r-lg hover:bg-brand-700"
            >
              Search
            </button>
          </div>
        </form>

        {/* Series filter */}
        {filters && filters.series.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Series
            </label>
            <select
              value={series}
              onChange={(e) => {
                setSeries(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            >
              <option value="">All Series</option>
              {filters.series.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}

        {/* Season filter */}
        {filters && filters.seasons.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Season
            </label>
            <select
              value={season ?? ""}
              onChange={(e) => {
                setSeason(e.target.value ? Number(e.target.value) : undefined);
                setPage(1);
              }}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            >
              <option value="">All Seasons</option>
              {filters.seasons.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center py-20 text-red-500">{error}</div>
      )}

      {/* Race grid */}
      {result && !isLoading && (
        <>
          {result.races.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-lg text-gray-500 dark:text-gray-400">
                No races found.
              </p>
              {search && (
                <button
                  onClick={() => {
                    setSearch("");
                    setSearchInput("");
                  }}
                  className="mt-2 text-brand-600 hover:underline text-sm"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {result.races.map((race) => (
                <RaceCard
                  key={race.id}
                  race={race}
                  isAuthenticated={isAuthenticated}
                  onFavorite={handleFavorite}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {result.totalPages > 1 && (
            <div className="flex justify-center items-center gap-4 mt-8">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 border-gray-300 dark:border-gray-700"
              >
                ← Previous
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Page {page} of {result.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(result.totalPages, p + 1))}
                disabled={page === result.totalPages}
                className="px-4 py-2 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 border-gray-300 dark:border-gray-700"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Race Card ───────────────────────────────────────────────────────────────

function RaceCard({
  race,
  isAuthenticated,
  onFavorite,
}: {
  race: {
    id: string;
    name: string;
    date: string;
    track: string;
    series: string;
    season: number;
    premium: boolean;
    maxLap: number | null;
    totalCars: number | null;
    entryCount: number;
    isFavorited: boolean;
  };
  isAuthenticated: boolean;
  onFavorite: (id: string) => void;
}) {
  const dateStr = new Date(race.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="group relative border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden hover:border-brand-400 dark:hover:border-brand-600 hover:shadow-lg transition-all">
      {/* Top color bar based on series */}
      <div className="h-1.5 bg-gradient-to-r from-brand-500 to-cyan-500" />

      <Link to={`/races/${race.id}`} className="block p-5">
        {/* Meta row */}
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-2">
          <span className="font-semibold text-brand-600 dark:text-brand-400">
            {race.series}
          </span>
          <span>·</span>
          <span>{dateStr}</span>
          {race.premium && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                PRO
              </span>
            </>
          )}
        </div>

        {/* Title */}
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors leading-tight">
          {race.name}
        </h3>

        {/* Track */}
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          {race.track}
        </p>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
          {race.totalCars && (
            <span>{race.totalCars} cars</span>
          )}
          {race.maxLap && (
            <span>{race.maxLap} laps</span>
          )}
          <span>{race.entryCount} entries</span>
        </div>
      </Link>

      {/* Favorite button */}
      {isAuthenticated && (
        <button
          onClick={(e) => {
            e.preventDefault();
            onFavorite(race.id);
          }}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title={race.isFavorited ? "Remove from favorites" : "Add to favorites"}
        >
          <svg
            className={`h-5 w-5 ${
              race.isFavorited
                ? "text-yellow-500 fill-yellow-500"
                : "text-gray-400 dark:text-gray-600"
            }`}
            fill={race.isFavorited ? "currentColor" : "none"}
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

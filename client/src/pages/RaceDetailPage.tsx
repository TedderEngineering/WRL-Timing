import { useParams, Link } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { useChartData } from "../hooks/useChartData";
import { LapChart } from "../features/chart/LapChart";
import { api } from "../lib/api";
import { useState, useEffect } from "react";

export function RaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, user } = useAuth();
  const { data, annotations, raceMeta, isLoading, error, errorCode } = useChartData(id);
  const [isFavorited, setIsFavorited] = useState(false);

  // Fetch favorite status from race detail endpoint
  useEffect(() => {
    if (!id || !isAuthenticated) return;
    api
      .get<{ isFavorited: boolean }>(`/races/${id}`)
      .then((res) => setIsFavorited(res.isFavorited))
      .catch(() => {});
  }, [id, isAuthenticated]);

  const handleFavorite = async () => {
    if (!id || !isAuthenticated) return;
    try {
      const res = await api.post<{ isFavorited: boolean }>(`/races/${id}/favorite`);
      setIsFavorited(res.isFavorited);
    } catch {
      // ignore
    }
  };

  // ── Loading ─────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="h-10 w-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 dark:text-gray-400">Loading race data...</p>
      </div>
    );
  }

  // ── Subscription required overlay ────────────────────────────────
  if (errorCode === "SUBSCRIPTION_REQUIRED") {
    return (
      <div className="container-page py-20 text-center">
        <div className="max-w-md mx-auto">
          <div className="mx-auto w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-6">
            <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-3">
            Pro Access Required
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            This race chart is available to Pro and Team subscribers. Upgrade your plan to unlock full access to every race in the library.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/pricing"
              className="inline-block px-6 py-3 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 transition-colors"
            >
              View Plans
            </Link>
            <Link
              to="/races"
              className="inline-block px-6 py-3 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Back to Races
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────
  if (error || !data || !annotations || !raceMeta) {
    return (
      <div className="container-page py-20 text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-4">
          {error === "Race not found" ? "Race Not Found" : "Error Loading Race"}
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {error || "The chart data could not be loaded."}
        </p>
        <Link
          to="/races"
          className="text-brand-600 dark:text-brand-400 hover:underline font-medium"
        >
          Back to races
        </Link>
      </div>
    );
  }

  // ── Format date ────────────────────────────────────────────────
  const dateStr = new Date(raceMeta.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="max-w-[1600px] mx-auto px-2 sm:px-4 py-4 sm:py-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              to="/races"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              Races
            </Link>
            <span className="text-gray-300 dark:text-gray-600">/</span>
            <span className="text-sm text-brand-600 dark:text-brand-400 font-medium">
              {raceMeta.series} {raceMeta.season}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
            {raceMeta.name}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {raceMeta.track} · {dateStr}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAuthenticated && (
            <button
              onClick={handleFavorite}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <svg
                className={`h-4 w-4 ${
                  isFavorited ? "text-yellow-500 fill-yellow-500" : "text-gray-400"
                }`}
                fill={isFavorited ? "currentColor" : "none"}
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
              {isFavorited ? "Saved" : "Save"}
            </button>
          )}
        </div>
      </div>

      {/* Chart */}
      <LapChart data={data} annotations={annotations} raceId={id} watermarkEmail={user?.email} />
    </div>
  );
}

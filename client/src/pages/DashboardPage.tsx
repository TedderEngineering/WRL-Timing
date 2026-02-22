import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Alert } from "../components/Alert";
import { api } from "../lib/api";

interface RaceItem {
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
  favoriteCount: number;
  isFavorited: boolean;
  createdAt: string;
}

export function DashboardPage() {
  const { user } = useAuth();
  const [latestRaces, setLatestRaces] = useState<RaceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ races: RaceItem[]; total: number }>(
        "/races?pageSize=6&sortBy=date&sortOrder=desc"
      )
      .then((res) => {
        setLatestRaces(res.races);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const favoriteRaces = latestRaces.filter((r) => r.isFavorited);

  return (
    <div className="container-page py-8 lg:py-10">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50">
          Welcome back{user?.displayName ? `, ${user.displayName}` : ""}!
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Here's your race analysis dashboard.
        </p>
      </div>

      {user && !user.emailVerified && (
        <Alert variant="warning" className="mb-8">
          Your email hasn't been verified yet. Check your inbox for a
          verification link.
        </Alert>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <StatCard
          label="Subscription"
          value={user?.subscription?.plan || "Free"}
        />
        <StatCard
          label="Favorites"
          value={loading ? "…" : String(favoriteRaces.length)}
        />
        <StatCard
          label="Available Races"
          value={loading ? "…" : String(latestRaces.length)}
        />
      </div>

      {/* Latest Races */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">
            Latest Races
          </h2>
          <Link
            to="/races"
            className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
          >
            View all →
          </Link>
        </div>

        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 border border-gray-200 dark:border-gray-800 rounded-xl animate-pulse bg-gray-100 dark:bg-gray-900"
              />
            ))}
          </div>
        ) : latestRaces.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {latestRaces.map((race) => (
              <MiniRaceCard key={race.id} race={race} />
            ))}
          </div>
        ) : (
          <EmptyState
            message="No races available yet."
            cta={{ label: "Browse Races", to: "/races" }}
          />
        )}
      </section>

      {/* Favorites */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-4">
          Your Favorites
        </h2>

        {favoriteRaces.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {favoriteRaces.map((race) => (
              <MiniRaceCard key={race.id} race={race} />
            ))}
          </div>
        ) : (
          <EmptyState
            message="No favorites yet — star a race to save it here."
            cta={{ label: "Browse Races", to: "/races" }}
          />
        )}
      </section>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-5">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </p>
      <p className="text-2xl font-semibold text-gray-900 dark:text-gray-50">
        {value}
      </p>
    </div>
  );
}

function MiniRaceCard({ race }: { race: RaceItem }) {
  const dateStr = new Date(race.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link
      to={`/races/${race.id}`}
      className="group block border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-brand-400 dark:hover:border-brand-600 hover:shadow-md transition-all"
    >
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1.5">
        <span className="font-semibold text-brand-600 dark:text-brand-400">
          {race.series}
        </span>
        <span>·</span>
        <span>{dateStr}</span>
      </div>
      <h3 className="font-bold text-gray-900 dark:text-gray-50 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors leading-tight">
        {race.name}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
        {race.track}
      </p>
      <div className="flex gap-3 mt-2 text-xs text-gray-400 dark:text-gray-500">
        {race.totalCars && <span>{race.totalCars} cars</span>}
        {race.maxLap && <span>{race.maxLap} laps</span>}
      </div>
    </Link>
  );
}

function EmptyState({
  message,
  cta,
}: {
  message: string;
  cta?: { label: string; to: string };
}) {
  return (
    <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center">
      <p className="text-gray-500 dark:text-gray-400">{message}</p>
      {cta && (
        <Link
          to={cta.to}
          className="inline-block mt-3 text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}

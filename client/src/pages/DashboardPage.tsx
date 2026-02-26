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
  entryCount?: number;
  favoriteCount: number;
  isFavorited: boolean;
  lastViewed?: string;
  createdAt?: string;
}

// Series → accent color mapping
const SERIES_COLORS: Record<string, string> = {
  WRL: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  IMSA: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  SRO: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

function seriesClasses(series: string) {
  return SERIES_COLORS[series] || "bg-brand-500/15 text-brand-400 border-brand-500/30";
}

export function DashboardPage() {
  const { user } = useAuth();
  const [latestRaces, setLatestRaces] = useState<RaceItem[]>([]);
  const [recentlyViewed, setRecentlyViewed] = useState<RaceItem[]>([]);
  const [favorites, setFavorites] = useState<RaceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [latestRes, recentRes, favRes] = await Promise.allSettled([
          api.get<{ races: RaceItem[]; total: number }>(
            "/races?pageSize=9&sortBy=date&sortOrder=desc"
          ),
          api.get<{ races: RaceItem[] }>("/races/recently-viewed?limit=8"),
          api.get<{ races: RaceItem[] }>("/races/favorites?limit=8"),
        ]);

        if (latestRes.status === "fulfilled") setLatestRaces(latestRes.value.races);
        if (recentRes.status === "fulfilled") setRecentlyViewed(recentRes.value.races);
        if (favRes.status === "fulfilled") setFavorites(favRes.value.races);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const isFree = !user?.subscription?.plan || user.subscription.plan === "FREE";

  // Featured race = most recent
  const featured = latestRaces[0] || null;
  // Races they haven't viewed yet
  const viewedIds = new Set(recentlyViewed.map((r) => r.id));
  const newToAnalyze = latestRaces.filter((r) => !viewedIds.has(r.id)).slice(0, 6);

  const greeting = getGreeting();

  return (
    <div className="container-page py-6 lg:py-8 space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-gray-50">
          {greeting}{user?.displayName ? `, ${user.displayName}` : ""}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {user && !user.emailVerified && (
        <Alert variant="warning">
          Your email hasn't been verified yet. Check your inbox for a verification link.
        </Alert>
      )}

      {/* Featured Race — big hero card */}
      {loading ? (
        <div className="h-44 rounded-2xl bg-gray-100 dark:bg-gray-900 animate-pulse" />
      ) : featured ? (
        <Link
          to={`/races/${featured.id}`}
          className="group relative block rounded-2xl overflow-hidden bg-gradient-to-r from-gray-100 via-gray-100 to-brand-50 dark:from-gray-900 dark:via-gray-900 dark:to-brand-950/50 border border-gray-200 dark:border-gray-800 hover:border-brand-400 dark:hover:border-brand-700 transition-all"
        >
          {/* Decorative grid lines */}
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: "linear-gradient(rgba(128,128,128,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(128,128,128,.4) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }} />
          <div className="relative p-6 lg:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${seriesClasses(featured.series)}`}>
                  {featured.series}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {new Date(featured.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-brand-500/20 text-brand-600 dark:text-brand-400 border border-brand-500/30">
                  Latest
                </span>
              </div>
              <h2 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-gray-50 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                {featured.name}
              </h2>
              <p className="text-gray-500 dark:text-gray-400 mt-1">{featured.track}</p>
              <div className="flex gap-4 mt-3 text-sm text-gray-400 dark:text-gray-500">
                {featured.totalCars && (
                  <span className="flex items-center gap-1">
                    <CarIcon />
                    {featured.totalCars} cars
                  </span>
                )}
                {featured.maxLap && (
                  <span className="flex items-center gap-1">
                    <LapIcon />
                    {featured.maxLap} laps
                  </span>
                )}
              </div>
            </div>
            <div className="lg:text-right shrink-0">
              <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold group-hover:bg-brand-500 transition-colors">
                View Chart
                <svg className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </span>
              {isFree && (
                <p className="text-xs text-indigo-300/70 mt-2">1 of 3 free races this week</p>
              )}
            </div>
          </div>
        </Link>
      ) : null}

      {/* Recently Viewed — horizontal scroll */}
      {recentlyViewed.length > 0 && (
        <section>
          <SectionHeader title="Recently Viewed" />
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
            {recentlyViewed.map((race) => (
              <CompactRaceCard key={race.id} race={race} />
            ))}
          </div>
        </section>
      )}

      {/* Favorites */}
      {isFree ? (
        <Link
          to="/settings/billing"
          className="block bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 text-center hover:border-indigo-500/30 transition-colors"
        >
          <svg className="h-6 w-6 text-gray-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
          <p className="text-gray-400 text-sm">Save your favorite races for quick access</p>
          <p className="text-indigo-400 text-xs font-medium mt-1">Available on Pro</p>
        </Link>
      ) : favorites.length > 0 ? (
        <section>
          <SectionHeader title="Your Favorites" linkTo="/races" linkText="View all" />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {favorites.map((race) => (
              <RaceCard key={race.id} race={race} />
            ))}
          </div>
        </section>
      ) : null}

      {/* New to Analyze / Latest */}
      {!loading && (
        <section>
          <SectionHeader
            title={recentlyViewed.length > 0 ? "New to Analyze" : "Latest Races"}
            linkTo="/races"
            linkText="Browse all"
          />
          {newToAnalyze.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(isFree ? newToAnalyze.slice(0, 3) : newToAnalyze).map((race) => (
                <RaceCard key={race.id} race={race} />
              ))}
              {isFree && newToAnalyze.length > 3 && <UpsellCard count={newToAnalyze.length - 3} />}
            </div>
          ) : latestRaces.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {latestRaces.slice(0, isFree ? 3 : 6).map((race) => (
                <RaceCard key={race.id} race={race} />
              ))}
              {isFree && latestRaces.length > 3 && <UpsellCard count={latestRaces.length - 3} />}
            </div>
          ) : (
            <EmptyState message="No races available yet. Check back soon!" />
          )}
        </section>
      )}

      {/* Empty state for brand new users */}
      {!loading && latestRaces.length === 0 && recentlyViewed.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🏁</div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Welcome to RaceTrace
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
            Interactive position trace charts for endurance racing.
            Race data will appear here as it becomes available.
          </p>
          <Link
            to="/races"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-500 transition-colors"
          >
            Browse Races
          </Link>
        </div>
      )}

      {/* Quick Stats Footer / Upgrade CTA */}
      {!loading && latestRaces.length > 0 && (
        isFree ? (
          <div className="bg-gradient-to-r from-gray-800 to-gray-800/80 border border-gray-700 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold text-white">Ready to go deeper?</h3>
              <p className="text-gray-400 text-sm mt-1 max-w-lg">
                Pro members unlock every race, unlimited favorites, and advanced filtering — everything you need to analyze full seasons.
              </p>
            </div>
            <Link
              to="/settings/billing"
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-colors whitespace-nowrap"
            >
              Upgrade to Pro
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <MiniStat label="Races Analyzed" value={String(recentlyViewed.length)} />
            <MiniStat label="Favorites" value={String(favorites.length)} />
            <MiniStat
              label="Plan"
              value={capitalize(user?.subscription?.plan || "Free")}
            />
          </div>
        )
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ title, linkTo, linkText }: {
  title: string;
  linkTo?: string;
  linkText?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>
      {linkTo && (
        <Link to={linkTo} className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-500 dark:hover:text-brand-300 transition-colors">
          {linkText || "View all"} →
        </Link>
      )}
    </div>
  );
}

function RaceCard({ race }: { race: RaceItem }) {
  const dateStr = new Date(race.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link
      to={`/races/${race.id}`}
      className="group block rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 hover:border-brand-400 dark:hover:border-brand-600/50 p-4 transition-all"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${seriesClasses(race.series)}`}>
          {race.series}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{dateStr}</span>
      </div>
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors leading-tight text-sm">
        {race.name}
      </h3>
      <p className="text-xs text-gray-500 mt-0.5">{race.track}</p>
      <div className="flex gap-3 mt-2.5 text-[11px] text-gray-400 dark:text-gray-600">
        {race.totalCars && <span>{race.totalCars} cars</span>}
        {race.maxLap && <span>{race.maxLap} laps</span>}
        {race.isFavorited && <span className="text-amber-500">★</span>}
      </div>
    </Link>
  );
}

function UpsellCard({ count }: { count: number }) {
  return (
    <Link
      to="/settings/billing"
      className="bg-gradient-to-r from-indigo-900/30 to-purple-900/30 border border-indigo-500/20 border-dashed rounded-xl flex flex-col items-center justify-center p-6 text-center hover:border-indigo-500/40 transition-colors"
    >
      <svg className="h-8 w-8 text-indigo-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
      <span className="text-white font-semibold">{count}+ more races</span>
      <span className="text-gray-400 text-sm mt-1">available with Pro</span>
      <span className="text-indigo-400 hover:text-indigo-300 text-sm font-medium mt-3 inline-block">
        See plans →
      </span>
    </Link>
  );
}

function CompactRaceCard({ race }: { race: RaceItem }) {
  const dateStr = new Date(race.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <Link
      to={`/races/${race.id}`}
      className="group shrink-0 w-56 rounded-lg bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 hover:border-brand-400 dark:hover:border-brand-600/50 p-3 transition-all"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${seriesClasses(race.series)}`}>
          {race.series}
        </span>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">{dateStr}</span>
      </div>
      <h3 className="font-semibold text-gray-800 dark:text-gray-200 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors text-sm leading-tight truncate">
        {race.name}
      </h3>
      <p className="text-[11px] text-gray-500 truncate mt-0.5">{race.track}</p>
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800/50 px-4 py-3 text-center">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-lg font-bold text-gray-800 dark:text-gray-200">{value}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
      <p className="text-gray-500">{message}</p>
    </div>
  );
}

function CarIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
    </svg>
  );
}

function LapIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
    </svg>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Alert } from "../components/Alert";
import { SeriesBadge } from "../components/SeriesBadge";
import { api } from "../lib/api";
import { hasFullAccess } from "../lib/utils";

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


export function DashboardPage() {
  const { user } = useAuth();
  const [latestRaces, setLatestRaces] = useState<RaceItem[]>([]);
  const [totalRaceCount, setTotalRaceCount] = useState(0);
  const [recentlyViewed, setRecentlyViewed] = useState<RaceItem[]>([]);
  const [favorites, setFavorites] = useState<RaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);

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

        if (latestRes.status === "fulfilled") {
          setLatestRaces(latestRes.value.races);
          setTotalRaceCount(latestRes.value.total);
        }
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

  const isFree = !hasFullAccess(user);

  // Resend verification email
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "rate-limited" | "error">("idle");
  const handleResend = useCallback(async () => {
    setResendStatus("sending");
    try {
      await api.post("/auth/resend-verification");
      setResendStatus("sent");
      setTimeout(() => setResendStatus("idle"), 60_000);
    } catch (err: any) {
      if (err?.code === "RATE_LIMITED" || err?.status === 429) {
        setResendStatus("rate-limited");
        setTimeout(() => setResendStatus("idle"), 60_000);
      } else {
        setResendStatus("error");
      }
    }
  }, []);

  // Featured = most recently viewed, or newest race
  const featured = recentlyViewed[0] || latestRaces[0] || null;
  // Jump Back In list = next 5 recently viewed after featured
  const jumpBackIn = recentlyViewed.slice(1, 6);
  // New to Analyze = latest races not in viewed set
  const viewedIds = new Set(recentlyViewed.map((r) => r.id));
  const newToAnalyze = latestRaces.filter((r) => !viewedIds.has(r.id)).slice(0, 6);

  const greeting = getGreeting();
  const totalRaces = totalRaceCount;
  const lockedCount = isFree ? Math.max(0, totalRaces - 3) : 0;

  return (
    <div className="container-page py-6 lg:py-8">
      {/* Email verification alert */}
      {user && !user.emailVerified && (
        <Alert variant="warning" className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Your email hasn't been verified yet. Check your inbox for a verification link.</span>
            <button
              onClick={handleResend}
              disabled={resendStatus === "sending" || resendStatus === "sent" || resendStatus === "rate-limited"}
              className="shrink-0 px-3 py-1 text-xs font-medium rounded-md border border-amber-600 dark:border-amber-500 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {resendStatus === "sending" && "Sending..."}
              {resendStatus === "sent" && "Verification email sent!"}
              {resendStatus === "rate-limited" && "Please wait before requesting another email"}
              {resendStatus === "error" && "Failed to send -- try again"}
              {resendStatus === "idle" && "Resend verification email"}
            </button>
          </div>
        </Alert>
      )}

      {/* Header row: greeting left, stats right */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
            {greeting}{user?.displayName ? `, ${user.displayName}` : ""}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1.5 text-sm">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[13px] text-gray-500 dark:text-gray-400">
            {isFree ? (
              <>
                <span className="font-semibold text-gray-900 dark:text-white">3</span>
                <span className="text-gray-400 dark:text-white/35"> / {totalRaces}</span> races available
              </>
            ) : (
              <>
                <span className="font-semibold text-gray-900 dark:text-white">{totalRaces}</span> races available
              </>
            )}
          </div>
          {!isFree && (
            <div className="px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-xs font-bold text-green-400 tracking-wider">
              PRO
            </div>
          )}
        </div>
      </div>

      {/* Free tier upsell banner */}
      {isFree && !bannerDismissed && (
        <div className="rounded-xl p-3.5 px-4 mb-6 bg-gradient-to-r from-amber-600/10 to-amber-700/5 border border-amber-600/25 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xl shrink-0">🏆</span>
            <p className="text-sm">
              <span className="font-semibold text-amber-300">{lockedCount} races waiting for you.</span>
              <span className="text-gray-300 ml-1.5">Unlock every race, full filtering, and unlimited favorites with Pro.</span>
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              to="/settings/billing"
              className="px-4 py-1.5 rounded-lg bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-500 transition-colors"
            >
              Unlock Pro →
            </Link>
            <button
              onClick={() => setBannerDismissed(true)}
              className="text-white/30 hover:text-white/60 text-xl leading-none px-1 transition-colors"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          <div className="h-44 rounded-2xl bg-gray-100 dark:bg-gray-900 animate-pulse" />
          <div className="h-32 rounded-xl bg-gray-100 dark:bg-gray-900 animate-pulse" />
        </div>
      ) : (
        <>
          {/* Two-column main area */}
          <div className="flex gap-6 mb-8">
            {/* LEFT column — Jump Back In (320px fixed) */}
            <div className="w-80 shrink-0 hidden lg:block">
              <SectionLabel>Jump Back In</SectionLabel>

              {/* Featured card */}
              {featured && (
                <Link
                  to={`/chart?race=${featured.id}`}
                  className="group block rounded-xl p-5 mb-2 bg-gradient-to-br from-gray-100 to-gray-50 dark:from-gray-800/80 dark:to-gray-900/60 border border-gray-200 dark:border-indigo-500/25 hover:border-brand-400 dark:hover:border-indigo-500/50 transition-all"
                >
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <SeriesBadge series={featured.series} />
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {formatDate(featured.date)}
                    </span>
                    <span className="ml-auto text-[11px] font-semibold bg-brand-500/15 text-brand-400 border border-brand-500/25 rounded-full px-2 py-0.5">
                      Last viewed
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors mb-1">
                    {featured.name}
                  </h3>
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-4">{featured.track}</p>
                  <div className="flex gap-4 text-xs text-gray-400 dark:text-gray-500 mb-4">
                    {featured.totalCars && <span>{featured.totalCars} cars</span>}
                    {featured.maxLap && <span>{featured.maxLap} laps</span>}
                  </div>
                  <div className="w-full py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold text-center group-hover:bg-brand-500 transition-colors">
                    View Chart →
                  </div>
                </Link>
              )}

              {/* Compact recent list */}
              <div className="flex flex-col gap-0.5">
                {jumpBackIn.map((race) => (
                  <Link
                    key={race.id}
                    to={`/chart?race=${race.id}`}
                    className="group flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg border border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:border-gray-200 dark:hover:border-white/[0.08] transition-all"
                  >
                    <SeriesBadge series={race.series} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-gray-800 dark:text-gray-200 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                        {race.name}
                      </p>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{race.track}</p>
                    </div>
                    <span className="text-gray-300 dark:text-white/20 text-sm">›</span>
                  </Link>
                ))}

                {/* Free tier: blurred ghost rows */}
                {isFree && (
                  <>
                    {[
                      { name: "Saturday 8 Hour", track: "Road America", series: "WRL" },
                      { name: "Sunday 7-Hour", track: "Barber Motorsports Park", series: "WRL" },
                    ].map((r, i) => (
                      <div
                        key={`ghost-${i}`}
                        className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg select-none pointer-events-none"
                        style={{ filter: "blur(2.25px)", opacity: 0.35 }}
                      >
                        <SeriesBadge series={r.series} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-gray-200 truncate">{r.name}</p>
                          <p className="text-[11px] text-gray-500 truncate">{r.track}</p>
                        </div>
                        <span className="text-white/20 text-sm">›</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* RIGHT column — New to Analyze (flex-1) */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-3.5">
                <div className="flex items-center gap-2.5">
                  <SectionLabel className="mb-0">
                    {recentlyViewed.length > 0 ? "New to Analyze" : "Latest Races"}
                  </SectionLabel>
                  {isFree && lockedCount > 0 && (
                    <span className="text-[11px] font-semibold text-amber-400 bg-amber-600/15 border border-amber-600/25 rounded-full px-2 py-0.5">
                      {lockedCount} locked
                    </span>
                  )}
                </div>
                <Link to="/races" className="text-[13px] text-brand-500 dark:text-brand-400 hover:text-brand-400 dark:hover:text-brand-300 transition-colors">
                  Browse all →
                </Link>
              </div>
              <div className="grid sm:grid-cols-2 gap-2.5">
                {(isFree ? newToAnalyze.slice(0, 3) : newToAnalyze).map((race) => (
                  <RaceCard key={race.id} race={race} />
                ))}
                {/* Free tier: locked cards */}
                {isFree && newToAnalyze.slice(3).map((race) => (
                  <LockedRaceCard key={race.id} race={race} />
                ))}
              </div>
              {newToAnalyze.length === 0 && latestRaces.length > 0 && (
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {latestRaces.slice(0, isFree ? 3 : 6).map((race) => (
                    <RaceCard key={race.id} race={race} />
                  ))}
                </div>
              )}
              {latestRaces.length === 0 && (
                <EmptyState message="No races available yet. Check back soon!" />
              )}

              {/* Mobile: show featured card inline since left column is hidden */}
              {featured && (
                <div className="lg:hidden mt-6">
                  <SectionLabel>Jump Back In</SectionLabel>
                  <Link
                    to={`/chart?race=${featured.id}`}
                    className="group block rounded-xl p-5 bg-gradient-to-br from-gray-100 to-gray-50 dark:from-gray-800/80 dark:to-gray-900/60 border border-gray-200 dark:border-indigo-500/25 hover:border-brand-400 dark:hover:border-indigo-500/50 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <SeriesBadge series={featured.series} />
                      <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(featured.date)}</span>
                      <span className="ml-auto text-[11px] font-semibold bg-brand-500/15 text-brand-400 border border-brand-500/25 rounded-full px-2 py-0.5">
                        Last viewed
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">{featured.name}</h3>
                    <p className="text-sm text-gray-500 mb-3">{featured.track}</p>
                    <div className="w-full py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold text-center group-hover:bg-brand-500 transition-colors">
                      View Chart →
                    </div>
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* FULL-WIDTH — Favorites */}
          <div>
            <div className="h-px bg-gray-200 dark:bg-white/[0.07] mb-6" />
            <div className="flex items-center gap-2.5 mb-3.5">
              <SectionLabel className="mb-0">Favorites</SectionLabel>
              {isFree ? (
                <span className="text-[11px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-white/[0.06] border border-gray-200 dark:border-white/10 rounded-full px-2 py-0.5">
                  Pro feature
                </span>
              ) : favorites.length > 0 ? (
                <span className="text-[11px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-white/[0.08] border border-gray-200 dark:border-white/[0.12] rounded-full px-2 py-0.5">
                  {favorites.length}
                </span>
              ) : null}
            </div>

            {isFree ? (
              // Free tier: blurred ghost favorites
              <div
                className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 select-none pointer-events-none"
                style={{ filter: "blur(2.7px)", opacity: 0.2 }}
              >
                {[
                  { series: "WRL", name: "Saturday 8-Hour", track: "Barber Motorsports Park", cars: 42, laps: 270 },
                  { series: "IMSA", name: "Petit Le Mans", track: "Road Atlanta", cars: 60, laps: 394 },
                  { series: "WRL", name: "Saturday 8-Hour", track: "Circuit of the Americas COTA", cars: 70, laps: 171 },
                  { series: "SRO", name: "GT World Challenge", track: "Sebring", cars: 40, laps: 168 },
                  { series: "WRL", name: "Sunday 7 Hour", track: "Watkins Glen", cars: 36, laps: 200 },
                ].map((r, i) => (
                  <div key={i} className="rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <SeriesBadge series={r.series} />
                    </div>
                    <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-0.5">{r.name}</p>
                    <p className="text-xs text-gray-500 mb-2.5">{r.track}</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-600">{r.cars} cars · {r.laps} laps</p>
                  </div>
                ))}
              </div>
            ) : favorites.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                {favorites.map((race) => (
                  <RaceCard key={race.id} race={race} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-400 dark:text-gray-500 text-sm">
                No favorites yet -- browse races and star the ones you want here
              </div>
            )}
          </div>

          {/* Empty state for brand new users */}
          {latestRaces.length === 0 && recentlyViewed.length === 0 && (
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
                Browse Events
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- Sub-components ----

function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`text-[11px] font-bold text-gray-400 dark:text-white/30 tracking-[0.12em] uppercase mb-3.5 ${className}`}>
      {children}
    </h2>
  );
}

function RaceCard({ race }: { race: RaceItem }) {
  return (
    <Link
      to={`/chart?race=${race.id}`}
      className="group block rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 hover:border-brand-400 dark:hover:border-brand-600/50 p-4 transition-all"
    >
      <div className="flex items-center gap-2 mb-2">
        <SeriesBadge series={race.series} />
        <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(race.date)}</span>
      </div>
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors leading-tight text-sm">
        {race.name}
      </h3>
      <p className="text-xs text-gray-500 mt-0.5">{race.track}</p>
      <div className="flex items-center justify-between mt-2.5">
        <div className="flex gap-3 text-[11px] text-gray-400 dark:text-gray-600">
          {race.totalCars && <span>{race.totalCars} cars</span>}
          {race.maxLap && <span>{race.maxLap} laps</span>}
          {race.isFavorited && <span className="text-amber-500">★</span>}
        </div>
        <span className="text-xs text-brand-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
          View →
        </span>
      </div>
    </Link>
  );
}

function LockedRaceCard({ race }: { race: RaceItem }) {
  return (
    <div
      className="rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 p-4 select-none pointer-events-none"
      style={{ filter: "blur(2.25px) grayscale(0.4)", opacity: 0.45 }}
    >
      <div className="flex items-center gap-2 mb-2">
        <SeriesBadge series={race.series} />
        <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(race.date)}</span>
      </div>
      <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 leading-tight">{race.name}</p>
      <p className="text-xs text-gray-500 mt-0.5">{race.track}</p>
      <div className="flex gap-3 mt-2.5 text-[11px] text-gray-400 dark:text-gray-600">
        {race.totalCars && <span>{race.totalCars} cars</span>}
        {race.maxLap && <span>{race.maxLap} laps</span>}
      </div>
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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

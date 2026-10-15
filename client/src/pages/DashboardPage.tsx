import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Alert } from "../components/Alert";
import { api } from "../lib/api";
import { hasFullAccess } from "../lib/utils";
import { RecapCard } from "../features/dashboard/RecapCard";
import { InstallHint } from "../features/dashboard/InstallHint";
import { FirstStepsChecklist, MyCarCard, type MyCarResponse } from "../features/dashboard/MyCarCard";
import { NextUp, SeasonPanel, nextFor } from "../features/dashboard/SeasonPanel";
import { greeting } from "../features/dashboard/format";
import type { LatestEvent, SeasonResponse } from "../features/dashboard/types";
import { SupportCard } from "../features/support/SupportPrompts";

interface RaceItem {
  id: string;
  name: string;
  date: string;
  track: string;
  series: string;
}

/**
 * Dashboard (RaceTrace 2.0, mockups F7/F8): the newest race weekends with
 * their recaps, then the season for the series this user follows.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<LatestEvent[] | null>(null);
  const [season, setSeason] = useState<SeasonResponse | null>(null);
  const [recent, setRecent] = useState<RaceItem[]>([]);
  const [favorites, setFavorites] = useState<RaceItem[]>([]);
  const [failed, setFailed] = useState(false);
  const [myCar, setMyCar] = useState<MyCarResponse | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [latestRes, seasonRes, recentRes, favRes, myCarRes] = await Promise.allSettled([
        api.get<{ events: LatestEvent[] }>("/dashboard/latest?limit=10"),
        api.get<SeasonResponse>("/dashboard/season"),
        api.get<{ races: RaceItem[] }>("/races/recently-viewed?limit=1"),
        api.get<{ races: RaceItem[] }>("/races/favorites?limit=8"),
        api.get<MyCarResponse>("/dashboard/my-car"),
      ]);
      if (!alive) return;
      if (latestRes.status === "fulfilled") setEvents(latestRes.value.events);
      else {
        setEvents([]);
        setFailed(true);
      }
      if (seasonRes.status === "fulfilled") setSeason(seasonRes.value);
      if (recentRes.status === "fulfilled") setRecent(recentRes.value.races);
      if (favRes.status === "fulfilled") setFavorites(favRes.value.races);
      if (myCarRes.status === "fulfilled") setMyCar(myCarRes.value);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const isFree = !hasFullAccess(user);

  const [resendStatus, setResendStatus] = useState<
    "idle" | "sending" | "sent" | "rate-limited" | "error"
  >("idle");
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

  const continueRace = recent[0] ?? null;
  // The two latest weekends get the full card with the recap; earlier ones a smaller card in a
  // grid, with the same race tabs and one click to Position Trace.
  const cards = (events ?? []).slice(0, 2);
  const earlier = (events ?? []).slice(2);

  return (
    <div className="container-page py-6 text-left text-[var(--rt-text)] lg:py-8">
      {user && !user.emailVerified && (
        <Alert variant="warning" className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Your email hasn't been verified yet. Check your inbox for a verification
              link.
            </span>
            <button
              onClick={handleResend}
              disabled={
                resendStatus === "sending" ||
                resendStatus === "sent" ||
                resendStatus === "rate-limited"
              }
              className="shrink-0 rounded-md border border-amber-600 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500 dark:text-amber-300 dark:hover:bg-amber-900/20"
            >
              {resendStatus === "sending" && "Sending..."}
              {resendStatus === "sent" && "Verification email sent!"}
              {resendStatus === "rate-limited" &&
                "Please wait before requesting another email"}
              {resendStatus === "error" && "Failed to send -- try again"}
              {resendStatus === "idle" && "Resend verification email"}
            </button>
          </div>
        </Alert>
      )}

      {/* Greeting + continue */}
      <section className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-3.5">
          <h1 className="m-0 text-2xl font-semibold">
            {greeting()}
            {user?.displayName ? `, ${user.displayName}` : ""}
          </h1>
          <span className="text-[var(--rt-text-muted)]">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
        {continueRace && (
          <Link
            to={`/chart?race=${continueRace.id}`}
            className="flex min-h-[44px] max-w-full items-center gap-2.5 rounded-lg border border-[var(--rt-border)] bg-[var(--rt-surface)] px-3.5 py-2 text-[var(--rt-text-secondary)]"
          >
            <span className="text-xs uppercase tracking-[0.08em] text-[var(--rt-text-muted)]">
              Continue
            </span>
            <span className="min-w-0 truncate text-[var(--rt-text)]">
              {continueRace.name} · {continueRace.track}
            </span>
            <span className="text-[var(--rt-accent)]">→</span>
          </Link>
        )}
      </section>

      {/* Phone: the next round sits above the races (F8); on wide screens it heads the season column. */}
      {(() => {
        const n = nextFor(season);
        return n && season ? (
          <div className="mb-5 lg:hidden">
            <NextUp next={n} today={season.today} />
          </div>
        ) : null;
      })()}

      {isFree && !bannerDismissed && (
        <div
          className="mb-5 flex items-center justify-between gap-4 rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--rt-accent)", background: "var(--rt-accent-soft)" }}
        >
          <p className="m-0 text-sm">
            <span className="font-semibold">Free plan:</span> the three newest races are
            open. Pro opens every race and every recap.
          </p>
          <div className="flex shrink-0 items-center gap-2.5">
            <Link
              to="/settings/billing"
              className="rounded-md bg-[var(--rt-accent)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--rt-on-accent)]"
            >
              See Pro
            </Link>
            <button
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss"
              className="px-1 text-xl leading-none text-[var(--rt-text-muted)]"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-5">
        {/* Latest races */}
        <main className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
          {/* Your car (the peak moment), then the first steps until they are done. */}
          {myCar?.car && (
            <section aria-labelledby="your-car" className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <h2 id="your-car" className="m-0 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--rt-text-muted)]">
                  {myCar.carCount > 1 ? "Your cars' latest race" : "Your car"}
                </h2>
                <Link to="/settings/cars" className="text-[13px] text-[var(--rt-accent)]">
                  My cars →
                </Link>
              </div>
              <MyCarCard data={myCar} />
            </section>
          )}
          <FirstStepsChecklist data={myCar} />

          <div className={`flex items-baseline justify-between ${myCar?.car ? "mt-4" : ""}`}>
            <h2 className="m-0 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--rt-text-muted)]">
              Latest races
            </h2>
            <Link to="/races" className="text-[13px] text-[var(--rt-accent)]">
              All events →
            </Link>
          </div>

          {events === null ? (
            <>
              <div className="h-72 animate-pulse rounded-xl bg-[var(--rt-surface)]" />
              <div className="h-40 animate-pulse rounded-xl bg-[var(--rt-surface)]" />
            </>
          ) : events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--rt-border)] p-10 text-center">
              {failed ? (
                <p className="m-0 text-[var(--rt-text-secondary)]">
                  The latest races could not be loaded. Refresh to try again.
                </p>
              ) : (
                <>
                  <h2 className="mb-2 text-xl font-semibold">Welcome to RaceTrace</h2>
                  <p className="mx-auto mb-5 max-w-md text-[var(--rt-text-secondary)]">
                    Race data will appear here as it becomes available.
                  </p>
                  <Link
                    to="/races"
                    className="rounded-md bg-[var(--rt-accent)] px-4 py-2 text-sm font-semibold text-[var(--rt-on-accent)]"
                  >
                    Browse events
                  </Link>
                </>
              )}
            </div>
          ) : (
            <>
              {cards.map((ev, i) => (
                <RecapCard
                  key={ev.key}
                  event={ev}
                  variant={i === 0 ? "hero" : "compact"}
                />
              ))}
              <InstallHint />
              {earlier.length > 0 && (
                <section aria-labelledby="earlier-races" className="mt-4 flex flex-col gap-3">
                  <h2 id="earlier-races" className="m-0 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--rt-text-muted)]">
                    Earlier races
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {earlier.map((ev) => (
                      <RecapCard key={ev.key} event={ev} variant="mini" />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {/* Favorites */}
          <section className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[var(--rt-border)] px-5 py-3 text-[var(--rt-text-muted)]">
            <span className="text-[13px] font-semibold uppercase tracking-[0.1em]">
              Favorites
            </span>
            {favorites.length ? (
              favorites.map((f) => (
                <Link
                  key={f.id}
                  to={`/chart?race=${f.id}`}
                  className="rounded-md border border-[var(--rt-border)] px-2.5 py-1 text-[13px] text-[var(--rt-text)]"
                >
                  ★ {f.name} · {f.track}
                </Link>
              ))
            ) : (
              <span className="text-[13px]">Star a race to keep it here.</span>
            )}
          </section>
        </main>

        {/* Season */}
        <div className="min-w-0 flex-[1_1_340px]">
          <SeasonPanel data={season} />
          <div className="mt-4">
            <SupportCard />
          </div>
        </div>
      </div>
    </div>
  );
}

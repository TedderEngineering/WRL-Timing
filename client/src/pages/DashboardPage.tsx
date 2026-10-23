import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Alert } from "../components/Alert";
import { api } from "../lib/api";
import { hasFullAccess } from "../lib/utils";
import { RecapCard } from "../features/dashboard/RecapCard";
import { InstallHint } from "../features/dashboard/InstallHint";
import { ShareRaceTraceButton } from "../features/share/ShareRaceTrace";
import { FirstStepsChecklist, MyCarCard, type MyCarResponse } from "../features/dashboard/MyCarCard";
import { SeasonRecapCard, type SeasonRecap } from "../features/dashboard/SeasonRecapCard";
import { CarTabs } from "../features/dashboard/CarTabs";
import { DriverTabs, MyDriverCard, type MyDriverResponse } from "../features/dashboard/MyDriverCard";
import { readUi, writeUi } from "../features/dashboard/ui-state";
import { reorderCars } from "../features/my-cars/api";
import { reorderDrivers } from "../features/my-drivers/api";
import { NextUp, SeasonPanel, nextFor } from "../features/dashboard/SeasonPanel";
import { LiveDemoCard } from "../features/live/LiveDemoCard";
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
  const [recaps, setRecaps] = useState<SeasonRecap[]>([]);
  // The car tab chosen; null shows the newest race of any car.
  const [carChoice, setCarChoice] = useState<string | null>(null);
  const chooseCar = useCallback(async (id: string) => {
    setCarChoice(id);
    try {
      setMyCar(await api.get<MyCarResponse>(`/dashboard/my-car?car=${encodeURIComponent(id)}`));
    } catch {
      // keep what is shown
    }
  }, []);
  const [myDriver, setMyDriver] = useState<MyDriverResponse | null>(null);
  const [driverChoice, setDriverChoice] = useState<string | null>(null);
  const chooseDriver = useCallback(async (id: string) => {
    setDriverChoice(id);
    try {
      setMyDriver(await api.get<MyDriverResponse>(`/dashboard/my-driver?driver=${encodeURIComponent(id)}`));
    } catch {
      // keep what is shown
    }
  }, []);
  // One of the car's races on the card (null: the latest).
  const [pickingCarRace, setPickingCarRace] = useState<string | null>(null);
  const pickCarRace = useCallback(async (carId: string, raceId: string | null) => {
    setPickingCarRace(raceId ?? "latest");
    try {
      const q = `car=${encodeURIComponent(carId)}${raceId ? `&race=${encodeURIComponent(raceId)}` : ""}`;
      setMyCar(await api.get<MyCarResponse>(`/dashboard/my-car?${q}`));
    } catch {
      // keep what is shown
    } finally {
      setPickingCarRace(null);
    }
  }, []);
  // One of the driver's races on the card (null: the latest).
  const [pickingRace, setPickingRace] = useState<string | null>(null);
  const pickDriverRace = useCallback(async (driverId: string, raceId: string | null) => {
    setPickingRace(raceId ?? "latest");
    try {
      const q = `driver=${encodeURIComponent(driverId)}${raceId ? `&race=${encodeURIComponent(raceId)}` : ""}`;
      setMyDriver(await api.get<MyDriverResponse>(`/dashboard/my-driver?${q}`));
    } catch {
      // keep what is shown
    } finally {
      setPickingRace(null);
    }
  }, []);
  // Hold and drag a tab to reorder: shown at once, saved to the account.
  const orderCars = (ids: string[]) => {
    setMyCar((m) => (m?.cars ? { ...m, cars: ids.map((id) => m.cars!.find((c) => c.id === id)!).filter(Boolean) } : m));
    reorderCars(ids).catch(() => undefined);
  };
  const orderDrivers = (ids: string[]) => {
    setMyDriver((m) => (m ? { ...m, drivers: ids.map((id) => m.drivers.find((d) => d.id === id)!).filter(Boolean) } : m));
    reorderDrivers(ids).catch(() => undefined);
  };
  // Cars or drivers, when the user follows both (remembered in this browser).
  const [yours, setYours] = useState<"cars" | "drivers">(() => readUi().yoursTab ?? "cars");
  const chooseYours = (v: "cars" | "drivers") => {
    setYours(v);
    writeUi({ yoursTab: v });
  };
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Your car and your driver arrive together (the tabs between them need both).
  const [yoursLoaded, setYoursLoaded] = useState(false);
  const [hadYours] = useState(() => !!readUi().hadYours);

  // Each part shows as soon as its own request answers: a slow one (a season recap, the
  // latest races after a deploy) never holds up the rest of the page.
  useEffect(() => {
    let alive = true;
    const load = <T,>(path: string, ok: (v: T) => void, fail?: () => void) =>
      api.get<T>(path).then(
        (v) => alive && ok(v),
        () => alive && fail?.()
      );
    load<{ events: LatestEvent[] }>("/dashboard/latest?limit=10", (v) => setEvents(v.events), () => {
      setEvents([]);
      setFailed(true);
    });
    load<SeasonResponse>("/dashboard/season", setSeason);
    load<{ races: RaceItem[] }>("/races/recently-viewed?limit=1", (v) => setRecent(v.races));
    load<{ races: RaceItem[] }>("/races/favorites?limit=8", (v) => setFavorites(v.races));
    load<{ recaps: SeasonRecap[] }>("/dashboard/season-recap", (v) => setRecaps(v.recaps));
    let car: MyCarResponse | null = null;
    let driver: MyDriverResponse | null = null;
    Promise.allSettled([
      load<MyCarResponse>("/dashboard/my-car", (v) => (car = v)),
      load<MyDriverResponse>("/dashboard/my-driver", (v) => (driver = v)),
    ]).then(() => {
      if (!alive) return;
      setMyCar(car);
      setMyDriver(driver);
      setYoursLoaded(true);
      writeUi({ hadYours: !!(car as MyCarResponse | null)?.car || !!(driver as MyDriverResponse | null)?.driver });
    });
    return () => {
      alive = false;
    };
  }, []);

  const isFree = !hasFullAccess(user);
  // With car tabs, the recaps follow the car shown.
  const hasCars = !!myCar?.car;
  const hasDrivers = !!myDriver?.driver;
  // Followed cars and drivers share one place: two tabs at the top when there are both.
  const view: "cars" | "drivers" | null = hasCars && hasDrivers ? yours : hasCars ? "cars" : hasDrivers ? "drivers" : null;
  const shownCarId = myCar?.car?.id ?? null;
  const shownRecaps = (myCar?.cars?.length ?? 0) > 1 && shownCarId ? recaps.filter((r) => !r.carId || r.carId === shownCarId) : recaps;

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
      {/* With no race live: the live timing demo, beside the next round (wide screens: the season column). */}
      <div className="mb-5 lg:hidden">
        <LiveDemoCard />
      </div>

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
          {!yoursLoaded && hadYours && (
            <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Loading your car">
              <div className="h-8 w-48 animate-pulse rounded-md bg-[var(--rt-surface)]" />
              <div className="h-56 animate-pulse rounded-xl bg-[var(--rt-surface)]" />
            </div>
          )}
          {view && (
            <section aria-labelledby="yours" className="flex flex-col gap-2.5">
              {/* One row: cars or drivers (when both), the car or driver tabs, the settings link. */}
              <div className="flex flex-wrap items-end gap-x-3 border-b border-[var(--rt-border)]">
                {hasCars && hasDrivers ? (
                  <div id="yours" role="tablist" aria-label="Yours" className="mb-1.5 flex shrink-0 gap-0.5 rounded-md bg-[var(--rt-surface)] p-0.5">
                    {(
                      [
                        ["cars", myCar!.carCount > 1 ? "Cars" : "Car"],
                        ["drivers", myDriver!.driverCount > 1 ? "Drivers" : "Driver"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={view === key}
                        onClick={() => chooseYours(key)}
                        className={`min-h-[30px] rounded px-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] ${
                          view === key ? "bg-[var(--rt-border)] text-[var(--rt-text)]" : "text-[var(--rt-text-muted)] hover:text-[var(--rt-text)]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <h2 id="yours" className="m-0 mb-2.5 shrink-0 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--rt-text-muted)]">
                    {view === "cars" ? (myCar!.carCount > 1 ? "Your cars" : "Your car") : myDriver!.driverCount > 1 ? "Your drivers" : "Your driver"}
                  </h2>
                )}
                <div className="order-last min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">
                  {view === "cars" ? (
                    <CarTabs cars={myCar!.cars ?? []} active={carChoice ?? myCar!.car!.id} onChoose={chooseCar} onReorder={orderCars} className="" />
                  ) : (
                    <DriverTabs drivers={myDriver!.drivers} active={driverChoice ?? myDriver!.driver!.id} onChoose={chooseDriver} onReorder={orderDrivers} className="" />
                  )}
                </div>
                <Link to={view === "cars" ? "/settings/cars" : "/settings/drivers"} className="mb-2.5 ml-auto shrink-0 text-[13px] text-[var(--rt-accent)]">
                  {view === "cars" ? "My cars →" : "My drivers →"}
                </Link>
              </div>
              {view === "cars" ? <MyCarCard data={myCar!} ask={shownRecaps.length === 0} onPickRace={(raceId) => void pickCarRace(myCar!.car!.id, raceId)} picking={pickingCarRace} /> : <MyDriverCard data={myDriver!} onPickRace={(raceId) => void pickDriverRace(myDriver!.driver!.id, raceId)} picking={pickingRace} />}
            </section>
          )}
          {/* "Your 2026", series by series as each season ends (plan H), for the car shown. */}
          {view !== "drivers" &&
            shownRecaps.map((r, i) => <SeasonRecapCard key={r.key} recap={r} ask={i === 0} />)}
          <FirstStepsChecklist data={myCar} driver={myDriver} />

          <div className={`flex items-baseline justify-between ${view ? "mt-4" : ""}`}>
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
          {/* One quiet line, never a pop-up. */}
          <p className="m-0 mt-2.5 px-1 text-[13px] text-[var(--rt-text-muted)]">
            It&apos;s free for your teammates too.{" "}
            <ShareRaceTraceButton source="dashboard" className="font-semibold text-[var(--rt-accent)]" />
          </p>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Weekend, WeekendRace, WeekendsResponse } from "@shared/types";
import { fetchWeekends } from "../lib/api";
import { SearchBar } from "../components/SearchBar";
import { useAuth } from "../features/auth/AuthContext";
import { cn } from "../lib/utils";
import { SeriesBadge } from "../components/SeriesBadge";
import { dayName, formatDateRange } from "../lib/race-dates";
import { DriverResults, useDriverSearch } from "../features/races/DriverResults";
import { CarResults, useCarSearch, useMyCarsList } from "../features/my-cars/CarSearch";
import { useMyCarRaceIds } from "../features/my-cars/myCarRaces";
import { useIsCompact } from "../lib/breakpoint";

const SCOPE_KEY = "rt.eventsScope";
function readScope(): "mine" | "all" | null {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    return v === "mine" || v === "all" ? v : null;
  } catch {
    return null;
  }
}

type Family = WeekendRace["family"];

const FAMILIES: Family[] = ["IMSA", "SRO", "GR Cup", "WRL", "Other"];

/** The site's one series badge (logo where the series has one), as on every other page. */
function FamilyBadge({ family }: { family: Family }) {
  return <SeriesBadge series={family === "Other" ? "Other" : family} size="sm" />;
}

function matches(w: Weekend, q: string): boolean {
  if (!q) return true;
  const hay = [w.track, w.title ?? "", ...w.races.flatMap((r) => [r.championship ?? "", r.title, r.name, r.family])]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

export function RaceListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [data, setData] = useState<WeekendsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ?q= opens the page searched (the Dashboard's "All of a driver's races").
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [season, setSeason] = useState<string>("all");
  const [families, setFamilies] = useState<Set<Family>>(new Set());
  // The same box finds drivers: every race they ran (features/races/DriverResults).
  const { drivers, loading: driversLoading } = useDriverSearch(query);
  // And cars, by number or team.
  const { cars, loading: carsLoading } = useCarSearch(query);
  // Phones (mobile redesign, step 6): All / My cars, opening on My cars for someone who follows
  // a car (the choice is remembered in this browser).
  const compact = useIsCompact();
  const myCars = useMyCarsList(user?.id);
  const myRaceIds = useMyCarRaceIds(compact ? myCars : null);
  const canScope = compact && !!myCars?.length;
  const [scopePick, setScopePick] = useState<"mine" | "all" | null>(() => readScope());
  const scope: "mine" | "all" = canScope ? (scopePick ?? "mine") : "all";
  const pickScope = (v: "mine" | "all") => {
    setScopePick(v);
    try {
      localStorage.setItem(SCOPE_KEY, v);
    } catch {
      /* private window */
    }
  };

  useEffect(() => {
    let alive = true;
    fetchWeekends()
      .then((d) => alive && setData(d))
      .catch(() => alive && setError("The events could not be loaded. Check your connection and reload the page."));
    return () => {
      alive = false;
    };
  }, [user?.role]);

  const weekends = data?.weekends ?? [];
  const seasons = useMemo(() => [...new Set(weekends.map((w) => w.season))].sort().reverse(), [weekends]);
  const present = useMemo(() => FAMILIES.filter((f) => weekends.some((w) => w.families.includes(f))), [weekends]);

  // Series chips narrow each weekend to those races; a weekend with none left is hidden.
  const shown = useMemo(() => {
    return weekends
      .filter((w) => season === "all" || w.season === season)
      .map((w) => (families.size === 0 ? w : { ...w, races: w.races.filter((r) => families.has(r.family)) }))
      .map((w) => (scope === "mine" && myRaceIds ? { ...w, races: w.races.filter((r) => myRaceIds.has(r.id)) } : w))
      .filter((w) => w.races.length > 0 && matches(w, query.trim()));
  }, [weekends, season, families, query, scope, myRaceIds]);

  // One section per season; race weekends are weeks apart, so months would be one card each.
  const bySeason = useMemo(() => {
    const groups: { season: string; weekends: Weekend[] }[] = [];
    for (const w of shown) {
      const last = groups[groups.length - 1];
      if (last?.season === w.season) last.weekends.push(w);
      else groups.push({ season: w.season, weekends: [w] });
    }
    return groups;
  }, [shown]);

  // My cars, while their races are being looked up: the skeleton, not every race for a moment.
  const loadingMine = scope === "mine" && myRaceIds === null;
  const raceCount = shown.reduce((n, w) => n + w.races.length, 0);
  const filtered = query !== "" || season !== "all" || families.size > 0;

  const toggleFamily = (f: Family) =>
    setFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  return (
    <div className="container-page py-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50 lg:text-3xl">Events</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Every race weekend on RaceTrace, newest first.</p>
        </div>
        {data && (
          <p className="text-sm tabular-nums text-gray-500 dark:text-gray-400">
            {shown.length} weekend{shown.length === 1 ? "" : "s"} · {raceCount} race{raceCount === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {canScope && (
        <div role="tablist" aria-label="Which races" className="mb-3 grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: "var(--rt-surface)" }} data-phone-events="scope">
          {(
            [
              ["mine", myCars!.length > 1 ? "My cars" : "My car"],
              ["all", "All races"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={scope === k}
              onClick={() => pickScope(k)}
              className="min-h-[44px] rounded-md text-[14px] font-semibold"
              style={scope === k ? { background: "var(--rt-accent)", color: "var(--rt-on-accent)" } : { color: "var(--rt-text-muted)" }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="mb-8 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchBar value={query} onChange={setQuery} isSearching={driversLoading || carsLoading} placeholder="Search tracks, races, drivers or car numbers..." className="lg:max-w-md lg:flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Season" className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-800">
            {["all", ...seasons].map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={season === s}
                onClick={() => setSeason(s)}
                className={cn(
                  "min-h-[44px] rounded-md px-3 text-sm transition-colors sm:min-h-0 sm:py-1",
                  season === s ? "bg-brand-500 font-semibold text-gray-950" : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                )}
              >
                {s === "all" ? "All seasons" : s}
              </button>
            ))}
          </div>
          {present.map((f) => {
            const on = families.has(f);
            return (
              <button
                key={f}
                onClick={() => toggleFamily(f)}
                aria-pressed={on}
                aria-label={f}
                title={f}
                className={cn(
                  "inline-flex min-h-[44px] items-center rounded-full border px-3 transition-colors sm:min-h-0 sm:px-2.5 sm:py-1",
                  on
                    ? "border-brand-500 bg-brand-500/15"
                    : "border-gray-200 opacity-70 hover:opacity-100 dark:border-gray-800"
                )}
              >
                <FamilyBadge family={f} />
              </button>
            );
          })}
          {filtered && (
            <button
              onClick={() => {
                setQuery("");
                setSeason("all");
                setFamilies(new Set());
              }}
              className="min-h-[44px] px-2 text-sm text-brand-500 hover:text-brand-400 sm:min-h-0"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <p className="py-16 text-center text-red-500">{error}</p>}
      {(!data || loadingMine) && !error && <Skeleton />}
      <CarResults cars={cars} />
      <DriverResults drivers={drivers} />

      {data && !loadingMine && shown.length === 0 && drivers.length === 0 && cars.length === 0 && (
        <p className="py-16 text-center text-gray-500 dark:text-gray-400">
          {scope === "mine" && !filtered ? "None of your cars' races are on RaceTrace yet. " : "No race weekends match. "}
          {scope === "mine" && (
            <button className="min-h-[44px] text-brand-500 hover:underline" onClick={() => pickScope("all")}>
              Show all races
            </button>
          )}{" "}
          {filtered && (
            <button className="text-brand-500 hover:underline" onClick={() => { setQuery(""); setSeason("all"); setFamilies(new Set()); }}>
              Clear the filters
            </button>
          )}
        </p>
      )}

      <div className="space-y-10">
        {!loadingMine && bySeason.map((g) => (
          <section key={g.season} aria-labelledby={`s-${g.season}`}>
            <h2 id={`s-${g.season}`} className="mb-3 flex items-baseline gap-2 text-lg font-bold text-gray-900 dark:text-gray-100">
              {g.season}
              <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                {g.weekends.length} weekend{g.weekends.length === 1 ? "" : "s"}
              </span>
            </h2>
            <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.weekends.map((w) => (
                <WeekendCard key={w.key} weekend={w} isAdmin={isAdmin} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {isAdmin && data && data.emptyEvents.length > 0 && (
        <section className="mt-12 rounded-xl border border-dashed border-gray-300 p-4 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Empty events (admin only)</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Events with no races. They are hidden from everyone else.</p>
          <ul className="mt-3 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            {data.emptyEvents.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="rounded border border-gray-400/40 px-1.5 text-[10px] uppercase leading-5">Empty</span>
                <span>{e.name}</span>
                <span className="text-gray-400 dark:text-gray-500">{formatDateRange(e.date, e.date)} · {e.id}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function WeekendCard({ weekend: w, isAdmin }: { weekend: Weekend; isAdmin: boolean }) {
  const multiDay = w.startDate !== w.endDate;
  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/60">
      <header className="px-4 pb-2 pt-3.5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-bold leading-snug text-gray-900 dark:text-gray-50">{w.track}</h3>
          <div className="flex shrink-0 gap-1 pt-0.5">
            {w.families.map((f) => (
              <FamilyBadge key={f} family={f} />
            ))}
          </div>
        </div>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          <span className="tabular-nums">{formatDateRange(w.startDate, w.endDate)}</span>
          {w.title && <span> · {w.title}</span>}
        </p>
      </header>
      <ul className="border-t border-gray-100 dark:border-gray-800/80">
        {w.races.map((r) => (
          <li key={r.id}>
            <Link
              to={r.eventId ? `/chart?event=${r.eventId}&race=${r.id}` : `/chart?race=${r.id}`}
              className="group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none dark:hover:bg-white/[0.04] dark:focus-visible:bg-white/[0.04]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  {r.championship && (
                    <span className="truncate text-xs text-gray-500 dark:text-gray-400">{r.championship}</span>
                  )}
                  <span className="truncate text-sm font-medium text-gray-800 group-hover:text-brand-500 dark:text-gray-200">
                    {r.title}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-500">
                  {multiDay && <span>{dayName(r.date)}</span>}
                  {r.cars !== null && <span className="tabular-nums">{r.cars} cars</span>}
                  {r.laps !== null && r.laps > 0 && <span className="tabular-nums">{r.laps} laps</span>}
                  {r.resultsStatus === "provisional" && (
                    <span className="rounded border border-amber-400/50 px-1 text-amber-300">Provisional</span>
                  )}
                  {r.hasStory && <span className="rounded border border-brand-500/50 px-1 text-brand-400">Story</span>}
                  {isAdmin && r.status === "DRAFT" && (
                    <span className="rounded border border-gray-400/50 px-1 text-gray-400">Draft</span>
                  )}
                </div>
              </div>
              <svg aria-hidden className="h-3.5 w-3.5 shrink-0 text-gray-400 group-hover:text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="h-5 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="h-9 animate-pulse rounded bg-gray-100 dark:bg-gray-800/60" />
          <div className="h-9 animate-pulse rounded bg-gray-100 dark:bg-gray-800/60" />
        </div>
      ))}
    </div>
  );
}

/**
 * Car search (server: GET /api/search/cars): find a car by number or team, with every published
 * race it ran. Following one from a result follows it as of its newest race (series, number, team,
 * class and season), the same as Follow on that race's page.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { track } from "../../lib/analytics";
import { formatDateRange } from "../../lib/race-dates";
import { useOptionalAuth } from "../auth/AuthContext";
import { followCar, listCars, removeCar, SERIES_LABEL, type MyCar, type SeriesFamily } from "./api";
import type { DriverRace } from "../races/DriverResults";

export interface CarResult {
  series: SeriesFamily;
  number: string;
  team: string;
  carClass: string;
  races: DriverRace[];
}

/** Cars matching the query, after a short pause in typing: a number ("67") or 3+ letters of a team. */
export function useCarSearch(query: string): { cars: CarResult[]; loading: boolean } {
  const [cars, setCars] = useState<CarResult[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const q = query.trim();
    const isNumber = /^#?\d[0-9A-Za-z]{0,7}$/.test(q);
    if (!isNumber && q.replace(/\s/g, "").length < 3) {
      setCars([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get<{ cars: CarResult[] }>(`/search/cars?q=${encodeURIComponent(q)}`)
        .then((r) => alive && setCars(r.cars ?? []))
        .catch(() => alive && setCars([]))
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);
  return { cars, loading };
}

// ─── The user's cars, shared on the page ─────────────────────────────────────

let mine: MyCar[] | null = null;
let owner: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (next: MyCar[]) => {
  mine = next;
  listeners.forEach((l) => l());
};

export function loadMyCars(userId: string, force = false): Promise<void> {
  if (owner !== userId) {
    owner = userId;
    mine = null;
    loading = null;
  }
  if (loading && !force) return loading;
  loading = listCars()
    .then((r) => {
      if (owner === userId) set(r.cars);
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/** The signed-in user's cars; null until loaded, and when signed out. */
export function useMyCarsList(userId: string | null | undefined): MyCar[] | null {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => mine
  );
  useEffect(() => {
    if (userId) void loadMyCars(userId);
  }, [userId]);
  return userId && owner === userId ? list : null;
}

const norm = (n: string) => (/^\d+$/.test(n.trim()) ? String(Number(n)) : n.trim().toUpperCase());
const teamKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The user's car that is this result (as the server's carMatchesEntry), if any. */
export function followedCar(list: MyCar[] | null, c: CarResult): MyCar | null {
  return (
    list?.find((m) => {
      if (m.series !== c.series || norm(m.number) !== norm(c.number)) return false;
      if (!m.teamName || !teamKey(m.teamName)) return true;
      const a = teamKey(m.teamName);
      const b = teamKey(c.team);
      return !!b && (a === b || a.includes(b) || b.includes(a));
    }) ?? null
  );
}

/** + Follow / ✓ Following for a search result (signed in only). */
export function FollowCarResult({ car, source, onChange }: { car: CarResult; source: string; onChange?: () => void }) {
  const auth = useOptionalAuth();
  const userId = auth?.user?.id;
  const list = useMyCarsList(userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!userId || list === null) return null;
  const f = followedCar(list, car);
  const latest = car.races[0];
  return (
    <span className="inline-flex shrink-0 flex-col items-end">
      <button
        type="button"
        aria-pressed={!!f}
        aria-label={f ? `Stop following #${car.number}` : `Follow #${car.number} ${car.team}`}
        disabled={busy || !latest}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            if (f) {
              await removeCar(f.id);
              set(list.filter((x) => x.id !== f.id));
            } else {
              const r = await followCar(latest.raceId, latest.carNumber);
              if (!list.some((x) => x.id === r.car.id)) set([...list, r.car]);
              if (r.created) track("follow_car", { series: r.car.series, source });
                          }
            onChange?.();
          } catch (e) {
            setError(e instanceof Error ? e.message : "That did not work. Try again.");
          } finally {
            setBusy(false);
          }
        }}
        className={`min-h-[32px] rounded-full border px-2.5 text-xs font-semibold disabled:opacity-50 ${
          f
            ? "border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300"
            : "border-gray-300 text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        }`}
      >
        {f ? "✓ Following" : "+ Follow"}
      </button>
      {error && (
        <span role="alert" className="mt-1 max-w-[220px] text-right text-[11px] text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}

/** "12 races · latest Fox Factory 120, Oct 2 · GS" */
export function carResultLine(c: CarResult): string {
  const r = c.races[0];
  return [`${c.races.length} race${c.races.length === 1 ? "" : "s"}`, r ? `latest ${r.raceName}, ${formatDateRange(r.date, r.date)}` : null, c.carClass]
    .filter(Boolean)
    .join(" · ");
}

/** A compact list of matching cars with Follow (Settings, onboarding). */
export function CarResultList({ cars, source, limit = 8, onChange }: { cars: CarResult[]; source: string; limit?: number; onChange?: () => void }) {
  if (cars.length === 0) return null;
  return (
    <ul className="m-0 list-none divide-y divide-gray-200 rounded-lg border border-gray-200 p-0 text-left dark:divide-gray-800 dark:border-gray-800">
      {cars.slice(0, limit).map((c) => (
        <li key={`${c.series}|${c.number}|${c.team}`} className="flex items-center gap-3 px-3 py-2">
          <span className="w-10 shrink-0 rounded border border-gray-300 px-1 text-center text-[11px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-300">
            {SERIES_LABEL[c.series] ?? c.series}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              #{c.number} {c.team}
            </div>
            <div className="truncate text-xs text-gray-500 dark:text-gray-400">{carResultLine(c)}</div>
          </div>
          <FollowCarResult car={c} source={source} onChange={onChange} />
        </li>
      ))}
    </ul>
  );
}

const SHOWN = 6;

/** "Cars" on the Events page: each matching car and its races, newest first (beside "Drivers"). */
export function CarResults({ cars }: { cars: CarResult[] }) {
  if (cars.length === 0) return null;
  return (
    <section aria-labelledby="cars-h" className="mb-10">
      <h2 id="cars-h" className="mb-3 flex items-baseline gap-2 text-lg font-bold text-gray-900 dark:text-gray-100">
        Cars
        <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
          {cars.length} match{cars.length === 1 ? "" : "es"}
        </span>
      </h2>
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cars.map((c) => (
          <CarCard key={`${c.series}|${c.number}|${c.team}`} car={c} />
        ))}
      </div>
    </section>
  );
}

function CarCard({ car: c }: { car: CarResult }) {
  const [all, setAll] = useState(false);
  const races = all ? c.races : c.races.slice(0, SHOWN);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate font-semibold text-gray-900 dark:text-gray-100">
          #{c.number} {c.team}
        </h3>
        <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
          {SERIES_LABEL[c.series] ?? c.series} · {c.races.length} race{c.races.length === 1 ? "" : "s"}
        </span>
        <FollowCarResult car={c} source="search" />
      </div>
      <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
        {races.map((r) => (
          <li key={r.raceId}>
            <Link to={`/chart?race=${r.raceId}&car=${encodeURIComponent(r.carNumber)}`} className="flex min-h-[44px] items-center gap-3 py-1.5 text-sm hover:text-brand-500">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-gray-900 dark:text-gray-100">{r.raceName}</span>
                <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                  {formatDateRange(r.date, r.date)} · {r.carClass}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-gray-300">
                {r.finishPosClass && r.finishPosClass < 900 ? `P${r.finishPosClass} in ${r.carClass}` : r.finishPos && r.finishPos < 900 ? `P${r.finishPos} overall` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {c.races.length > SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 min-h-[36px] text-sm text-brand-500 hover:text-brand-400">
          {all ? "Show fewer" : `Show all ${c.races.length}`}
        </button>
      )}
    </div>
  );
}

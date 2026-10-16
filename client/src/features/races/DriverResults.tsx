import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { formatDateRange } from "../../lib/race-dates";
import { useAuth } from "../auth/AuthContext";
import { track } from "../../lib/analytics";
import { followDriver, followedAs, unfollowDriver, useMyDrivers } from "../my-drivers/api";

export interface DriverRace {
  raceId: string;
  raceName: string;
  date: string;
  track: string;
  series: string;
  carNumber: string;
  teamName: string;
  carClass: string;
  finishPos: number | null;
  finishPosClass: number | null;
}
export interface DriverResult {
  name: string;
  races: DriverRace[];
}

/** Drivers whose name matches the Events search, after a short pause in typing (server: /search/drivers). */
export function useDriverSearch(query: string): { drivers: DriverResult[]; loading: boolean } {
  const [drivers, setDrivers] = useState<DriverResult[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.replace(/\s/g, "").length < 3) {
      setDrivers([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get<{ drivers: DriverResult[] }>(`/search/drivers?q=${encodeURIComponent(q)}`)
        .then((r) => alive && setDrivers(r.drivers ?? []))
        .catch(() => alive && setDrivers([]))
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);
  return { drivers, loading };
}

const SHOWN = 6;

export function driverRaceResult(r: DriverRace): string {
  if (r.finishPosClass && r.finishPosClass < 900) return `P${r.finishPosClass} in ${r.carClass}`;
  if (r.finishPos && r.finishPos < 900) return `P${r.finishPos} overall`;
  return r.carClass;
}

/** "Drivers" on the Events page: each matching driver and every race they ran, newest first. */
export function DriverResults({ drivers }: { drivers: DriverResult[] }) {
  if (drivers.length === 0) return null;
  return (
    <section aria-labelledby="drivers-h" className="mb-10">
      <h2 id="drivers-h" className="mb-3 flex items-baseline gap-2 text-lg font-bold text-gray-900 dark:text-gray-100">
        Drivers
        <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
          {drivers.length} match{drivers.length === 1 ? "" : "es"}
        </span>
      </h2>
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {drivers.map((d) => (
          <DriverCard key={d.name} driver={d} />
        ))}
      </div>
    </section>
  );
}

/** Follow from the search results (signed in): the driver's latest race then shows on the Dashboard. */
function FollowDriver({ name }: { name: string }) {
  const { user } = useAuth();
  const mine = useMyDrivers(user?.id);
  const [busy, setBusy] = useState(false);
  if (!user || mine === null) return null;
  const f = followedAs(mine, name);
  return (
    <button
      type="button"
      aria-pressed={!!f}
      aria-label={f ? `Stop following ${name}` : `Follow ${name}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          if (f) await unfollowDriver(f.id);
          else if ((await followDriver(name)).created) track("follow_driver", { source: "search" });
        } catch {
          // the button stays as it was; they can try again
        } finally {
          setBusy(false);
        }
      }}
      className={`min-h-[32px] shrink-0 rounded-full border px-2.5 text-xs font-semibold disabled:opacity-50 ${
        f
          ? "border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300"
          : "border-gray-300 text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
      }`}
    >
      {f ? "✓ Following" : "+ Follow"}
    </button>
  );
}

function DriverCard({ driver: d }: { driver: DriverResult }) {
  const [all, setAll] = useState(false);
  const races = all ? d.races : d.races.slice(0, SHOWN);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate font-semibold text-gray-900 dark:text-gray-100">{d.name}</h3>
        <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
          {d.races.length} race{d.races.length === 1 ? "" : "s"}
        </span>
        <FollowDriver name={d.name} />
      </div>
      <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
        {races.map((r) => (
          <li key={r.raceId}>
            <Link
              to={`/chart?race=${r.raceId}&car=${encodeURIComponent(r.carNumber)}`}
              className="flex min-h-[44px] items-center gap-3 py-1.5 text-sm hover:text-brand-500"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-gray-900 dark:text-gray-100">{r.raceName}</span>
                <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                  {formatDateRange(r.date, r.date)} · #{r.carNumber} {r.teamName}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-gray-300">{driverRaceResult(r)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {d.races.length > SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 min-h-[36px] text-sm text-brand-500 hover:text-brand-400">
          {all ? "Show fewer" : `Show all ${d.races.length}`}
        </button>
      )}
    </div>
  );
}

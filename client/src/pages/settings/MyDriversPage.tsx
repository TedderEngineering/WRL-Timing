import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import { track } from "../../lib/analytics";
import { useDriverSearch, type DriverResult } from "../../features/races/DriverResults";
import { MAX_DRIVERS, followDriver, followedAs, setDriverAlerts, unfollowDriver, useMyDrivers } from "../../features/my-drivers/api";

/** "9 races · latest Indianapolis 8 Hour, Sep 27 · #23 GT3 · SRO, WRL" */
function resultLine(d: DriverResult): string {
  const r = d.races[0];
  const series = [...new Set(d.races.map((x) => x.series))].join(", ");
  const when = r ? new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";
  return [`${d.races.length} race${d.races.length === 1 ? "" : "s"}`, r ? `latest ${r.raceName}, ${when} · #${r.carNumber} ${r.carClass}` : null, series]
    .filter(Boolean)
    .join(" · ");
}

/** Settings › My drivers: find a driver to follow, and the drivers followed, each with its race-email switch. */
export function MyDriversPage() {
  const { user } = useAuth();
  const drivers = useMyDrivers(user?.id);
  const [query, setQuery] = useState("");
  const { drivers: found, loading } = useDriverSearch(query);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const full = (drivers?.length ?? 0) >= MAX_DRIVERS;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">My drivers</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Follow a driver to see their latest race on your <Link to="/dashboard" className="text-brand-600 underline dark:text-brand-400">Dashboard</Link>,
          whatever car or series they race in. You can also follow one from the <b>Drivers</b> list beside any race&apos;s chart.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="driver-search" className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
          Find a driver
        </label>
        <input
          id="driver-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="At least 3 letters of their name"
          autoComplete="off"
          className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-[15px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
        {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Searching…</p>}
        {!loading && query.trim().length >= 3 && found.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">No driver called &ldquo;{query.trim()}&rdquo; in a race on RaceTrace.</p>
        )}
        {found.length > 0 && (
          <ul className="m-0 list-none divide-y divide-gray-200 rounded-lg border border-gray-200 p-0 dark:divide-gray-800 dark:border-gray-800">
            {found.slice(0, 8).map((d) => {
              const f = followedAs(drivers, d.name);
              return (
                <li key={d.name} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{d.name}</div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">{resultLine(d)}</div>
                  </div>
                  <button
                    type="button"
                    aria-pressed={!!f}
                    disabled={busy === d.name || (!f && full) || drivers === null}
                    onClick={() =>
                      run(d.name, async () => {
                        if (f) await unfollowDriver(f.id);
                        else {
                          const r = await followDriver(d.name);
                          if (r.created) track("follow_driver", { source: "settings" });
                        }
                      })
                    }
                    className={`min-h-[36px] shrink-0 rounded-full border px-3 text-[13px] font-semibold disabled:opacity-50 ${
                      f
                        ? "border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300"
                        : "border-gray-300 text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                    }`}
                  >
                    {f ? "✓ Following" : "+ Follow"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">Following{drivers ? ` · ${drivers.length}` : ""}</h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">Up to {MAX_DRIVERS} drivers</span>
        </div>
        {drivers === null ? (
          <div className="h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-900" />
        ) : drivers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-5 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
            No drivers yet. Search above, or press <b>Follow</b> next to a driver beside any race&apos;s chart.
          </div>
        ) : (
          <ul className="m-0 list-none divide-y divide-gray-200 rounded-lg border border-gray-200 p-0 dark:divide-gray-800 dark:border-gray-800">
            {drivers.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span className="min-w-[160px] flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{d.name}</span>
                <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={d.alerts}
                    disabled={busy === d.id}
                    onChange={(e) => run(d.id, () => setDriverAlerts(d.id, e.target.checked))}
                    className="h-[18px] w-[18px] accent-brand-600"
                  />
                  Race emails
                </label>
                <button
                  type="button"
                  disabled={busy === d.id}
                  onClick={() => run(d.id, () => unfollowDriver(d.id))}
                  className="min-h-[36px] px-2 text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  Unfollow
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Race emails need the account switch on too (Settings › Preferences › Alerts). Following a driver and their car? You get one
          email per race, not two.
        </p>
      </div>
    </div>
  );
}

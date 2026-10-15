/**
 * "Your accuracy" on the Finding Grip dashboard: how close the driver's own
 * recorded runs came to their hot targets. Facts only (ENGAGEMENT_PRINCIPLES):
 * counts, averages and the comparison with the runs before. No praise, no
 * streaks, no comparison with other drivers. Shown once a run is recorded.
 */
import { Link } from "react-router-dom";
import { gp } from "@/lib/site";
import { cn } from "@/lib/utils";
import type { Progress } from "./api";
import { Card, Eyebrow, formatDate } from "./components";
import { tolerance } from "./outcome";
import { carName } from "./cars";
import { formatPressure, pressureUnit, type Units } from "./units";

const runs = (n: number) => `${n} run${n === 1 ? "" : "s"}`;

/** "Your last 5 runs: worst corner off by 0.3 PSI on average, down from 0.8 PSI in the 5 before." */
export function trendText(
  t: NonNullable<Progress["trend"]>,
  units: Units
): { text: string; tone: "plain" | "warn" } {
  const p = (v: number) => `${formatPressure(v, units)} ${pressureUnit(units)}`;
  const lead = `Your last ${runs(t.latestRuns)}: worst corner off by ${p(t.latestAverage)} on average`;
  const before = `the ${t.previousRuns} before`;
  if (t.direction === "smaller")
    return {
      text: `${lead}, down from ${p(t.previousAverage)} in ${before}.`,
      tone: "plain",
    };
  if (t.direction === "larger")
    return {
      text: `${lead}, up from ${p(t.previousAverage)} in ${before}. A fresh reference session may help.`,
      tone: "warn",
    };
  return {
    text: `${lead}, about the same as ${before} (${p(t.previousAverage)}).`,
    tone: "plain",
  };
}

/** Bars are the worst corner's miss, capped at 2 PSI so one bad run doesn't flatten the rest. */
const CAP_PSI = 2;

export function ProgressPanel({ progress, units }: { progress: Progress; units: Units }) {
  if (progress.recordedTotal === 0) return null;
  const { recent } = progress;
  const pu = pressureUnit(units);
  const trend = progress.trend ? trendText(progress.trend, units) : null;
  return (
    <section className="space-y-2.5" aria-labelledby="progress-title">
      <h2
        id="progress-title"
        className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500"
      >
        Your accuracy
      </h2>
      <Card className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50 tabular-nums">
              {recent.onTarget}
              <span className="text-2xl text-gray-400"> / {recent.count}</span>
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {recent.count === 1
                ? "recorded run on target"
                : `of your last ${recent.count} recorded runs on target`}
            </span>
          </div>
          <p className="text-xs text-gray-500">
            On target means every corner within {tolerance(progress, units)} of its hot
            target.
            {recent.averageWorstMiss !== null &&
              ` Worst corner off by ${formatPressure(recent.averageWorstMiss, units)} ${pu} on average.`}
          </p>
          {trend && (
            <p
              data-testid="progress-trend"
              className={cn(
                "text-sm",
                trend.tone === "warn"
                  ? "font-semibold text-amber-700 dark:text-amber-300"
                  : "text-gray-700 dark:text-gray-300"
              )}
            >
              {trend.text}
            </p>
          )}
          {recent.runs.length > 1 && (
            <>
              <div
                className="relative flex h-16 items-end gap-1.5 border-b border-gray-200 dark:border-gray-800"
                aria-label="Worst corner miss for each recent run, oldest first"
                role="group"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-emerald-500/70"
                  style={{ bottom: `${(progress.onTargetPsi / CAP_PSI) * 100}%` }}
                />
                {recent.runs.map((r) => (
                  <Link
                    key={r.id}
                    to={gp(`/calculations/${r.id}/outcome`)}
                    title={`${r.name} · ${formatDate(r.sessionDate)} · worst corner ${formatPressure(r.worstMiss, units)} ${pu}`}
                    className={cn(
                      "relative min-w-0 flex-1 max-w-8 rounded-t focus:outline-none focus-visible:ring-2 focus-visible:ring-grip-500",
                      r.onTarget ? "bg-emerald-500" : "bg-amber-400"
                    )}
                    style={{
                      height: `${Math.max(8, (Math.min(r.worstMiss, CAP_PSI) / CAP_PSI) * 100)}%`,
                    }}
                  >
                    <span className="sr-only">
                      {r.name}, {formatDate(r.sessionDate)}:{" "}
                      {r.onTarget ? "on target" : "off target"}, worst corner{" "}
                      {formatPressure(r.worstMiss, units)} {pu}
                    </span>
                  </Link>
                ))}
              </div>
              <p className="text-[11px] text-gray-500">
                Each bar is a run, oldest first, showing its worst corner. Under the
                dashed line is on target. Tap a bar to see that run.
              </p>
            </>
          )}
        </div>
        <div className="min-w-0">
          <Eyebrow>By track</Eyebrow>
          <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-800">
            {progress.tracks.slice(0, 6).map((t) => (
              <li key={t.track.id} className="flex items-center gap-3 py-2">
                <span className="hidden sm:block w-12 shrink-0 text-xs font-extrabold tracking-wide text-gray-600 dark:text-gray-300">
                  {t.track.shortName}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-700 dark:text-gray-300">
                    {t.track.name}
                  </span>
                  {t.averageWorstMiss !== null && (
                    <span className="block text-[11px] text-gray-500">
                      Worst corner off {formatPressure(t.averageWorstMiss, units)} {pu} on
                      average · last {formatDate(t.lastDate)}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right tabular-nums whitespace-nowrap">
                  <span className="block text-sm text-gray-900 dark:text-gray-100">
                    <b>{t.onTarget}</b> of {t.recorded}
                  </span>
                  <span className="block text-[11px] text-gray-500">on target</span>
                </span>
              </li>
            ))}
          </ul>
          {progress.cars.length >= 2 && (
            <>
              <div className="mt-4">
                <Eyebrow>By car</Eyebrow>
              </div>
              <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-800">
                {progress.cars.slice(0, 6).map((c) => (
                  <li key={c.car.id} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-700 dark:text-gray-300">
                        {carName(c.car)}
                      </span>
                      {c.averageWorstMiss !== null && (
                        <span className="block text-[11px] text-gray-500">
                          Worst corner off {formatPressure(c.averageWorstMiss, units)}{" "}
                          {pu} on average · last {formatDate(c.lastDate)}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right tabular-nums whitespace-nowrap">
                      <span className="block text-sm text-gray-900 dark:text-gray-100">
                        <b>{c.onTarget}</b> of {c.recorded}
                      </span>
                      <span className="block text-[11px] text-gray-500">on target</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Card>
    </section>
  );
}

/**
 * One line under a recorded run's verdict: "On target in 6 of your last 10
 * recorded runs. At VIR: 3 of 4." Nothing until there are two recorded runs.
 */
export function ProgressLine({
  progress,
  trackId,
  trackName,
}: {
  progress: Progress;
  trackId: string;
  trackName: string;
}) {
  const { recent } = progress;
  if (progress.recordedTotal < 2) return null;
  const here = progress.tracks.find((t) => t.track.id === trackId);
  // Only worth naming the track when it isn't the same set of runs.
  const showTrack = here && here.recorded >= 2 && here.recorded !== recent.count;
  return (
    <p
      data-testid="progress-line"
      className="mt-2 text-sm text-gray-700 dark:text-gray-300"
    >
      On target in <b>{recent.onTarget}</b> of your last {recent.count} recorded runs.
      {showTrack && (
        <>
          {" "}
          At {trackName}: <b>{here.onTarget}</b> of {here.recorded}.
        </>
      )}
    </p>
  );
}

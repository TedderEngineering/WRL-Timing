/**
 * How a calculated run came in: the measured hot pressures against the
 * targets. The comparison itself is done by the server (see the API's
 * `outcome`); these helpers only word and draw it.
 */
import type { Calculation, CornerKey, Corners, Outcome } from "./api";
import { CORNER_KEYS } from "./api";
import { Link } from "react-router-dom";
import { gp } from "@/lib/site";
import { Pill, TrackBadge, formatDate } from "./components";
import { formatPressure, formatPressureDelta, pressureUnit, type Units } from "./units";

const LABEL: Record<CornerKey, string> = { lf: "LF", rf: "RF", lr: "LR", rr: "RR" };

/** "0.5 PSI" or "0.03 bar". */
export const tolerance = (o: { onTargetPsi: number }, units: Units) =>
  `${formatPressure(o.onTargetPsi, units)} ${pressureUnit(units)}`;

/** Small line under each measured corner: "+0.2 vs target". */
export function outcomeDetail(o: Outcome, units: Units): Corners<string> {
  return Object.fromEntries(
    CORNER_KEYS.map((k) => [
      k,
      Math.abs(o.delta[k]) < 0.05
        ? "on the target"
        : `${formatPressureDelta(o.delta[k], units)} vs target`,
    ])
  ) as unknown as Corners<string>;
}

const CORNER_NAME: Record<CornerKey, string> = {
  lf: "left front",
  rf: "right front",
  lr: "left rear",
  rr: "right rear",
};

const amount = (psi: number, units: Units) =>
  `${formatPressure(Math.abs(psi), units)} ${pressureUnit(units)}`;
const highLow = (psi: number) => (psi > 0 ? "high" : "low");

/**
 * Headline for a recorded run, stated as fact (ENGAGEMENT_PRINCIPLES wording
 * rules: specific, no praise or blame):
 *   "Came in within 0.3 PSI on all four corners"
 *   "Came in 0.8 PSI high on the right front"
 */
export function verdict(o: Outcome, units: Units): { title: string; body: string } {
  if (o.onTarget) {
    return {
      title:
        o.worstMiss < 0.05
          ? "Came in on target on all four corners"
          : `Came in within ${amount(o.worstMiss, units)} on all four corners`,
      body: `On target: every corner within ${tolerance(o, units)} of its target.`,
    };
  }
  // Corners outside the band, worst first.
  const missed = CORNER_KEYS.filter(
    (k) => Math.abs(o.delta[k]) > o.onTargetPsi + 1e-9
  ).sort((a, b) => Math.abs(o.delta[b]) - Math.abs(o.delta[a]));
  const [worst, ...rest] = missed;
  const others = rest.map(
    (k) => `${CORNER_NAME[k]} ${amount(o.delta[k], units)} ${highLow(o.delta[k])}`
  );
  return {
    title: `Came in ${amount(o.delta[worst], units)} ${highLow(o.delta[worst])} on the ${CORNER_NAME[worst]}`,
    body:
      (others.length ? `Also outside the target: ${others.join(", ")}. ` : "") +
      `On target means every corner within ${tolerance(o, units)}.`,
  };
}

/** Dashboard and list badge for a calculation's outcome. */
export function OutcomePill({ calc, units }: { calc: Calculation; units: Units }) {
  const o = calc.outcome;
  if (!o) return null;
  return o.onTarget ? (
    <Pill tone="ok">On target ✓</Pill>
  ) : (
    <Pill tone="warn">
      Off {formatPressure(o.worstMiss, units)} {pressureUnit(units)}
    </Pill>
  );
}

/** True when this calculation is still waiting for its hot pressures (and recent enough to ask). */
export function awaitingOutcome(c: Calculation, now = Date.now()): boolean {
  if (c.outcome || c.outcomeSkipped || c.convertedToRef) return false;
  const age = now - new Date(c.sessionDate).getTime();
  return age < 14 * 86_400_000;
}

/** A small table with the corners named across the top: one row per set of pressures. */
export function PressureTable({
  rows,
  units,
  label,
}: {
  rows: { label: string; values: Corners<number | null>; tone?: "set" | "plain" }[];
  units: Units;
  label: string;
}) {
  return (
    <div
      role="table"
      aria-label={label}
      className="grid grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-x-2 gap-y-1.5 items-baseline rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2.5 tabular-nums"
    >
      <div role="row" className="contents">
        <span role="columnheader" className="text-[10px] text-gray-500">
          {pressureUnit(units)}
        </span>
        {CORNER_KEYS.map((k) => (
          <span
            key={k}
            role="columnheader"
            className="text-center text-[10px] font-bold tracking-widest text-gray-500"
          >
            {LABEL[k]}
          </span>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.label} role="row" className="contents">
          <span role="rowheader" className="text-xs text-gray-500 whitespace-nowrap pr-1">
            {r.label}
          </span>
          {CORNER_KEYS.map((k) => (
            <span
              key={k}
              role="cell"
              className={
                r.tone === "set"
                  ? "text-center text-base font-bold text-grip-600 dark:text-grip-400"
                  : "text-center text-base font-semibold text-gray-900 dark:text-gray-100"
              }
            >
              {formatPressure(r.values[k], units)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Recent calculations still waiting for their hot pressures (dashboard "open items"). */
export function AwaitingOutcomes({ calcs }: { calcs: Calculation[] }) {
  const waiting = calcs.filter((c) => awaitingOutcome(c)).slice(0, 3);
  if (waiting.length === 0) return null;
  return (
    <section className="space-y-2.5" aria-labelledby="awaiting-title">
      <h2
        id="awaiting-title"
        className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500"
      >
        How did it come in?
      </h2>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {waiting.map((c) => (
          <Link
            key={c.id}
            to={gp(`/calculations/${c.id}/outcome`)}
            className="flex items-center gap-3 rounded-xl border border-grip-500/70 bg-grip-500/5 p-4 hover:bg-grip-500/10 transition-colors"
          >
            <TrackBadge track={c.track} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-gray-900 dark:text-gray-100 break-words">
                {c.name}: enter your hot pressures
              </div>
              <div className="text-xs text-gray-500">{formatDate(c.sessionDate)}</div>
            </div>
            <span
              className="text-lg font-bold text-grip-600 dark:text-grip-400"
              aria-hidden
            >
              →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

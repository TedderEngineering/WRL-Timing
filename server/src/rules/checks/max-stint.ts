/**
 * Maximum stint (rule type max_stint): longest continuous stint, and the minimum break between a driver's stints.
 *
 * WRL formats have no pit-lane timestamps, so a stint is bounded by line crossings: every duration is an
 * interval [lower, upper] (RULEBOOK_FORMAT.md, wrl-2026 defaults.tolerances.lap_boundary):
 * - lower: end of the out-lap (or the race start) to the start of the in-lap (or the last crossing);
 * - upper: start of the out-lap to the end of the in-lap, each boundary lap capped at 2x the slowest class
 *   median clean green lap so a garage lap does not add hours.
 * Alkamel formats have pit-in / pit-out times, so lower = upper.
 */
import type { CarId, Stint } from "../../analysis/schema/package-types.js";
import type { ResolvedRule, Severity } from "../rulebook-types.js";
import type { CheckHandler, FindingDraft } from "./common.js";
import { emptyOutput, ev, minConf, num, param, passOf, raceControlFor } from "./common.js";
import type { RaceCtx } from "./context.js";
import { r3 } from "./context.js";

const STINT_PENALTY = /stint|drive[\s-]*time|break/i;

export interface StintBounds {
  stint: Stint;
  startLow: number;
  startUp: number;
  endLow: number;
  endUp: number;
  lower: number;
  upper: number;
  exact: boolean;
  laps: [number, number];
}

function lapTime(l: { lapTimeS: number | null; endS: number; startS: number }): number {
  return l.lapTimeS ?? l.endS - l.startS;
}

export function stintBounds(ctx: RaceCtx, s: Stint): StintBounds | string {
  if (ctx.hasPitTimes) {
    const a = s.start.raceTimeS;
    const b = s.end.raceTimeS;
    return {
      stint: s,
      startLow: a,
      startUp: a,
      endLow: b,
      endUp: b,
      lower: r3(b - a),
      upper: r3(b - a),
      exact: true,
      laps: [s.startLap, s.endLap],
    };
  }
  const first = ctx.lap(s.car, s.startLap);
  const last = ctx.lap(s.car, s.endLap);
  if (!first || !last) return "boundary_lap_missing";
  const med = ctx.slowestClassMedianLapS();
  const cap = med ? 2 * med : Infinity;
  let startLow: number;
  let startUp: number;
  if (s.startReason === "race_start") {
    startLow = startUp = first.startS;
  } else {
    // out-lap: the car leaves the pit lane somewhere inside it
    startLow = first.endS;
    startUp = first.endS - Math.min(lapTime(first), cap);
  }
  const endsInPit =
    s.endReason === "pit_in" ||
    (s.endReason === "retired" &&
      (ctx.passages.get(s.car) ?? []).some(
        (p) => p.kind === "retirement" && p.inLap === s.endLap
      ));
  let endLow: number;
  let endUp: number;
  if (endsInPit) {
    // in-lap: the car enters the pit lane somewhere inside it
    endLow = last.endS - lapTime(last);
    endUp = endLow + Math.min(lapTime(last), cap);
  } else {
    endLow = endUp = last.endS;
  }
  return {
    stint: s,
    startLow,
    startUp,
    endLow,
    endUp,
    lower: r3(Math.max(0, endLow - startLow)),
    upper: r3(Math.max(0, endUp - startUp)),
    exact: false,
    laps: [s.startLap, s.endLap],
  };
}

/** Driver attribution is usable when the stint has a driver and is not low confidence (WRL Driver_Name, WN5). */
function reliableDriver(s: Stint): boolean {
  return s.driver !== null && s.confidence !== "low";
}

function boundaryEvidence(ctx: RaceCtx, car: CarId, b: StintBounds[]) {
  const ids: { label: string; factId: string }[] = [];
  for (const x of b) ids.push(...ev("stint", x.stint.id));
  const firstLap = b[0].laps[0];
  const lastLap = b[b.length - 1].laps[1];
  for (const p of ctx.passages.get(car) ?? []) {
    if (p.outLap === firstLap || p.inLap === lastLap) ids.push(...ev("passage", p.id));
  }
  if (!b[0].exact)
    ids.push(
      ...ev("first_lap", `lap:${car}:${firstLap}`),
      ...ev("last_lap", `lap:${car}:${lastLap}`)
    );
  return ids;
}

function limitFor(rule: ResolvedRule, s: Stint): number | null {
  const v = num(rule, "value_s");
  if (v === null) return null;
  const ext = num(rule, "fcy_extension_s") ?? 0;
  return ext > 0 && (s.fcyTimeS ?? 0) > 0 ? v + ext : v;
}

function stintFinding(
  ctx: RaceCtx,
  rule: ResolvedRule,
  car: CarId,
  parts: StintBounds[],
  lowerSum: number,
  upperSum: number,
  limit: number,
  severity: Severity,
  sevNotes: string[],
  notes: string[]
): FindingDraft {
  const at = parts[0].startLow + limit;
  const lap = ctx.lapAt(car, at)?.lap ?? parts[parts.length - 1].laps[1];
  const exact = parts.every((p) => p.exact);
  return {
    car,
    severity,
    severityNotes: sevNotes,
    lap,
    clock: ctx.clock(at),
    raceTimeS: r3(at),
    measured: r3(lowerSum),
    measuredRange: exact ? null : [r3(lowerSum), r3(upperSum)],
    limit,
    margin: r3(limit - lowerSum),
    unit: "s",
    evidence: boundaryEvidence(ctx, car, parts),
    raceControl: raceControlFor(ctx, car, STINT_PENALTY),
    confidence: minConf(...parts.map((p) => p.stint.confidence)),
    notes: [
      ...notes,
      ...(exact ? [] : ["lap_crossing_bounds"]),
      `laps_${parts[0].laps[0]}_${parts[parts.length - 1].laps[1]}`,
    ],
  };
}

function carBounds(
  ctx: RaceCtx,
  car: CarId,
  out: ReturnType<typeof emptyOutput>
): StintBounds[] {
  const list: StintBounds[] = [];
  for (const s of ctx.stints.get(car) ?? []) {
    const b = stintBounds(ctx, s);
    if (typeof b === "string") out.notEvaluated.push({ car, factId: s.id, reason: b });
    else list.push(b);
  }
  return list;
}

/** Consecutive stints with the same (non-null) driver: one driving run across pit visits. */
function driverRuns(list: StintBounds[]): StintBounds[][] {
  const runs: StintBounds[][] = [];
  for (const b of list) {
    const last = runs[runs.length - 1];
    if (last && b.stint.driver !== null && last[0].stint.driver === b.stint.driver)
      last.push(b);
    else runs.push([b]);
  }
  return runs;
}

export const maxStintHandler: CheckHandler = {
  name: "max_stint",
  required: (rule) =>
    param(rule, "value_laps") !== undefined ? ["value_laps"] : ["value_s"],
  run: ({ ctx, rule, cars }) => {
    const out = emptyOutput();
    const perDriver = param(rule, "per") === "driver";
    const valueLaps = num(rule, "value_laps");
    if (!(ctx.pkg.stints ?? []).length)
      return { notCheckable: { reason: "data_missing", detail: "no_stint_facts" } };
    if (perDriver && ![...ctx.stints.values()].flat().some((s) => s.driver !== null))
      out.notes.push("no_driver_data_car_stints_only");
    for (const car of cars) {
      const list = carBounds(ctx, car, out);
      // 1. each car stint (between service stops) is a lower bound on one driver's stint
      const stintPass = (b: StintBounds, measured: number, limit: number, unit: "s" | "laps") =>
        passOf({
          car,
          lap: b.laps[1],
          clock: ctx.clock(b.endLow),
          raceTimeS: r3(b.endLow),
          measured,
          measuredRange: unit === "s" && !b.exact ? [b.lower, b.upper] : null,
          limit,
          margin: r3(limit - (unit === "s" && !b.exact ? b.upper : measured)),
          unit,
          evidence: boundaryEvidence(ctx, car, [b]),
          confidence: minConf(b.stint.confidence),
          notes: [
            "car_stint_without_service_stop",
            ...(b.exact ? [] : ["lap_crossing_bounds"]),
            `laps_${b.laps[0]}_${b.laps[1]}`,
          ],
        });
      for (const b of list) {
        if (valueLaps !== null) {
          if (b.stint.laps > valueLaps) {
            const f = stintFinding(
              ctx,
              rule,
              car,
              [b],
              b.lower,
              b.upper,
              num(rule, "value_s") ?? b.lower,
              rule.severity,
              [],
              ["laps_over_limit"]
            );
            f.measured = b.stint.laps;
            f.measuredRange = null;
            f.limit = valueLaps;
            f.margin = valueLaps - b.stint.laps;
            f.unit = "laps";
            out.results.push(f);
          } else out.results.push(stintPass(b, b.stint.laps, valueLaps, "laps"));
          continue;
        }
        const limit = limitFor(rule, b.stint)!;
        if (b.lower > limit)
          out.results.push(
            stintFinding(
              ctx,
              rule,
              car,
              [b],
              b.lower,
              b.upper,
              limit,
              rule.severity,
              [],
              ["car_stint_without_service_stop"]
            )
          );
        else if (b.upper > limit)
          out.results.push(
            stintFinding(
              ctx,
              rule,
              car,
              [b],
              b.lower,
              b.upper,
              limit,
              "info",
              ["only_upper_bound_exceeds"],
              ["car_stint_without_service_stop"]
            )
          );
        else out.results.push(stintPass(b, b.lower, limit, "s"));
      }
      // 2. per driver: a driver who stays in through a stop continues the same driving run
      if (perDriver && valueLaps === null) {
        for (const run of driverRuns(list)) {
          if (run.length < 2) continue;
          const lowerSum = run.reduce((s, b) => s + b.lower, 0);
          const upperSum = run.reduce((s, b) => s + b.upper, 0);
          const limit = limitFor(rule, run[0].stint)!;
          if (lowerSum <= limit) continue;
          const reliable = run.every((b) => reliableDriver(b.stint));
          out.results.push(
            stintFinding(
              ctx,
              rule,
              car,
              run,
              lowerSum,
              upperSum,
              limit,
              reliable ? rule.severity : "info",
              reliable ? [] : ["driver_attribution_low_confidence"],
              ["driver_run_across_service_stops", `driver_number_${run[0].stint.driver}`]
            )
          );
        }
      }
    }
    return out;
  },
};

export const minBreakHandler: CheckHandler = {
  name: "min_break_between_stints",
  required: () => ["min_break_s"],
  run: ({ ctx, rule, cars }) => {
    const out = emptyOutput();
    const min = num(rule, "min_break_s")!;
    if (!(ctx.pkg.stints ?? []).length)
      return { notCheckable: { reason: "data_missing", detail: "no_stint_facts" } };
    if (![...ctx.stints.values()].flat().some((s) => s.driver !== null))
      return { notCheckable: { reason: "data_missing", detail: "no_driver_per_stint" } };
    for (const car of cars) {
      const runs = driverRuns(carBounds(ctx, car, out)).filter(
        (r) => r[0].stint.driver !== null
      );
      if (!runs.length) {
        out.notEvaluated.push({ car, reason: "no_driver_data" });
        continue;
      }
      for (let i = 0; i < runs.length; i++) {
        const a = runs[i];
        const j = runs.findIndex(
          (r, k) => k > i && r[0].stint.driver === a[0].stint.driver
        );
        if (j < 0) continue;
        const b = runs[j];
        const aEnd = a[a.length - 1];
        const bStart = b[0];
        const gapLow = r3(bStart.startUp - aEnd.endUp);
        const gapUp = r3(bStart.startLow - aEnd.endLow);
        const exact = aEnd.exact && bStart.exact;
        const evidence = [
          ...boundaryEvidence(ctx, car, [aEnd]),
          ...boundaryEvidence(ctx, car, [bStart]),
        ];
        const notes = [
          `driver_number_${a[0].stint.driver}`,
          `back_from_lap_${bStart.laps[0]}`,
          ...(exact ? [] : ["lap_crossing_bounds"]),
        ];
        if (gapLow >= min) {
          out.results.push(
            passOf({
              car,
              lap: bStart.laps[0],
              clock: ctx.clock(bStart.startLow),
              raceTimeS: r3(bStart.startLow),
              measured: gapLow,
              measuredRange: exact ? null : [gapLow, gapUp],
              limit: min,
              margin: r3(gapLow - min),
              unit: "s",
              evidence,
              confidence: minConf(aEnd.stint.confidence, bStart.stint.confidence),
              notes,
            })
          );
          continue;
        }
        const reliable = [...a, ...b].every((x) => reliableDriver(x.stint));
        const sev: Severity = reliable && gapUp < min ? rule.severity : "info";
        const sevNotes =
          sev === "info" && rule.severity !== "info"
            ? [
                reliable
                  ? "only_lower_bound_below_minimum"
                  : "driver_attribution_low_confidence",
              ]
            : [];
        out.results.push({
          car,
          severity: sev,
          severityNotes: sevNotes,
          lap: bStart.laps[0],
          clock: ctx.clock(bStart.startLow),
          raceTimeS: r3(bStart.startLow),
          measured: gapLow,
          measuredRange: exact ? null : [gapLow, gapUp],
          limit: min,
          margin: r3(gapLow - min),
          unit: "s",
          evidence,
          raceControl: raceControlFor(ctx, car, STINT_PENALTY),
          confidence: minConf(aEnd.stint.confidence, bStart.stint.confidence),
          notes,
        });
      }
    }
    return out;
  },
};

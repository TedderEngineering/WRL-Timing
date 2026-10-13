/**
 * Pit window / earliest legal pit (pit_window) and minimum pit-lane time (min_pit_time).
 */
import type { PitPassage } from "../package-types.js";
import type { Severity } from "../rulebook-types.js";
import type { CheckHandler, FindingDraft, MarkerDraft } from "./common.js";
import {
  emptyOutput,
  ev,
  isTbd,
  minConf,
  num,
  param,
  raceControlFor,
  tolerance,
  toleranceSeverity,
} from "./common.js";
import type { RaceCtx } from "./context.js";
import { r3 } from "./context.js";
import { closureIntervals } from "./fcy-pits.js";

const SERVICE_STOP = new Set(["stop", "garage"]);
const SHORT_STOP_PENALTY = /short pit|pit stop time|minimum pit|pit time/i;
const WINDOW_PENALTY = /window|early pit|pitt?ed (too )?early|mandatory (pit )?stop/i;

function serviceStops(ctx: RaceCtx, car: string): PitPassage[] {
  return (ctx.passages.get(car) ?? []).filter((p) => SERVICE_STOP.has(p.kind));
}

// ─── pit window and earliest legal pit ─────────────────────────────────────

interface WindowSpec {
  by: "time" | "lap";
  open: number;
  close: number;
  /** Race-time offset of the window's reference instant (0 = time origin, the first green flag). */
  t0: number;
}

function windowSpec(
  ctx: RaceCtx,
  rule: Parameters<CheckHandler["run"]>[0]["rule"]
): WindowSpec | string {
  const by = param<string>(rule, "open.by");
  if (by !== param<string>(rule, "close.by")) return "open_close_by_differ";
  if (by !== "time" && by !== "lap") return `window_by_${String(by)}_not_supported`;
  const from = param<string>(rule, "open.from");
  let t0 = 0;
  if (from === "scheduled_start") {
    if (!ctx.scheduledStart) return "scheduled_start_unknown";
    t0 = (Date.parse(ctx.scheduledStart) - ctx.originMs) / 1000;
  } else if (from !== "green_flag" && from !== "race_start")
    return `window_from_${String(from)}_not_supported`;
  return { by, open: num(rule, "open.value")!, close: num(rule, "close.value")!, t0 };
}

/** First instant >= t when the pit lane is open for the car's class. */
function earliestOpen(intervals: { fromS: number; toS: number }[], t: number): number {
  let cur = t;
  for (let moved = true; moved; ) {
    moved = false;
    for (const iv of intervals) {
      if (iv.fromS <= cur && cur < iv.toS) {
        cur = iv.toS;
        moved = true;
      }
    }
  }
  return cur;
}

export const pitWindowHandler: CheckHandler = {
  name: "pit_window",
  required: (rule) => {
    const req = [
      "open.by",
      "open.value",
      "open.from",
      "close.by",
      "close.value",
      "close.from",
    ];
    if (param(rule, "boundary") !== undefined || param(rule, "open.by") === "time")
      req.push("boundary");
    return req;
  },
  run: ({ ctx, rule, rules, cars }) => {
    const out = emptyOutput();
    const spec = windowSpec(ctx, rule);
    if (typeof spec === "string")
      return { notCheckable: { reason: "not_implemented", detail: spec } };
    const boundary = (param<string>(rule, "boundary") ?? "pit_in") as
      | "pit_in"
      | "pit_out";
    const fcyEffect = param<string>(rule, "fcy_effect");
    const anyStop = param<string>(rule, "applies_to_stop") === "any";
    if (isTbd(fcyEffect))
      out.notes.push("fcy_effect_tbd_findings_overlapping_fcy_are_info");
    if (boundary === "pit_out" && spec.by === "time" && !ctx.hasPitTimes)
      return { notCheckable: { reason: "data_missing", detail: "no_pit_out_times" } };
    const lo = spec.by === "time" ? spec.t0 + spec.open : spec.open;
    const hi = spec.by === "time" ? spec.t0 + spec.close : spec.close;
    const fcyOverlapsWindow =
      spec.by === "time"
        ? ctx.fcy.some(
            (f) =>
              f.start.raceTimeS < hi && (f.endsAtFinish ? Infinity : f.end.raceTimeS) > lo
          )
        : ctx.fcy.length > 0;
    const markers: MarkerDraft[] = [];
    for (const car of cars) {
      if (!ctx.laps.get(car)?.length) continue;
      // earliest legal pit marker (D-EARLIEST-PIT): window open AND pit lane open for the class
      const { intervals } = closureIntervals(ctx, rules, ctx.classOf(car));
      let openT: number | null;
      if (spec.by === "time") openT = lo;
      else {
        const prev = ctx.lap(car, spec.open - 1);
        openT = spec.open <= 1 ? 0 : (prev?.endS ?? null);
      }
      if (openT !== null) {
        const t = earliestOpen(intervals, openT);
        markers.push({
          car,
          raceTimeS: r3(t),
          lap: ctx.lapAt(car, t + 1e-6)?.lap ?? null,
        });
      }
      const stops = serviceStops(ctx, car).filter((p) => p.outcome === "rejoined");
      const counted =
        fcyEffect === "stops_under_fcy_do_not_count"
          ? stops.filter((p) => p.fcyContext !== "fcy")
          : stops;
      if (!counted.length) {
        out.notEvaluated.push({ car, reason: "no_service_stop" });
        continue;
      }
      const pos = (p: PitPassage): number | null => {
        if (spec.by === "lap") return boundary === "pit_out" ? p.outLap : p.inLap;
        const tp = boundary === "pit_out" ? p.pitOut : p.pitIn;
        return tp ? tp.raceTimeS : null;
      };
      const inside = (p: PitPassage) => {
        const v = pos(p);
        return v !== null && v >= lo - 1e-9 && v <= hi + 1e-9;
      };
      const outside = anyStop
        ? counted.filter((p) => !inside(p))
        : counted.some(inside)
          ? []
          : [counted[0]];
      out.evaluated++;
      if (!outside.length) {
        out.passed++;
        continue;
      }
      for (const p of outside) {
        const v = pos(p);
        if (v === null) {
          out.notEvaluated.push({ car, factId: p.id, reason: "boundary_time_missing" });
          continue;
        }
        let severity: Severity = rule.severity;
        const sevNotes: string[] = [];
        if ((isTbd(fcyEffect) || fcyEffect === "window_extended") && fcyOverlapsWindow) {
          severity = "info";
          sevNotes.push("fcy_effect_on_window_unknown");
        }
        const tp = boundary === "pit_out" ? p.pitOut : p.pitIn;
        const measured = spec.by === "time" ? r3(v - spec.t0) : v;
        out.findings.push({
          car,
          class: ctx.classOf(car),
          severity,
          severityNotes: sevNotes,
          lap: p.inLap,
          clock: tp?.clock ?? (tp ? ctx.clock(tp.raceTimeS) : null),
          raceTimeS: tp?.raceTimeS ?? null,
          measured,
          measuredRange: null,
          threshold: [spec.open, spec.close],
          marginS: spec.by === "time" ? r3(v < lo ? v - lo : v - hi) : null,
          unit: spec.by === "time" ? "s" : "lap",
          evidence: ev("passage", p.id),
          raceControl: raceControlFor(ctx, car, WINDOW_PENALTY, (tp?.raceTimeS ?? 0) - 1),
          confidence: minConf(p.confidence),
          notes: [
            anyStop ? "every_stop_must_be_in_window" : "no_stop_inside_window",
            `boundary_${boundary}`,
          ],
        });
      }
    }
    out.markers = markers;
    return out;
  },
};

// ─── minimum pit-lane time ─────────────────────────────────────────────────

export const minPitTimeHandler: CheckHandler = {
  name: "min_pit_time",
  required: () => ["value_s", "measure"],
  run: ({ ctx, rule, cars }) => {
    const out = emptyOutput();
    const measure = param<string>(rule, "measure");
    if (measure !== "pit_lane_loop_to_loop") {
      return {
        notCheckable: {
          reason: measure === "stationary" ? "data_missing" : "not_implemented",
          detail: `measure_${String(measure)}`,
        },
      };
    }
    if (!ctx.hasPitTimes)
      return {
        notCheckable: { reason: "data_missing", detail: "no_pit_lane_times_in_format" },
      };
    const value = num(rule, "value_s")!;
    const tol = tolerance(ctx, "pit_clock_s");
    const addPending = param(rule, "add_pending_time_penalties") === true;
    const variants = param(rule, "variants");
    if (isTbd(variants)) out.notes.push("variants_tbd");
    if (param(rule, "applies_to_stop") === "refuel")
      out.notes.push("refuel_stops_not_distinguishable_all_service_stops_checked");
    for (const car of cars) {
      const stops = serviceStops(ctx, car);
      const pens = ctx.penaltiesOf(car);
      for (const p of stops) {
        if (p.outcome !== "rejoined") {
          out.notEvaluated.push({ car, factId: p.id, reason: "did_not_rejoin" });
          continue;
        }
        if (p.officialPitLaneTimeS === null || p.officialPitLaneTimeS === undefined) {
          out.notEvaluated.push({
            car,
            factId: p.id,
            reason: "no_official_pit_lane_time",
          });
          continue;
        }
        out.evaluated++;
        // time penalties to be served at this stop ("N sec Time Penalty at next eligible stop")
        const pending = addPending
          ? pens.filter((q) => {
              if (q.penaltyType !== "time_at_stop" || typeof q.amountS !== "number")
                return false;
              if (q.servedByPassageId) return q.servedByPassageId === p.id;
              const issued = q.issued?.raceTimeS;
              if (
                issued === undefined ||
                issued === null ||
                !p.pitIn ||
                issued >= p.pitIn.raceTimeS
              )
                return false;
              const firstAfter = stops.find(
                (s) => s.pitIn && s.pitIn.raceTimeS > issued && s.outcome === "rejoined"
              );
              return firstAfter?.id === p.id;
            })
          : [];
        let req = value;
        const notes: string[] = [];
        if (Array.isArray(variants)) {
          const nDrivers = ctx.entries.get(car)?.drivers.length ?? 0;
          const v = (variants as { when?: string; value_s?: number }[]).find(
            (x) => /single/i.test(x.when ?? "") && nDrivers === 1
          );
          if (v && typeof v.value_s === "number") {
            req = v.value_s;
            notes.push("single_driver_variant");
          }
        }
        const pendingS = pending.reduce((s, q) => s + (q.amountS as number), 0);
        req = r3(req + pendingS);
        if (pendingS) notes.push("pending_time_penalties_added");
        const margin = r3(p.officialPitLaneTimeS - req);
        if (margin >= 0) {
          out.passed++;
          continue;
        }
        const { severity, notes: sevNotes } = toleranceSeverity(
          rule.severity,
          -margin,
          tol
        );
        if (isTbd(variants) && (ctx.entries.get(car)?.drivers.length ?? 2) === 1)
          notes.push("single_driver_entry_variant_unknown");
        const rc = raceControlFor(
          ctx,
          car,
          SHORT_STOP_PENALTY,
          (p.pitIn?.raceTimeS ?? 0) - 1
        );
        const f: FindingDraft = {
          car,
          class: ctx.classOf(car),
          severity,
          severityNotes: sevNotes,
          lap: p.inLap,
          clock: p.pitIn?.clock ?? (p.pitIn ? ctx.clock(p.pitIn.raceTimeS) : null),
          raceTimeS: p.pitIn?.raceTimeS ?? null,
          measured: p.officialPitLaneTimeS,
          measuredRange: null,
          threshold: req,
          marginS: margin,
          unit: "s",
          evidence: [
            ...ev("passage", p.id),
            ...pending.map((q) => ({ label: "pending_time_penalty", factId: q.id })),
            ...rc.penaltyIds.map((id) => ({ label: "race_control_penalty", factId: id })),
          ],
          raceControl: rc,
          confidence: minConf(
            p.confidence,
            p.pitLaneTimeReliable === false ? "low" : undefined
          ),
          notes,
        };
        out.findings.push(f);
      }
    }
    return out;
  },
};

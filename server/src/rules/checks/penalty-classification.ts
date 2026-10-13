/**
 * Penalty served within N green crossings (penalty_service with max_green_crossings), and classification
 * (minimum distance, order by laps, incomplete race).
 */
import type { CarId, Penalty } from "../../analysis/schema/package-types.js";
import type { Severity } from "../rulebook-types.js";
import type { CheckHandler } from "./common.js";
import { emptyOutput, ev, minConf, num, param, passOf } from "./common.js";
import { carOrder, r3 } from "./context.js";

const SERVABLE = new Set<Penalty["penaltyType"]>([
  "drive_through",
  "stop_and_go",
  "stop_plus",
]);

export const greenCrossingsHandler: CheckHandler = {
  name: "penalty_served_within_green_crossings",
  required: () => ["max_green_crossings"],
  run: ({ ctx, rule, cars }) => {
    const out = emptyOutput();
    const max = num(rule, "max_green_crossings")!;
    if (param(rule, "serve_under") && param(rule, "serve_under") !== "green")
      out.notes.push(
        `serve_under_${String(param(rule, "serve_under"))}_counted_as_green`
      );
    if (!ctx.hasRaceControl)
      return {
        notCheckable: { reason: "data_missing", detail: "no_race_control_penalties" },
      };
    const inScope = new Set(cars);
    for (const p of ctx.penalties) {
      if (!inScope.has(p.car) || !SERVABLE.has(p.penaltyType)) continue;
      const issued = p.issued?.raceTimeS;
      if (issued === undefined || issued === null) {
        out.notEvaluated.push({ car: p.car, factId: p.id, reason: "issue_time_unknown" });
        continue;
      }
      const served = p.servedByPassageId
        ? (ctx.passageById.get(p.servedByPassageId) ?? null)
        : null;
      const laps = ctx.laps.get(p.car) ?? [];
      if (served && !laps.length) {
        out.notEvaluated.push({ car: p.car, factId: p.id, reason: "no_lap_crossings" });
        continue;
      }
      const until =
        served?.pitIn?.raceTimeS ??
        (laps.length
          ? Math.min(ctx.chequeredS, laps[laps.length - 1].endS + 1e-6)
          : -Infinity);
      const green = laps.filter(
        (l) => l.endS > issued && l.endS < until && ctx.isGreenAt(l.endS)
      );
      const crossingEv = green.map((l) => ({
        label: "green_crossing",
        factId: `lap:${p.car}:${l.lap}`,
      }));
      if (served && green.length <= max) {
        out.results.push(
          passOf({
            car: p.car,
            lap: served.inLap,
            clock: served.pitIn?.clock ?? null,
            raceTimeS: served.pitIn?.raceTimeS ?? null,
            measured: green.length,
            limit: max,
            margin: max - green.length,
            unit: "count",
            evidence: [...ev("penalty", p.id), ...ev("serving_passage", served.id), ...crossingEv],
            confidence: minConf(p.confidence, served.confidence),
            notes: [`penalty_status_${p.status}`],
          })
        );
        continue;
      }
      const unserved = !served;
      const severity: Severity = unserved ? "info" : rule.severity;
      const rcStatus =
        p.status === "converted_post_race" || p.status === "applied_post_race"
          ? "converted_post_race"
          : unserved
            ? "unserved"
            : "served";
      const measured = unserved && !laps.length ? null : green.length;
      out.results.push({
        car: p.car,
        severity,
        severityNotes:
          unserved && rule.severity !== "info" ? ["penalty_not_served_on_track"] : [],
        lap: served?.inLap ?? null,
        clock: served?.pitIn?.clock ?? p.issued?.clock ?? null,
        raceTimeS: served?.pitIn?.raceTimeS ?? issued,
        measured,
        measuredRange: null,
        limit: max,
        // unserved: the crossings counted run to the finish, so they do not measure a margin
        margin: unserved || measured === null ? null : max - measured,
        unit: "count",
        evidence: [...ev("penalty", p.id), ...ev("serving_passage", served?.id), ...crossingEv],
        raceControl: { status: rcStatus, penaltyIds: [p.id] },
        confidence: minConf(p.confidence, served?.confidence),
        notes: unserved
          ? ["unserved_on_track", `penalty_status_${p.status}`]
          : ["served_after_too_many_green_crossings"],
      });
    }
    return out;
  },
};

// ─── classification ────────────────────────────────────────────────────────

export const minDistanceHandler: CheckHandler = {
  name: "classification_min_distance",
  required: () => [
    "min_fraction",
    "min_fraction.value",
    "min_fraction.of",
    "min_fraction.measure",
  ],
  run: ({ ctx, rule, cars }) => {
    const out = emptyOutput();
    const of = param<string>(rule, "min_fraction.of");
    const measure = param<string>(rule, "min_fraction.measure");
    const value = num(rule, "min_fraction.value")!;
    if (measure !== "laps" || (of !== "class_leader" && of !== "overall_leader")) {
      return {
        notCheckable: {
          reason: "not_implemented",
          detail: `min_fraction_${String(of)}_${String(measure)}`,
        },
      };
    }
    const withResult = ctx
      .allCars()
      .filter(
        (c) => ctx.entries.get(c)?.result && ctx.entries.get(c)!.result!.status !== "dns"
      );
    if (!withResult.length)
      return { notCheckable: { reason: "data_missing", detail: "no_results" } };
    const leaderOf = new Map<string, { car: CarId; laps: number }>();
    for (const c of withResult) {
      const key = of === "class_leader" ? (ctx.classOf(c) ?? "") : "";
      const laps = ctx.entries.get(c)!.result!.laps;
      const cur = leaderOf.get(key);
      if (!cur || laps > cur.laps) leaderOf.set(key, { car: c, laps });
    }
    for (const car of cars) {
      const res = ctx.entries.get(car)?.result;
      if (!res) {
        out.notEvaluated.push({ car, reason: "no_result" });
        continue;
      }
      if (res.status === "dns") {
        out.notEvaluated.push({ car, factId: res.id, reason: "did_not_start" });
        continue;
      }
      const leader = leaderOf.get(of === "class_leader" ? (ctx.classOf(car) ?? "") : "");
      if (!leader || leader.laps <= 0) {
        out.notEvaluated.push({ car, factId: res.id, reason: "no_leader_laps" });
        continue;
      }
      const frac = res.laps / leader.laps;
      const evidence = [
        ...ev("result", res.id),
        ...ev("leader_result", ctx.entries.get(leader.car)?.result?.id),
      ];
      if (frac >= value) {
        out.results.push(
          passOf({
            car,
            measured: r3(frac),
            limit: value,
            margin: r3(frac - value),
            unit: "fraction",
            evidence,
            confidence: minConf(res.confidence),
            notes: [`results_status_${res.status}`],
          })
        );
        continue;
      }
      const notes = [`results_status_${res.status}`];
      if (res.status === "classified")
        notes.push("listed_classified_below_minimum_distance");
      if (res.resultsStatus) notes.push(`results_${res.resultsStatus}`);
      out.results.push({
        car,
        severity: rule.severity,
        severityNotes: [],
        lap: null,
        clock: null,
        raceTimeS: null,
        measured: r3(frac),
        measuredRange: null,
        limit: value,
        margin: r3(frac - value),
        unit: "fraction",
        evidence,
        raceControl: {
          status: ctx.hasRaceControl ? "none_found" : "not_available",
          penaltyIds: [],
        },
        confidence: minConf(res.confidence),
        notes,
      });
    }
    return out;
  },
};

/** Results order versus lap counts (information: post-race penalties or decisions). */
export const resultsOrderHandler: CheckHandler = {
  name: "classification_order_by_laps",
  required: () => [],
  run: ({ ctx, rule, cars }) => {
    const out = emptyOutput();
    const inScope = new Set(cars);
    const rows = ctx
      .allCars()
      .map((c) => ({ car: c, res: ctx.entries.get(c)?.result ?? null }))
      .filter(
        (x) => x.res && x.res.positionOverall !== null && x.res.status === "classified"
      )
      .sort(
        (a, b) =>
          a.res!.positionOverall! - b.res!.positionOverall! || carOrder(a.car, b.car)
      );
    if (!rows.length)
      return { notCheckable: { reason: "data_missing", detail: "no_results" } };
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      if (!inScope.has(a.car)) continue;
      const evidence = [...ev("result", a.res!.id), ...ev("next_result", b.res!.id)];
      if (a.res!.laps >= b.res!.laps) {
        out.results.push(
          passOf({
            car: a.car,
            measured: a.res!.laps,
            limit: b.res!.laps,
            margin: a.res!.laps - b.res!.laps,
            unit: "laps",
            evidence,
            confidence: minConf(a.res!.confidence, b.res!.confidence),
          })
        );
        continue;
      }
      out.results.push({
        car: a.car,
        severity: rule.severity,
        severityNotes: [],
        lap: null,
        clock: null,
        raceTimeS: null,
        measured: a.res!.laps,
        measuredRange: null,
        limit: b.res!.laps,
        margin: a.res!.laps - b.res!.laps,
        unit: "laps",
        evidence,
        raceControl: {
          status: ctx.hasRaceControl ? "none_found" : "not_available",
          penaltyIds: [],
        },
        confidence: minConf(a.res!.confidence, b.res!.confidence),
        notes: ["results_order_differs_from_lap_count"],
      });
    }
    return out;
  },
};

/** A race stopped by red flag before a fraction of its scheduled time is incomplete (race-level, info). */
export const incompleteRaceHandler: CheckHandler = {
  name: "classification_incomplete_race",
  required: () => ["min_fraction.value"],
  run: ({ ctx, rule }) => {
    const out = emptyOutput();
    const value = num(rule, "min_fraction.value")!;
    const dur = ctx.publishedDurationS;
    if (dur === null)
      return {
        notCheckable: { reason: "data_missing", detail: "published_duration_unknown" },
      };
    const red = ctx.fcy.find((f) => f.type === "red" && f.endsAtFinish);
    const elapsed = Number.isFinite(ctx.chequeredS) ? ctx.chequeredS : null;
    // race-level: the subject is the red flag that ended the race; without one there is nothing to check
    if (!red) {
      out.notes.push("no_red_flag_at_finish");
      return out;
    }
    if (elapsed === null) {
      out.notEvaluated.push({ car: null, factId: red.id, reason: "chequered_time_unknown" });
      return out;
    }
    if (elapsed >= value * dur) {
      out.results.push(
        passOf({
          car: null,
          clock: ctx.clock(red.start.raceTimeS),
          raceTimeS: red.start.raceTimeS,
          measured: r3(elapsed / dur),
          limit: value,
          margin: r3(elapsed / dur - value),
          unit: "fraction",
          evidence: ev("fcy_period", red.id),
          confidence: red.confidence,
        })
      );
      return out;
    }
    out.results.push({
      car: null,
      severity: rule.severity,
      severityNotes: [],
      lap: null,
      clock: ctx.clock(red.start.raceTimeS),
      raceTimeS: red.start.raceTimeS,
      measured: r3(elapsed / dur),
      measuredRange: null,
      limit: value,
      margin: r3(elapsed / dur - value),
      unit: "fraction",
      evidence: ev("fcy_period", red.id),
      raceControl: {
        status: ctx.hasRaceControl ? "none_found" : "not_available",
        penaltyIds: [],
      },
      confidence: red.confidence,
      notes: ["race_stopped_before_minimum_fraction"],
    });
    return out;
  },
};

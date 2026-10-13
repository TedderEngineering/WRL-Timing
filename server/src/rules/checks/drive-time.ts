/**
 * Minimum and maximum drive time per driver. Drivers are keyed by (car, driver NUMBER), never by name:
 * abbreviated names collide (IMSA MPC Road Atlanta 2026 #55: two nominated drivers are both "E. Gou").
 */
import type { CarId, DriveTime } from "../package-types.js";
import type { ResolvedRule, Severity } from "../rulebook-types.js";
import type { CheckHandler, CheckInput, CheckOutput, NotCheckableOut } from "./common.js";
import {
  emptyOutput,
  ev,
  minConf,
  num,
  param,
  raceControlFor,
  tolerance,
  toleranceSeverity,
} from "./common.js";
import type { RaceCtx } from "./context.js";
import { r3 } from "./context.js";

const DRIVE_TIME_PENALTY = /drive[\s-]*time/i;

function preconditions(ctx: RaceCtx, rule: ResolvedRule): NotCheckableOut | null {
  const measure = param<string>(rule, "measure");
  if (measure && measure !== "track_time_excl_pit_lane") {
    return { notCheckable: { reason: "not_implemented", detail: `measure_${measure}` } };
  }
  const ends = param<string>(rule, "ends");
  if (ends && ends !== "published_time_expiry")
    return { notCheckable: { reason: "not_implemented", detail: `ends_${ends}` } };
  if (!(ctx.pkg.driveTimes ?? []).length)
    return { notCheckable: { reason: "data_missing", detail: "no_drive_time_facts" } };
  if (ctx.hasRedFlag() && param(rule, "red_flag_adjustment") !== undefined) {
    return {
      notCheckable: {
        reason: "data_missing",
        detail: "red_flag_adjusted_value_must_come_from_race_control",
      },
    };
  }
  return null;
}

function driverTimes(ctx: RaceCtx, car: CarId): Map<number, DriveTime> {
  const m = new Map<number, DriveTime>();
  for (const d of ctx.pkg.driveTimes ?? []) if (d.car === car) m.set(d.driver, d);
  return m;
}

/** Driver numbers to evaluate: the nominated drivers, plus any number that has drive time. */
function driverNumbers(
  ctx: RaceCtx,
  car: CarId,
  times: Map<number, DriveTime>
): number[] {
  const s = new Set<number>([
    ...(ctx.entries.get(car)?.drivers ?? []).map((d) => d.number),
    ...times.keys(),
  ]);
  return [...s].sort((a, b) => a - b);
}

function started(ctx: RaceCtx, car: CarId): boolean {
  const st = ctx.entries.get(car)?.result?.status;
  return (
    st !== "dns" &&
    ((ctx.laps.get(car)?.length ?? 0) > 0 ||
      (ctx.pkg.driveTimes ?? []).some((d) => d.car === car))
  );
}

function evidenceFor(
  car: CarId,
  dt: DriveTime | undefined,
  resultId: string | undefined
) {
  return [
    ...ev("drive_time", dt?.id),
    ...(dt?.stintIds ?? []).map((id) => ({ label: "stint", factId: id })),
    ...ev("result", resultId),
  ];
}

export const minDriveTimeHandler: CheckHandler = {
  name: "min_drive_time_per_driver",
  required: () => ["value_s"],
  run: ({ ctx, rule, cars }: CheckInput): CheckOutput | NotCheckableOut => {
    const nc = preconditions(ctx, rule);
    if (nc) return nc;
    const out = emptyOutput();
    const min = num(rule, "value_s")!;
    const tol = tolerance(ctx, "drive_time_s");
    const exemptBelow = num(rule, "exempt_if_car_race_time_fraction_below");
    const dur = ctx.publishedDurationS;
    if (exemptBelow !== null && dur === null)
      out.notes.push("published_duration_unknown_exemption_not_applied");
    for (const car of cars) {
      if (!started(ctx, car)) {
        out.notEvaluated.push({ car, reason: "did_not_start" });
        continue;
      }
      const times = driverTimes(ctx, car);
      const carTotal = [...times.values()].reduce((s, d) => s + d.driveTimeS, 0);
      const carFrac = dur ? carTotal / dur : null;
      const result = ctx.entries.get(car)?.result ?? null;
      for (const n of driverNumbers(ctx, car, times)) {
        out.evaluated++;
        const dt = times.get(n);
        const t = dt?.driveTimeS ?? 0;
        if (t >= min - 1e-9) {
          out.passed++;
          continue;
        }
        let { severity, notes: sevNotes } = toleranceSeverity(
          rule.severity,
          min - t,
          tol
        );
        const notes: string[] = [`driver_number_${n}`];
        if (!dt) notes.push("driver_has_no_drive_time");
        if (exemptBelow !== null && carFrac !== null && carFrac < exemptBelow) {
          severity = "info" as Severity;
          sevNotes = [...sevNotes, "car_below_race_time_fraction_exempt"];
          notes.push(`car_race_time_fraction_${r3(carFrac)}`);
        }
        out.findings.push({
          car,
          class: ctx.classOf(car),
          severity,
          severityNotes: sevNotes,
          lap: null,
          clock: null,
          raceTimeS: null,
          measured: r3(t),
          measuredRange: null,
          threshold: min,
          marginS: r3(t - min),
          unit: "s",
          evidence: evidenceFor(car, dt, result?.id),
          raceControl: raceControlFor(ctx, car, DRIVE_TIME_PENALTY),
          confidence: minConf(dt?.confidence ?? "medium"),
          notes,
        });
      }
    }
    return out;
  },
};

export const maxDriveTimeHandler: CheckHandler = {
  name: "max_drive_time_per_driver",
  required: () => ({ anyOf: ["value_s", "by_driver_count"] }),
  run: ({ ctx, rule, cars }: CheckInput): CheckOutput | NotCheckableOut => {
    const nc = preconditions(ctx, rule);
    if (nc) return nc;
    const out = emptyOutput();
    const tol = tolerance(ctx, "drive_time_s");
    const byCount = param<Record<string, unknown>>(rule, "by_driver_count");
    const flat = num(rule, "value_s");
    for (const car of cars) {
      if (!started(ctx, car)) {
        out.notEvaluated.push({ car, reason: "did_not_start" });
        continue;
      }
      const nominated = ctx.entries.get(car)?.drivers.length ?? 0;
      const byN =
        byCount && typeof byCount === "object" ? byCount[String(nominated)] : undefined;
      const limit = typeof byN === "number" ? byN : flat;
      if (limit === null) {
        out.notEvaluated.push({ car, reason: `no_limit_for_${nominated}_driver_car` });
        continue;
      }
      const times = driverTimes(ctx, car);
      const result = ctx.entries.get(car)?.result ?? null;
      for (const n of driverNumbers(ctx, car, times)) {
        out.evaluated++;
        const dt = times.get(n);
        const t = dt?.driveTimeS ?? 0;
        if (t <= limit + 1e-9) {
          out.passed++;
          continue;
        }
        const { severity, notes: sevNotes } = toleranceSeverity(
          rule.severity,
          t - limit,
          tol
        );
        out.findings.push({
          car,
          class: ctx.classOf(car),
          severity,
          severityNotes: sevNotes,
          lap: null,
          clock: null,
          raceTimeS: null,
          measured: r3(t),
          measuredRange: null,
          threshold: limit,
          marginS: r3(t - limit),
          unit: "s",
          evidence: evidenceFor(car, dt, result?.id),
          raceControl: raceControlFor(ctx, car, DRIVE_TIME_PENALTY),
          confidence: minConf(dt?.confidence ?? "medium"),
          notes: [
            `driver_number_${n}`,
            ...(typeof byN === "number" ? [`limit_for_${nominated}_driver_car`] : []),
          ],
        });
      }
    }
    return out;
  },
};

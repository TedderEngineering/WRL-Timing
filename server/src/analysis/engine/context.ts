/**
 * M1 time axis (D-TIME, D-DATE), M2 lap table (D-LAP) and the shared engine context.
 */
import type { TimePoint } from "../schema/package-types.js";
import type { BuildOptions, CanonicalRace, CarId, Issue, LineFlag } from "../types.js";
import { classSlug, isoLocal, carOrder, rd, zoneOffsetForLocal, formatOffset } from "../util.js";

export interface LapRow {
  car: CarId;
  idx: number;
  lap: number;
  row: number;
  fileId: string;
  lapTimeS: number | null;
  /** Absolute crossing instant (adapter axis). */
  endT: number;
  startT: number;
  /** endT - startT. */
  durationS: number;
  span: number;
  flag: LineFlag;
  inPit: boolean;
  lastInPit: boolean;
  crossedInPit: boolean;
  pitTimeS: number | null;
  driver: number | null;
  driverName: string | null;
  speedKph: number | null;
  topSpeedKph: number | null;
  // filled by later modules
  fcy: 0 | 1 | 2;
  fcyFrac: number;
  pit: number;
  pos: number;
  cpos: number;
  lapsDown: number;
  clean: 0 | 1;
}

export type LapRows = Record<CarId, LapRow[]>;

export interface TimeAxis {
  /** Absolute instant of raceTimeS = 0 on the adapter axis. */
  origin: number;
  originSource: "flags_green" | "first_lap_start" | "manual";
  raceDate: string;
  timezone: string;
  /** UTC offset (minutes) on the race date; null when unknown. */
  offsetMinutes: number | null;
  /** Local seconds since midnight of raceDate for an adapter instant; null for the WRL website axis. */
  hasClock: boolean;
  /** adapter-axis seconds → local seconds since midnight of raceDate. */
  clockShift: number;
  timeOriginIso: string;
}

export interface ClassInfo {
  id: string;
  name: string;
  order: number;
}

export interface Ctx {
  race: CanonicalRace;
  opts: BuildOptions;
  axis: TimeAxis;
  laps: LapRows;
  cars: CarId[];
  classOf: Record<CarId, string>;
  classes: ClassInfo[];
  /** Last crossing of the race (any car). */
  raceEndT: number;
  /** Chequered flag instant: flags FF record, else the leader's finish crossing. */
  chequerT: number;
  issues: Issue[];
  fileIds: (role: string) => string[];
}

export function tp(ctx: Ctx, absT: number): TimePoint {
  const out: TimePoint = { raceTimeS: rd(absT - ctx.axis.origin) };
  if (ctx.axis.hasClock && ctx.axis.offsetMinutes !== null) {
    out.clock = isoLocal(ctx.axis.raceDate, absT + ctx.axis.clockShift, ctx.axis.offsetMinutes);
  }
  return out;
}

/* ------------------------------------------------------------------ M1 */

export function buildTimeAxis(race: CanonicalRace, opts: BuildOptions, issues: Issue[]): TimeAxis {
  const timezone = opts.track?.timezone ?? "UTC";
  if (!opts.track?.timezone) {
    issues.push({ severity: "warning", code: "TIMEZONE-UNKNOWN", message: "No track time zone configured; clock values use UTC offset +00:00 unless the files give one." });
  }
  // origin
  let origin: number | null = null;
  let originSource: TimeAxis["originSource"] = "first_lap_start";
  const gf = race.flagRecords.filter((r) => r.recType.toUpperCase() === "GF").map((r) => r.tS);
  if (gf.length) {
    origin = Math.min(...gf);
    originSource = "flags_green";
  } else {
    const starts: number[] = [];
    for (const ls of Object.values(race.laps)) {
      const l1 = ls.find((x) => x.lap === 1);
      if (l1 && l1.lapTimeS !== null) starts.push(l1.tS - l1.lapTimeS);
    }
    origin = starts.length ? Math.min(...starts) : Math.min(...Object.values(race.laps).flatMap((ls) => ls.map((x) => x.tS)));
  }

  // date (D-DATE)
  let raceDate: string | null = null;
  const firm = race.session.dateCandidates.filter((c) => !c.ambiguous);
  const amb = race.session.dateCandidates.filter((c) => c.ambiguous && !/cross-check/.test(c.source));
  if (firm.length) {
    raceDate = firm[0].date;
    const others = firm.filter((c) => c.date !== raceDate);
    if (others.length) {
      issues.push({ severity: "warning", code: "DATE-SOURCE-DISAGREE", message: `Race date ${raceDate} (${firm[0].source}) disagrees with ${others.map((o) => `${o.date} (${o.source})`).join(", ")}.` });
    }
    for (const a of amb) {
      if (a.date !== raceDate) {
        issues.push({ severity: "warning", code: "DATE-SOURCE-DISAGREE", message: `DD-MM date ${a.date} (${a.source}) disagrees with ${raceDate}.` });
      }
    }
  } else if (amb.length) {
    raceDate = amb[0].date;
    if (!opts.raceDate || opts.raceDate !== raceDate) {
      issues.push({
        severity: "blocker",
        code: "DATE-AMBIGUOUS",
        message: `Race date read as ${raceDate} from ${amb[0].source} (DD-MM-YYYY) but day and month are both <= 12 and no second source agrees. Confirm the date.`,
      });
    }
  }
  if (opts.raceDate) {
    if (raceDate && raceDate !== opts.raceDate) {
      issues.push({ severity: "warning", code: "DATE-SOURCE-DISAGREE", message: `Owner-supplied date ${opts.raceDate} differs from the file date ${raceDate}; the file date is used.` });
    } else raceDate = opts.raceDate;
  }
  if (!raceDate) {
    issues.push({ severity: "blocker", code: "DATE-AMBIGUOUS", message: "No dated source: the race date must be entered by the owner (D-DATE)." });
    raceDate = "1970-01-01";
  }

  const hasClock = race.timeBase === "clock";
  let clockShift = 0;
  let offsetMinutes: number | null = null;
  let timeOriginIso: string;
  if (hasClock) {
    // Adapter clocks are seconds after local midnight of the adapter's own base date, which is the race date.
    const fromFiles = race.session.utcOffsetCandidates[0]?.offsetMinutes;
    const fromZone = opts.track?.timezone ? zoneOffsetForLocal(timezone, raceDate, origin) : null;
    offsetMinutes = fromFiles ?? fromZone ?? 0;
    if (fromFiles !== undefined && fromZone !== null && fromFiles !== fromZone) {
      issues.push({
        severity: "warning",
        code: "TIMEZONE-DISAGREE",
        message: `UTC offset from the files (${formatOffset(fromFiles)}) differs from the track zone ${timezone} (${formatOffset(fromZone)}); the file offset is used.`,
      });
    }
    timeOriginIso = isoLocal(raceDate, origin, offsetMinutes);
  } else {
    // WRL website: no time of day. Origin wall clock is owner-supplied (manual), else local midnight.
    const sc = opts.startClock?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/);
    const startSec = sc ? Number(sc[1]) * 3600 + Number(sc[2]) * 60 + Number(sc[3] ?? 0) : 0;
    offsetMinutes = opts.track?.timezone ? zoneOffsetForLocal(timezone, raceDate, startSec) : 0;
    timeOriginIso = isoLocal(raceDate, startSec, offsetMinutes);
    originSource = "manual";
    if (!sc) {
      issues.push({ severity: "note", code: "TIME-ORIGIN-MANUAL", message: "The WRL website export has no time of day; timeOrigin is the race date at local midnight until the owner enters the start time. raceTimeS is unaffected." });
    }
  }
  return { origin, originSource, raceDate, timezone, offsetMinutes, hasClock, clockShift, timeOriginIso };
}

/* ------------------------------------------------------------------ M2 */

export function buildLaps(race: CanonicalRace, axis: TimeAxis): LapRows {
  const out: LapRows = {};
  for (const [car, ls] of Object.entries(race.laps)) {
    const rows: LapRow[] = [];
    ls.forEach((x, i) => {
      const prev = i > 0 ? rows[i - 1] : null;
      const startT = prev ? prev.endT : x.lapTimeS !== null ? x.tS - x.lapTimeS : axis.origin;
      rows.push({
        car,
        idx: i,
        lap: x.lap,
        row: x.row,
        fileId: x.fileId,
        lapTimeS: x.lapTimeS,
        endT: x.tS,
        startT,
        durationS: x.tS - startT,
        span: x.span,
        flag: x.flag,
        inPit: !!x.inPit,
        lastInPit: !!x.lastInPit,
        crossedInPit: !!x.crossedInPit,
        pitTimeS: x.pitTimeS ?? null,
        driver: x.driverNumber ?? null,
        driverName: x.driverName ?? null,
        speedKph: x.speedKph ?? null,
        topSpeedKph: x.topSpeedKph ?? null,
        fcy: 0,
        fcyFrac: 0,
        pit: 0,
        pos: 0,
        cpos: 0,
        lapsDown: 0,
        clean: 0,
      });
    });
    out[car] = rows;
  }
  return out;
}

/** Duration used to sum a passage's laps: the official lap time, or the elapsed difference for blank / span rows (D-LAP). */
export function lossLapTime(r: LapRow): number {
  return r.lapTimeS !== null && r.span === 1 ? r.lapTimeS : r.durationS;
}

export function buildClasses(race: CanonicalRace): { classes: ClassInfo[]; classOf: Record<CarId, string> } {
  const order: string[] = [];
  const classOf: Record<string, string> = {};
  const names = new Map<string, string>();
  for (const e of race.entries) {
    const id = classSlug(e.className);
    if (!names.has(id)) {
      names.set(id, e.className.trim() || id);
      order.push(id);
    }
    classOf[e.car] = id;
  }
  return { classes: order.map((id, i) => ({ id, name: names.get(id)!, order: i + 1 })), classOf };
}

export function sortedCars(cars: Iterable<string>): string[] {
  return [...cars].sort(carOrder);
}

/** First row whose interval contains t (start < t <= end); else the first row ending at/after t; else null. */
export function lapAt(rows: LapRow[], t: number): LapRow | null {
  for (const r of rows) if (r.endT >= t && r.startT < t + 1e-6) return r;
  for (const r of rows) if (r.endT >= t) return r;
  return null;
}

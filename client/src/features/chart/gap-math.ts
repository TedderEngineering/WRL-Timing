import type { CarData, LapData, RaceChartData } from "@shared/types";
import { carNo } from "./car-number";
import { isGreenFlag } from "./flags";

/**
 * Gaps between cars, shared by the Gap evolution and Head-to-head panels.
 *
 * The gap is real time on track: when the car crossed the line at the end of a lap, minus when
 * the other car crossed the line at the end of the same lap. Crossing clock times (`hr`) are used
 * when the source has them; otherwise the car's lap times are added up from lap 1. Positive =
 * the car is behind. Rates leave out caution laps and in- and out-laps, so a stop or a safety car
 * does not read as pace.
 */

const lapIndexCache = new WeakMap<CarData, Map<number, LapData>>();

/** A car's lap record by lap number. */
export function lapOf(car: CarData | undefined, lap: number): LapData | undefined {
  if (!car) return undefined;
  let idx = lapIndexCache.get(car);
  if (!idx) {
    idx = new Map(car.laps.map((l) => [l.l, l]));
    lapIndexCache.set(car, idx);
  }
  return idx.get(lap);
}

const clockCache = new WeakMap<RaceChartData, boolean>();

/** Whether this race's laps carry crossing clock times (nearly all of them do, or none). */
export function usesClock(data: RaceChartData): boolean {
  let v = clockCache.get(data);
  if (v === undefined) {
    let n = 0;
    let withClock = 0;
    for (const c of Object.values(data.cars)) {
      for (const l of c.laps) {
        n++;
        if (typeof l.hr === "number" && l.hr > 0) withClock++;
      }
    }
    v = n > 0 && withClock / n >= 0.9;
    clockCache.set(data, v);
  }
  return v;
}

const crossingCache = new WeakMap<RaceChartData, Map<number, Map<number, number>>>();

/** When the car crossed the line at the end of each lap, in seconds on one race clock. */
export function crossingTimes(data: RaceChartData, num: number): Map<number, number> {
  let perRace = crossingCache.get(data);
  if (!perRace) {
    perRace = new Map();
    crossingCache.set(data, perRace);
  }
  const hit = perRace.get(num);
  if (hit) return hit;
  const out = new Map<number, number>();
  const car = data.cars[String(num)];
  if (car) {
    const laps = [...car.laps].sort((a, b) => a.l - b.l);
    if (usesClock(data)) {
      // Clock times are seconds from midnight: carry over midnight (24-hour races, night starts).
      let day = 0;
      let prev: number | null = null;
      for (const l of laps) {
        if (typeof l.hr !== "number" || l.hr <= 0) continue;
        if (prev !== null && l.hr + day < prev - 43200) day += 86400;
        const t = l.hr + day;
        out.set(l.l, t);
        prev = t;
      }
    } else {
      let t = 0;
      let expect = 1;
      for (const l of laps) {
        if (l.l !== expect || !(l.ltSec > 0)) break; // a missing lap breaks the running total
        t += l.ltSec;
        out.set(l.l, t);
        expect++;
      }
    }
  }
  perRace.set(num, out);
  return out;
}

/**
 * A clean lap: green, not the lap into or out of the pits, and quicker than the race's
 * green-pace cutoff (a slow lap with no flag on it — a spin, a drive-through, a car limping in).
 */
export function isCleanLap(data: RaceChartData, car: CarData | undefined, lap: number): boolean {
  const l = lapOf(car, lap);
  if (!l || !(l.ltSec > 1) || !isGreenFlag(l.flag) || l.pit) return false;
  if (data.greenPaceCutoff > 0 && l.ltSec >= data.greenPaceCutoff) return false;
  return !lapOf(car, lap - 1)?.pit;
}

// ---- What to measure against ----

export type GapTargetKind = "ahead" | "behind" | "classLeader" | "leader" | "classAvg" | "chartAvg" | "fieldAvg" | "cars";

export interface GapTarget {
  kind: GapTargetKind;
  /** The cars measured against; more than one = their average. */
  cars: number[];
  /** "Car ahead in class", "GS class average"… */
  name: string;
}

/** The car at a class (or overall) position on a lap. */
export function carAtPosition(data: RaceChartData, lap: number, pos: number, cls: string | null): number | null {
  for (const [k, c] of Object.entries(data.cars)) {
    if (cls !== null && c.cls !== cls) continue;
    const l = lapOf(c, lap);
    if (l && (cls === null ? l.p : l.cp) === pos) return Number(k);
  }
  return null;
}

/** The focus car's lap record at the lap, or its last lap before it (a car that has stopped). */
function lapAtOrBefore(car: CarData | undefined, lap: number): LapData | undefined {
  for (let l = lap; l >= 1; l--) {
    const rec = lapOf(car, l);
    if (rec) return rec;
  }
  return undefined;
}

export const TARGET_NAMES: Record<GapTargetKind, string> = {
  ahead: "Car ahead in class",
  behind: "Car behind in class",
  classLeader: "Class leader",
  leader: "Overall leader",
  classAvg: "Class average",
  chartAvg: "Cars on the chart",
  fieldAvg: "Whole field average",
  cars: "Chosen cars",
};

/**
 * Which cars a target means at the selected lap. Single-car targets are worked out once, at that
 * lap, and kept for the whole window, so the line never jumps from one car to another.
 */
export function resolveTarget(
  data: RaceChartData,
  focus: number,
  kind: GapTargetKind,
  lap: number,
  opts: { compSet?: Set<number>; cars?: number[] } = {},
): GapTarget | null {
  const car = data.cars[String(focus)];
  const at = lapAtOrBefore(car, lap);
  const others = (nums: Iterable<number>) => [...nums].filter((n) => n !== focus && data.cars[String(n)]);
  const one = (n: number | null): GapTarget | null =>
    n === null || n === focus ? null : { kind, cars: [n], name: TARGET_NAMES[kind] };
  switch (kind) {
    case "ahead":
      return at && at.cp > 1 ? one(carAtPosition(data, at.l, at.cp - 1, car!.cls)) : null;
    case "behind":
      return at ? one(carAtPosition(data, at.l, at.cp + 1, car!.cls)) : null;
    case "classLeader":
      return at ? one(carAtPosition(data, at.l, 1, car!.cls)) : null;
    case "leader":
      return at ? one(carAtPosition(data, at.l, 1, null)) : null;
    case "classAvg": {
      const cars = others(data.classGroups?.[car?.cls ?? ""] ?? []);
      return cars.length ? { kind, cars, name: `${car!.cls} class average` } : null;
    }
    case "chartAvg": {
      const cars = others(opts.compSet ?? []);
      return cars.length ? { kind, cars, name: TARGET_NAMES.chartAvg } : null;
    }
    case "fieldAvg": {
      const cars = others(Object.keys(data.cars).map(Number));
      return cars.length ? { kind, cars, name: TARGET_NAMES.fieldAvg } : null;
    }
    case "cars": {
      const cars = others(opts.cars ?? []);
      if (!cars.length) return null;
      return { kind, cars, name: cars.length === 1 ? `#${carNo(data, cars[0])}` : `Average of ${cars.length} cars` };
    }
  }
}

// ---- The gap, lap by lap ----

export interface GapRow {
  lap: number;
  /** Seconds behind the target at the end of this lap (negative = ahead); null when unknown. */
  gap: number | null;
  /** How the gap moved on this lap (negative = the focus car gained). */
  change: number | null;
  focusLt: number | null;
  /** The target's lap time (the average over the cars for a group). */
  targetLt: number | null;
  /** The focus car's lap was not green. */
  caution: boolean;
  focusPit: boolean;
  /** Only for a single-car target. */
  targetPit: boolean;
  /** Both cars ran a clean lap (green, no in- or out-lap): counts toward pace and rates. */
  clean: boolean;
}

/**
 * The gap at the end of each lap from `from` to `to`. Against one car it is the difference in
 * crossing times. Against a group it starts as the difference to the group's average crossing
 * time and then moves by the difference to the group's average lap time, so a car retiring from
 * the group does not make the line jump.
 */
export function gapSeries(data: RaceChartData, focus: number, targets: number[], from: number, to: number): GapRow[] {
  const focusCar = data.cars[String(focus)];
  const ft = crossingTimes(data, focus);
  const single = targets.length === 1 ? data.cars[String(targets[0])] : undefined;
  const targetTimes = targets.map((n) => crossingTimes(data, n));
  const targetCars = targets.map((n) => data.cars[String(n)]);
  const rows: GapRow[] = [];
  let prev: number | null = null;
  for (let lap = Math.max(1, from); lap <= to; lap++) {
    const fl = lapOf(focusCar, lap);
    const focusLt = fl && fl.ltSec > 1 ? fl.ltSec : null;
    let targetLt: number | null = null;
    let gap: number | null = null;
    if (single) {
      const tl = lapOf(single, lap);
      targetLt = tl && tl.ltSec > 1 ? tl.ltSec : null;
      const a = ft.get(lap);
      const b = targetTimes[0].get(lap);
      gap = a !== undefined && b !== undefined ? a - b : null;
    } else {
      let sum = 0;
      let n = 0;
      for (const c of targetCars) {
        const l = lapOf(c, lap);
        if (l && l.ltSec > 1) {
          sum += l.ltSec;
          n++;
        }
      }
      targetLt = n ? sum / n : null;
      if (prev !== null && focusLt !== null && targetLt !== null) {
        gap = prev + (focusLt - targetLt);
      } else {
        const a = ft.get(lap);
        let s = 0;
        let m = 0;
        for (const t of targetTimes) {
          const v = t.get(lap);
          if (v !== undefined) {
            s += v;
            m++;
          }
        }
        gap = a !== undefined && m ? a - s / m : null;
      }
    }
    const focusPit = !!fl?.pit;
    const targetPit = !!(single && lapOf(single, lap)?.pit);
    const clean = isCleanLap(data, focusCar, lap) && (single ? isCleanLap(data, single, lap) : targetLt !== null);
    rows.push({
      lap,
      gap,
      change: gap !== null && prev !== null ? gap - prev : null,
      focusLt,
      targetLt,
      caution: !!fl && !isGreenFlag(fl.flag),
      focusPit,
      targetPit,
      clean,
    });
    prev = gap;
  }
  return rows;
}

/** How the gap is moving: average change per lap over the last `n` clean laps (negative = gaining). */
export function gapRate(rows: GapRow[], n = 5): { rate: number; laps: number } | null {
  const picked = rows.filter((r) => r.clean && r.change !== null).slice(-n);
  if (picked.length < 2) return null;
  return { rate: picked.reduce((s, r) => s + r.change!, 0) / picked.length, laps: picked.length };
}

/** The first lap of the focus car's current stint: the lap after its last stop before `lap`. */
export function stintStart(data: RaceChartData, focus: number, lap: number): number {
  const car = data.cars[String(focus)];
  for (let l = lap - 1; l >= 1; l--) if (lapOf(car, l)?.pit) return l + 1;
  return 1;
}

export type WindowKind = "recent" | "stint" | "race";

/** The first lap shown for a window ending at `lap`. */
export function windowStart(data: RaceChartData, focus: number, lap: number, kind: WindowKind, recent: number): number {
  if (kind === "race") return 1;
  const recentStart = Math.max(1, lap - recent + 1);
  if (kind === "recent") return recentStart;
  const s = stintStart(data, focus, lap);
  return lap - s < 2 ? recentStart : s;
}

/**
 * Where another car is relative to the focus car when the focus car finished `lap`: whole laps
 * when they are on different laps (positive = the other car is behind), else seconds (positive =
 * behind).
 */
export function relativeTo(data: RaceChartData, focus: number, other: number, lap: number): { laps: number; sec: number | null } {
  const ft = crossingTimes(data, focus);
  const ot = crossingTimes(data, other);
  const tf = ft.get(lap);
  if (tf === undefined) return { laps: 0, sec: null };
  let done = 0;
  for (const [l, t] of ot) if (t <= tf && l > done) done = l;
  const lapsAhead = done - lap;
  if (lapsAhead >= 1) return { laps: -lapsAhead, sec: null };
  const to = ot.get(lap);
  if (to === undefined) {
    const last = Math.max(0, ...ot.keys());
    return last < lap ? { laps: lap - last, sec: null } : { laps: 0, sec: null };
  }
  const sec = to - tf;
  const otherLap = lapOf(data.cars[String(other)], lap)?.ltSec ?? 0;
  if (otherLap > 1 && sec >= otherLap) return { laps: Math.floor(sec / otherLap), sec: null };
  return { laps: 0, sec };
}

/** "4.8 s ahead", "6.3 s behind", "1 lap ahead". */
export function relativeText(rel: { laps: number; sec: number | null }): string {
  if (rel.laps !== 0) {
    const n = Math.abs(rel.laps);
    return `${n} lap${n === 1 ? "" : "s"} ${rel.laps < 0 ? "ahead" : "behind"}`;
  }
  if (rel.sec === null) return "";
  return `${Math.abs(rel.sec).toFixed(1)} s ${rel.sec < 0 ? "ahead" : "behind"}`;
}

/** Average of a car's clean laps among the last `n` laps up to `lap`. */
export function recentPace(data: RaceChartData, num: number, lap: number, n = 10): number | null {
  const car = data.cars[String(num)];
  let s = 0;
  let k = 0;
  for (let l = Math.max(1, lap - n + 1); l <= lap; l++) {
    if (isCleanLap(data, car, l)) {
      s += lapOf(car, l)!.ltSec;
      k++;
    }
  }
  return k ? s / k : null;
}

// ---- Formatting ----

/** 92.61 → "1:32.61". */
export function lapTimeText(sec: number | null): string {
  if (sec === null || !(sec > 0)) return "—";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
}

/** A gap or margin without its sign: 4.82 → "4.8", 75.2 → "1:15.2". */
export function secondsText(sec: number, digits = 1): string {
  const a = Math.abs(sec);
  if (a < 60) return a.toFixed(digits);
  const m = Math.floor(a / 60);
  return `${m}:${(a - m * 60).toFixed(digits).padStart(digits ? 3 + digits : 2, "0")}`;
}

/** A gap as a share of a lap: "5.2%". */
export function percentText(sec: number, lapSec: number | null): string {
  return lapSec && lapSec > 0 ? `${((Math.abs(sec) / lapSec) * 100).toFixed(1)}%` : "—";
}

/** Round chart ticks: about `count` steps of 1, 2 or 5 × a power of ten covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 3): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((f) => f * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(6)));
  if (out[out.length - 1] < hi) out.push(Number((out[out.length - 1] + step).toFixed(6)));
  return out;
}

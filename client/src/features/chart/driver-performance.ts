/**
 * The driver performance report: each class's drivers ranked on the average of their fastest
 * racing laps, with how spread those laps were, how they compare with the class at the same time
 * of the race, how often the driver ran in clear air, how many cars they passed on track, and when
 * in the race they drove.
 *
 * Racing laps: not lap 1, not a pit in-lap or the out-lap after it, not under a caution, within
 * CLASS_LIMIT of the class's fastest racing lap and DRIVER_LIMIT of the driver's own fastest. A
 * driver's shown laps are the fastest of those, at most SHOWN_SHARE of the laps they drove.
 *
 * Where each car was on track comes from its timing-line crossings: the clock time of each
 * crossing when the timing gives it (lap `hr`), else the sum of the car's lap times (lap 1 is
 * timed from the start, so the sum is the race time of each crossing).
 * - Car A passed car B on A's lap when B's lap, between B's crossings either side, began before
 *   A's and ended after it: B was ahead on the road when A crossed the line and behind when A
 *   crossed it again. Pit laps and caution laps of either car don't count.
 * - A lap is in clear air when no car crossed the line within CLEAR_GAP_S ahead of the driver at
 *   either end of the lap.
 *
 * Z-score: each shown lap against the class's shown laps (every driver's fastest) set within
 * Z_WINDOW_S of it, so a lap is compared with laps run in the same conditions.
 * Line crossings miss what happens between them, so both are close estimates, not a record.
 */
import type { AnnotationData, CarData, LapData, RaceChartData } from "@shared/types";
import { displayName, sameDriver } from "../my-drivers/api";
import { stintsOf } from "../my-drivers/stints";

export const CLASS_LIMIT = 1.2;
export const DRIVER_LIMIT = 1.1;
export const SHOWN_SHARE = 0.5;
export const CLEAR_GAP_S = 2;
/** The class's laps within this many seconds either side of a lap make its z-score reference. */
export const Z_WINDOW_S = 600;
/** A car that last crossed the line this long before the end stopped running. */
const STOPPED_BEFORE_END_S = 900;

export interface ShownLap {
  l: number;
  t: number;
  /** Clear air (true), in traffic (false), or not known (no crossing times). */
  clear: boolean | null;
}

export interface DriverRow {
  /** The driver's name, or null when the timing doesn't name who drove (one row for the car). */
  driver: string | null;
  carKey: string;
  carLabel: string;
  team: string;
  cls: string;
  make: string | null;
  /** Average of the shown laps; 0 when the driver has none. */
  avgLap: number;
  /** The driver's fastest racing lap. */
  fastLap: number;
  stdDev: number;
  /** Average z-score of the shown laps against the class's laps at the same time; null without enough laps around. */
  avgZ: number | null;
  /** Share of the shown laps in clear air, 0-100; null without crossing times. */
  clearAirPct: number | null;
  /** Cars passed on track over the driver's racing laps. */
  overtakes: number;
  shown: ShownLap[];
  /** Laps the driver drove, and the share of the car's laps. */
  laps: number;
  lapsPct: number;
  /** When the driver was on track, as race-time spans in seconds. */
  onTrack: [number, number][];
  /** Race time at which the car stopped, when it did and this driver drove its last lap. */
  stoppedAtS: number | null;
}

export interface ClassReport {
  cls: string;
  rows: DriverRow[];
  /** The class's fastest racing lap. */
  classBest: number;
  /** The lap-time axis the distribution is drawn against. */
  axis: { min: number; max: number; step: number };
  /** The race's length in seconds (the time-on-track axis). */
  raceS: number;
}

interface Crossing {
  /** Race time of the crossing at the end of lap `l`. */
  end: number;
  start: number;
  l: number;
  /** A lap that doesn't count as racing on track: pit in- or out-lap, or under caution. */
  excluded: boolean;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};

function fcySet(data: RaceChartData): Set<number> {
  const s = new Set<number>();
  for (const [a, b] of data.fcy) for (let l = a; l <= b; l++) s.add(l);
  return s;
}

const isGreen = (lap: LapData, fcy: Set<number>) => !fcy.has(lap.l) && (!lap.flag || ["GF", "GREEN", "G"].includes(lap.flag.toUpperCase()));

/** Laps that are not racing laps: the pit in-lap and the out-lap after it (flags and pit notes). */
function pitLaps(car: CarData, notes: { l: number }[] | undefined): Set<number> {
  const s = new Set<number>();
  for (const lap of car.laps) if (lap.pit === 1) s.add(lap.l).add(lap.l + 1);
  for (const p of notes ?? []) if (p.l > 0) s.add(p.l).add(p.l + 1);
  return s;
}

/** Each lap's crossing times in race seconds: the timing's clock times when every lap has one, else the running sum. */
function crossingsOf(car: CarData, offset: number | null, excluded: (l: LapData) => boolean): Crossing[] {
  const laps = [...car.laps].filter((l) => l.ltSec > 0).sort((a, b) => a.l - b.l);
  const out: Crossing[] = [];
  let sum = 0;
  for (const lap of laps) {
    sum += lap.ltSec;
    const end = offset !== null && lap.hr ? lap.hr - offset : sum;
    out.push({ end, start: end - lap.ltSec, l: lap.l, excluded: excluded(lap) });
  }
  return out;
}

/** The index of the last crossing at or before t (-1 when none). */
function lastAtOrBefore(xs: Crossing[], t: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid].end <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Axis step: a round number of seconds giving about five ticks. */
function niceStep(span: number): number {
  for (const s of [0.5, 1, 2, 3, 5, 10, 15, 20, 30, 60]) if (span / s <= 6) return s;
  return 120;
}

export function driverPerformance(data: RaceChartData, annotations: AnnotationData | null | undefined): ClassReport[] {
  const fcy = fcySet(data);
  const cars = Object.entries(data.cars);

  // Clock times: only when every lap has one; the offset makes them race time.
  const allHr = cars.every(([, c]) => c.laps.every((l) => !(l.ltSec > 0) || !!l.hr));
  let offset: number | null = null;
  if (allHr) {
    const starts = cars.flatMap(([, c]) => c.laps.filter((l) => l.l === 1 && l.hr).map((l) => l.hr! - l.ltSec));
    offset = starts.length ? Math.min(...starts) : null;
  }

  const excludedOf = new Map<string, Set<number>>();
  const crossings = new Map<string, Crossing[]>();
  for (const [key, car] of cars) {
    const pits = pitLaps(car, annotations?.[key]?.pits);
    excludedOf.set(key, pits);
    crossings.set(key, crossingsOf(car, offset, (l) => l.l === 1 || pits.has(l.l) || !isGreen(l, fcy)));
  }
  const raceS = Math.max(0, ...[...crossings.values()].map((xs) => (xs.length ? xs[xs.length - 1].end : 0)));
  // A crossing ahead on the road: another car's, not at the end of its pit in-lap (that one is in the pit lane).
  const roadCrossings = cars
    .flatMap(([key, car]) => {
      const inLaps = new Set(car.laps.filter((l) => l.pit === 1).map((l) => l.l));
      return (crossings.get(key) ?? []).filter((c) => !inLaps.has(c.l)).map((c) => ({ key, t: c.end }));
    })
    .sort((a, b) => a.t - b.t);
  const roadTimes = roadCrossings.map((c) => c.t);

  /** Seconds to the nearest other car that crossed the line before `t`. */
  const gapAhead = (key: string, t: number): number => {
    let lo = 0;
    let hi = roadTimes.length - 1;
    let i = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (roadTimes[mid] < t) {
        i = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    for (; i >= 0; i--) if (roadCrossings[i].key !== key) return t - roadTimes[i];
    return Infinity;
  };

  /** Cars passed on track on one of the car's laps: their lap began before ours and ended after it (their racing laps only). */
  const passesOn = (key: string, x: Crossing): number => {
    let made = 0;
    for (const [other, xs] of crossings) {
      if (other === key) continue;
      const i = lastAtOrBefore(xs, x.start);
      if (i < 0 || i + 1 >= xs.length) continue;
      const theirs = xs[i + 1];
      if (theirs.l === xs[i].l + 1 && xs[i].end < x.start && theirs.end > x.end && !theirs.excluded) made++;
    }
    return made;
  };

  const byClass = new Map<string, [string, CarData][]>();
  for (const entry of cars) {
    const list = byClass.get(entry[1].cls) ?? [];
    list.push(entry);
    byClass.set(entry[1].cls, list);
  }

  const reports: ClassReport[] = [];
  for (const [cls, classCars] of byClass) {
    // The class's racing laps (before the class limit), for its fastest and the z-score reference.
    const racing = classCars.flatMap(([key, car]) => {
      const xs = crossings.get(key) ?? [];
      return xs.filter((x) => !x.excluded).map((x) => ({ key, x, t: car.laps.find((l) => l.l === x.l)!.ltSec }));
    });
    if (!racing.length) continue;
    const classBest = Math.min(...racing.map((r) => r.t));
    const rows: DriverRow[] = [];
    const shownEnds: { end: number; t: number; row: number }[] = [];
    for (const [key, car] of classCars) {
      const xs = crossings.get(key) ?? [];
      if (!xs.length) continue;
      const carLaps = car.laps.filter((l) => l.ltSec > 0).length;
      const notes = annotations?.[key]?.pits;
      const sole = car.drivers?.length === 1 ? car.drivers[0] : null;
      const stints = stintsOf(car.laps, notes, sole, car.drivers ?? []);
      const named = stints.some((s) => s.driver);
      // One group per driver (names matched however spelled); one for the whole car when nobody is named.
      const groups: { driver: string | null; stints: typeof stints }[] = [];
      for (const s of named ? stints : stints.map((x) => ({ ...x, driver: null }))) {
        const g = groups.find((x) => (x.driver === null && s.driver === null) || (x.driver && s.driver && sameDriver(x.driver, s.driver)));
        if (g) g.stints.push(s);
        else groups.push({ driver: s.driver, stints: [s] });
      }
      const lastEnd = xs[xs.length - 1].end;
      const stopped = raceS - lastEnd > STOPPED_BEFORE_END_S || ["dnf", "nc", "dsq"].includes(car.status?.toLowerCase() ?? "");
      const lastLap = xs[xs.length - 1].l;

      for (const g of groups) {
        const inMine = (l: number) => g.stints.some((s) => l >= s.start && l <= s.end);
        const mine = xs.filter((x) => inMine(x.l));
        if (!mine.length) continue;
        const racingMine = mine
          .filter((x) => !x.excluded)
          .map((x) => ({ x, t: car.laps.find((l) => l.l === x.l)!.ltSec }))
          .filter((r) => r.t <= classBest * CLASS_LIMIT);
        const ownBest = racingMine.length ? Math.min(...racingMine.map((r) => r.t)) : 0;
        const eligible = racingMine.filter((r) => r.t <= ownBest * DRIVER_LIMIT).sort((a, b) => a.t - b.t);
        const shownN = Math.min(Math.floor(mine.length * SHOWN_SHARE), eligible.length);
        const shownRaw = eligible.slice(0, shownN);
        // A car that names its drivers: a stint without a name (a lap or two before the first change) is left out.
        if (g.driver === null && named && !shownRaw.length) continue;

        const shown: ShownLap[] = shownRaw.map(({ x, t }) => ({
          l: x.l,
          t,
          clear: gapAhead(key, x.start) >= CLEAR_GAP_S && gapAhead(key, x.end) >= CLEAR_GAP_S,
        }));
        const overtakes = mine.filter((x) => !x.excluded).reduce((n, x) => n + passesOn(key, x), 0);
        shownEnds.push(...shownRaw.map(({ x, t }) => ({ end: x.end, t, row: rows.length })));
        const times = shown.map((s) => s.t);

        // Time on track: the driver's stints as race-time spans.
        const onTrack: [number, number][] = g.stints
          .map((s) => {
            const inStint = xs.filter((x) => x.l >= s.start && x.l <= s.end);
            return inStint.length ? ([inStint[0].start, inStint[inStint.length - 1].end] as [number, number]) : null;
          })
          .filter((s): s is [number, number] => !!s);

        rows.push({
          driver: g.driver ? displayName(g.driver) : null,
          carKey: key,
          carLabel: car.label ?? String(car.num),
          team: car.team.replace(/\s*\([^()]*\)\s*$/, ""),
          cls,
          make: car.make ?? car.vehicle ?? null,
          avgLap: times.length ? mean(times) : 0,
          fastLap: ownBest,
          stdDev: stdev(times),
          avgZ: null,
          clearAirPct: shown.length ? (shown.filter((s) => s.clear).length / shown.length) * 100 : null,
          overtakes,
          shown,
          laps: mine.length,
          lapsPct: carLaps ? (mine.length / carLaps) * 100 : 0,
          onTrack,
          stoppedAtS: stopped && inMine(lastLap) ? lastEnd : null,
        });
      }
    }

    // Z-scores against the class's shown laps around each lap.
    shownEnds.sort((a, b) => a.end - b.end);
    const zsByRow = new Map<number, number[]>();
    let lo = 0;
    let hi = 0;
    for (const lap of shownEnds) {
      while (shownEnds[lo].end < lap.end - Z_WINDOW_S) lo++;
      while (hi < shownEnds.length && shownEnds[hi].end <= lap.end + Z_WINDOW_S) hi++;
      if (hi - lo < 5) continue;
      const around = shownEnds.slice(lo, hi).map((s) => s.t);
      const sd = stdev(around);
      if (!(sd > 0)) continue;
      const list = zsByRow.get(lap.row) ?? [];
      list.push((lap.t - mean(around)) / sd);
      zsByRow.set(lap.row, list);
    }
    rows.forEach((r, i) => {
      const zs = zsByRow.get(i);
      r.avgZ = zs?.length ? mean(zs) : null;
    });

    rows.sort((a, b) => (a.avgLap || Infinity) - (b.avgLap || Infinity) || a.carLabel.localeCompare(b.carLabel));
    const shownTimes = rows.flatMap((r) => r.shown.map((s) => s.t));
    const axisLo = shownTimes.length ? Math.min(...shownTimes) : classBest;
    const axisHi = shownTimes.length ? Math.max(...shownTimes) : classBest * CLASS_LIMIT;
    const step = niceStep(axisHi - axisLo);
    reports.push({
      cls,
      rows,
      classBest,
      axis: { min: Math.floor(axisLo / step) * step, max: Math.ceil(axisHi / step) * step, step },
      raceS,
    });
  }
  return reports.sort((a, b) => a.cls.localeCompare(b.cls));
}

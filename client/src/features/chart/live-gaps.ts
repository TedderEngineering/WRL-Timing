/**
 * The Gaps tab (RaceTrace Live): each car's last and best lap, its gap to the
 * focus car, whether the focus car is gaining or losing to it, and how many
 * laps until the next change between them if both keep their current pace.
 *
 * Times are each car's cumulative lap times (the chart's own convention for
 * the time axis). "Distance" is laps completed plus the share of the next lap
 * driven since the last crossing, at the later of the two cars' last
 * crossings. Δ = focus distance − car distance:
 *   Δ crosses 0       → a pass for position (same lap)
 *   Δ crosses +1, +2… → the focus car laps the car (puts it a lap down)
 *   Δ crosses −1, −2… → the focus car goes a lap down to the car
 * crossing back towards 0 is getting a lap back.
 *
 * Pace is the median of a car's last PACE_LAPS green laps (no pit laps, no
 * yellow laps, under the race's green-pace cutoff). A projection is a straight
 * line: it is left out when either car has no pace, is stopped or in the pits,
 * or the two paces are within STEADY_S of each other.
 */
import type { RaceChartData } from "@shared/types";

export const PACE_LAPS = 5;
export const MIN_PACE_LAPS = 3;
/** Pace differences below this (s/lap) count as steady. */
export const STEADY_S = 0.05;
/** A car this many paces past its last crossing is stopped or in the pits. */
const STOPPED_FACTOR = 1.35;
/** Projections further out than this are not shown. */
export const MAX_PROJECTION_LAPS = 500;

type Lap = RaceChartData["cars"][string]["laps"][number];

export type GapEvent =
  /** The focus car passes this car for position. */
  | "pass"
  /** This car passes the focus car for position. */
  | "passed"
  /** The focus car puts this car (another) lap down. */
  | "laps"
  /** The focus car goes (another) lap down to this car. */
  | "lapped"
  /** The focus car gets a lap back on this car. */
  | "unlap"
  /** This car gets a lap back on the focus car. */
  | "unlapped";

export interface GapRow {
  num: number;
  isFocus: boolean;
  pos: number | null;
  posClass: number | null;
  cls: string;
  team: string;
  laps: number;
  last: number | null;
  best: number | null;
  pace: number | null;
  /** Stopped or in the pits right now (no projection). */
  stopped: boolean;
  /** Focus distance − car distance, in laps (positive: the focus car is ahead). */
  delta: number | null;
  /** On the same lap: seconds the car is behind (+) or ahead (−) of the focus car. */
  gapSec: number | null;
  /** Car pace − focus pace (s/lap): positive = the focus car is gaining. */
  gainPerLap: number | null;
  next: { event: GapEvent; laps: number; /** laps between them after the event (0 = same lap) */ k: number } | null;
}

function fcyLapSet(data: RaceChartData): Set<number> {
  const s = new Set<number>();
  for (const [a, b] of data.fcy ?? []) for (let l = a; l <= b; l++) s.add(l);
  return s;
}

const isPaceLap = (l: Lap, data: RaceChartData, fcy: Set<number>) =>
  l.pit === 0 && l.ltSec > 1 && l.ltSec < data.greenPaceCutoff && !fcy.has(l.l) && (l.flag === undefined || l.flag === "GREEN");

export function paceOf(laps: Lap[], data: RaceChartData, fcy = fcyLapSet(data)): number | null {
  const xs: number[] = [];
  for (let i = laps.length - 1; i >= 0 && xs.length < PACE_LAPS; i--) if (isPaceLap(laps[i], data, fcy)) xs.push(laps[i].ltSec);
  if (xs.length < MIN_PACE_LAPS) return null;
  xs.sort((a, b) => a - b);
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/** Cumulative time at each completed lap (index = lap count). */
function cumulative(laps: Lap[]): number[] {
  const t = [0];
  for (const l of laps) t.push(t[t.length - 1] + l.ltSec);
  return t;
}

interface CarClock {
  laps: number;
  cum: number[];
  pace: number | null;
}

/** Laps driven at time `at` (fractional). Null when the car is stopped or has no pace. */
function distance(c: CarClock, at: number): number | null {
  const last = c.cum[c.laps];
  const p = c.pace ?? null;
  if (p === null) return at <= last + 1e-9 ? c.laps : null;
  const frac = (at - last) / p;
  if (frac > STOPPED_FACTOR) return null; // longer than STOPPED_FACTOR laps of pace since its last crossing
  return c.laps + Math.min(Math.max(frac, 0), 0.999);
}

/** The next whole-lap boundary Δ reaches, and when, if it moves at `rate` laps per focus lap. */
export function nextEvent(delta: number, rate: number): GapRow["next"] {
  if (!Number.isFinite(rate) || rate === 0) return null;
  const k = rate > 0 ? Math.floor(delta) + 1 : Math.ceil(delta) - 1;
  const laps = (k - delta) / rate;
  if (!(laps > 0) || laps > MAX_PROJECTION_LAPS) return null;
  let event: GapEvent;
  if (rate > 0) event = k === 0 ? "pass" : k > 0 ? "laps" : "unlap";
  else event = k === 0 ? "passed" : k < 0 ? "lapped" : "unlapped";
  return { event, laps, k };
}

export function gapRows(data: RaceChartData, focusNum: number, nums: number[]): GapRow[] {
  const fcy = fcyLapSet(data);
  const clocks = new Map<number, CarClock>();
  const clockOf = (n: number): CarClock | null => {
    const car = data.cars[String(n)];
    if (!car) return null;
    if (!clocks.has(n)) clocks.set(n, { laps: car.laps.length, cum: cumulative(car.laps), pace: paceOf(car.laps, data, fcy) });
    return clocks.get(n)!;
  };
  const f = clockOf(focusNum);
  const list = [...new Set([focusNum, ...nums])].filter((n) => data.cars[String(n)]);
  const rows: GapRow[] = list.map((num) => {
    const car = data.cars[String(num)];
    const c = clockOf(num)!;
    const clean = car.laps.filter((l) => l.pit === 0 && l.ltSec > 1);
    const row: GapRow = {
      num,
      isFocus: num === focusNum,
      pos: car.finishPos ?? null,
      posClass: car.finishPosClass ?? null,
      cls: car.cls,
      team: car.team,
      laps: c.laps,
      last: car.laps.length ? car.laps[car.laps.length - 1].ltSec : null,
      best: clean.length ? Math.min(...clean.map((l) => l.ltSec)) : null,
      pace: c.pace,
      stopped: false,
      delta: null,
      gapSec: null,
      gainPerLap: null,
      next: null,
    };
    if (!f || num === focusNum || c.laps === 0 || f.laps === 0) return row;
    const at = Math.max(f.cum[f.laps], c.cum[c.laps]);
    const df = distance(f, at);
    const dc = distance(c, at);
    row.stopped = dc === null;
    if (df !== null && dc !== null) row.delta = df - dc;
    // Same lap: the time between them at the last lap both completed.
    if (row.delta !== null && Math.abs(row.delta) < 1) {
      const L = Math.min(f.laps, c.laps);
      row.gapSec = c.cum[L] - f.cum[L];
    }
    if (f.pace !== null && c.pace !== null) {
      row.gainPerLap = c.pace - f.pace;
      if (row.delta !== null && Math.abs(row.gainPerLap) >= STEADY_S) row.next = nextEvent(row.delta, 1 - f.pace / c.pace);
    }
    return row;
  });
  return rows.sort((a, b) => (a.pos ?? 9999) - (b.pos ?? 9999) || a.num - b.num);
}

export interface LeaderGap {
  /** The car ahead (overall or class leader). */
  leader: number;
  /** Laps the focus car is behind it (fractional: 1.5 = a lap and a half). */
  laps: number;
  /** Those laps at the focus car's recent green pace, in seconds (null without a pace yet). */
  sec: number | null;
}

/**
 * How far the focus car is behind a car ahead, in laps and in seconds of its own recent green
 * pace (median of its last PACE_LAPS green laps). Under a caution this is the time to make up
 * once racing resumes. Null when the focus car is that car, or either has no laps.
 */
export function gapBehind(data: RaceChartData, focusNum: number, leaderNum: number): LeaderGap | null {
  if (focusNum === leaderNum) return null;
  const f = data.cars[String(focusNum)];
  const l = data.cars[String(leaderNum)];
  if (!f?.laps.length || !l?.laps.length) return null;
  const fcy = fcyLapSet(data);
  const fc: CarClock = { laps: f.laps.length, cum: cumulative(f.laps), pace: paceOf(f.laps, data, fcy) };
  const lc: CarClock = { laps: l.laps.length, cum: cumulative(l.laps), pace: paceOf(l.laps, data, fcy) };
  const at = Math.max(fc.cum[fc.laps], lc.cum[lc.laps]);
  // A car with no pace yet (or stopped) is counted at its last crossing.
  const df = distance(fc, at) ?? fc.laps;
  const dl = distance(lc, at) ?? lc.laps;
  const laps = Math.max(0, dl - df);
  const pace = fc.pace ?? lc.pace;
  return { leader: leaderNum, laps, sec: pace !== null ? laps * pace : null };
}

/** The focus car's gap to the overall leader and to its class leader (null when it leads). */
export function leaderGaps(data: RaceChartData, focusNum: number): { overall: LeaderGap | null; cls: LeaderGap | null; clsName: string } {
  const me = data.cars[String(focusNum)];
  const entries = Object.entries(data.cars);
  const overall = entries.find(([, c]) => c.finishPos === 1)?.[0];
  const clsLead = me ? entries.find(([, c]) => c.cls === me.cls && c.finishPosClass === 1)?.[0] : undefined;
  return {
    overall: overall !== undefined ? gapBehind(data, focusNum, Number(overall)) : null,
    cls: clsLead !== undefined && clsLead !== overall ? gapBehind(data, focusNum, Number(clsLead)) : null,
    clsName: me?.cls ?? "",
  };
}

/** Seconds → "56.2 s" under a minute, else "3:31". */
export function gapClock(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

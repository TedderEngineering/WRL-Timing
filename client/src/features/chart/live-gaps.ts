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
 * Between updates (RaceTrace Live), `drift` (seconds since the data arrived)
 * moves every pair of cars on at their paces from the later of their two last
 * crossings, so gaps and projections keep moving until the next update.
 * There is no race-wide "now": a car's summed lap times can run ahead of the
 * race clock (an overlapping pit lap), and it would skew every other car.
 *
 * Pace is the average of a car's last PACE_LAPS green laps (no pit laps, no
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
  /** The focus car's pace (s/lap), which turns a gap in laps into laps + seconds. */
  focusPace: number | null;
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
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * A gap of `laps` (fractional) at `pace` (s/lap), as the timing screens say it: the whole laps,
 * and the rest of the gap in seconds. 1.284 laps at 191.0 s → "54.1 (+1L)"; under a lap → "54.1".
 * Without a pace, laps to a tenth ("1.3 L").
 */
export function lapsAndSeconds(laps: number, pace: number | null): string {
  const split = splitLaps(laps, pace);
  if (!split) return `${Math.abs(laps).toFixed(1)} L`;
  return split.whole > 0 ? `${split.rest.toFixed(1)} (+${split.whole}L)` : split.rest.toFixed(1);
}

/** A gap of `laps` at `pace` as whole laps and the rest in seconds (null without a pace). */
export function splitLaps(laps: number, pace: number | null): { whole: number; rest: number } | null {
  const a = Math.abs(laps);
  if (pace === null || !(pace > 0)) return null;
  let whole = Math.floor(a + 1e-9);
  let rest = (a - whole) * pace;
  // A rest that rounds up to a full lap is the next lap.
  if (Number(rest.toFixed(1)) >= Number(pace.toFixed(1))) {
    whole += 1;
    rest = 0;
  }
  return { whole, rest };
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

/** A stopped car (in the pits or the garage) held where it stopped, near the end of its lap. */
const heldAt = (c: CarClock) => c.laps + 0.999;

/**
 * @param drift seconds since the data arrived: each pair of cars moved on at their paces from
 *   the later of their last crossings. Omit for the gaps as of the last crossings.
 */
export function gapRows(data: RaceChartData, focusNum: number, nums: number[], drift?: number | null): GapRow[] {
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
      focusPace: f?.pace ?? null,
      next: null,
    };
    if (num === focusNum && f && f.laps > 0) {
      // The focus car's own row: is it stopped, as the other cars see it?
      const latest = Math.max(...list.map((n) => clockOf(n)!.cum[clockOf(n)!.laps]));
      row.stopped = f.pace !== null && latest - f.cum[f.laps] > f.pace * STOPPED_FACTOR;
    }
    if (!f || num === focusNum || c.laps === 0 || f.laps === 0) return row;
    const at0 = Math.max(f.cum[f.laps], c.cum[c.laps]);
    const at = drift != null && Number.isFinite(drift) && drift > 0 ? at0 + drift : at0;
    const dfRun = distance(f, at);
    const dcRun = distance(c, at);
    row.stopped = dcRun === null;
    // A stopped car still has a gap (held where it stopped); only the projection needs both moving.
    const df = dfRun ?? heldAt(f);
    const dc = dcRun ?? heldAt(c);
    row.delta = df - dc;
    const bothMoving = dfRun !== null && dcRun !== null;
    // Same lap: the time between them at the last lap both completed, moved on since by the
    // pace difference (seconds per focus lap) for the time since the later crossing.
    if (row.delta !== null && Math.abs(row.delta) < 1) {
      const L = Math.min(f.laps, c.laps);
      row.gapSec = c.cum[L] - f.cum[L];
      if (at > at0 && bothMoving && f.pace !== null && c.pace !== null) row.gapSec += ((c.pace - f.pace) * (at - at0)) / f.pace;
    }
    if (f.pace !== null && c.pace !== null) {
      row.gainPerLap = c.pace - f.pace;
      if (bothMoving && Math.abs(row.gainPerLap) >= STEADY_S) row.next = nextEvent(row.delta, 1 - f.pace / c.pace);
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
  /** The pace used (s/lap): the focus car's, or the other car's when it has none yet. */
  pace: number | null;
}

/**
 * How far the focus car is behind a car ahead, in laps and in seconds of its own recent green
 * pace (average of its last PACE_LAPS green laps). Under a caution this is the time to make up
 * once racing resumes. Null when the focus car is that car, or either has no laps.
 */
export function gapBehind(data: RaceChartData, focusNum: number, leaderNum: number, drift?: number | null): LeaderGap | null {
  if (focusNum === leaderNum) return null;
  const f = data.cars[String(focusNum)];
  const l = data.cars[String(leaderNum)];
  if (!f?.laps.length || !l?.laps.length) return null;
  const fcy = fcyLapSet(data);
  const fc: CarClock = { laps: f.laps.length, cum: cumulative(f.laps), pace: paceOf(f.laps, data, fcy) };
  const lc: CarClock = { laps: l.laps.length, cum: cumulative(l.laps), pace: paceOf(l.laps, data, fcy) };
  const at0 = Math.max(fc.cum[fc.laps], lc.cum[lc.laps]);
  const at = drift != null && Number.isFinite(drift) && drift > 0 ? at0 + drift : at0;
  // A car with no pace yet is counted at its last crossing; a car stopped (in the pits) is held
  // where it stopped, near the end of its lap, so its gap grows as the other car moves on.
  const held = (c: CarClock) => (c.pace !== null && at - c.cum[c.laps] > c.pace * STOPPED_FACTOR ? c.laps + 0.999 : c.laps);
  const df = distance(fc, at) ?? held(fc);
  const dl = distance(lc, at) ?? held(lc);
  const laps = Math.max(0, dl - df);
  const pace = fc.pace ?? lc.pace;
  return { leader: leaderNum, laps, sec: pace !== null ? laps * pace : null, pace };
}

/** The focus car's gap to the overall leader and to its class leader (null when it leads). */
export function leaderGaps(data: RaceChartData, focusNum: number, drift?: number | null): { overall: LeaderGap | null; cls: LeaderGap | null; clsName: string } {
  const me = data.cars[String(focusNum)];
  const entries = Object.entries(data.cars);
  const overall = entries.find(([, c]) => c.finishPos === 1)?.[0];
  const clsLead = me ? entries.find(([, c]) => c.cls === me.cls && c.finishPosClass === 1)?.[0] : undefined;
  return {
    overall: overall !== undefined ? gapBehind(data, focusNum, Number(overall), drift) : null,
    cls: clsLead !== undefined && clsLead !== overall ? gapBehind(data, focusNum, Number(clsLead), drift) : null,
    clsName: me?.cls ?? "",
  };
}

/** Seconds, always: "56.2 s", "211 s" (a tenth under 100 s). */
export function gapClock(sec: number): string {
  const a = Math.abs(sec);
  return a < 100 ? `${a.toFixed(1)} s` : `${Math.round(a)} s`;
}

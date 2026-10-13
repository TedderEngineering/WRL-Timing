/**
 * M5 positions (D-POS) and laps down (D-LAPDOWN column).
 *
 * pos at C's crossing of lap L = 1 + the number of cars that completed lap L earlier in time. A car
 * "completes" lap L at its first row whose lap number is >= L (a WRL span row covers skipped laps),
 * which makes the lap-chart convention equal to the running order at C's own crossing.
 */
import type { CarId } from "../types.js";
import { carOrder, lowerBound, upperBound } from "../util.js";
import type { LapRows } from "./context.js";

export interface PositionIndex {
  /** Crossing instant at which car completes lap L (first row with lap >= L), or Infinity. */
  crossTime(car: CarId, L: number): number;
  lastLap(car: CarId): number;
  lastEnd(car: CarId): number;
  /** Same-class running order at lap L (D-POS "class order"). */
  classOrder(cls: string, L: number): CarId[];
  maxLap: number;
}

export function computePositions(laps: LapRows, classOf: Record<CarId, string>): PositionIndex {
  const cars = Object.keys(laps);
  const lapArr: Record<string, number[]> = {};
  const endArr: Record<string, number[]> = {};
  let maxLap = 0;
  for (const c of cars) {
    lapArr[c] = laps[c].map((r) => r.lap);
    endArr[c] = laps[c].map((r) => r.endT);
    if (lapArr[c].length) maxLap = Math.max(maxLap, lapArr[c][lapArr[c].length - 1]);
  }
  const crossTime = (c: string, L: number): number => {
    const a = lapArr[c];
    if (!a) return Infinity;
    const i = lowerBound(a, L);
    return i < a.length ? endArr[c][i] : Infinity;
  };
  const byClass = new Map<string, string[]>();
  for (const c of cars) {
    const k = classOf[c];
    byClass.set(k, [...(byClass.get(k) ?? []), c]);
  }

  // pos / cpos
  for (let L = 1; L <= maxLap; L++) {
    const all: number[] = [];
    const cls = new Map<string, number[]>();
    for (const c of cars) {
      const t = crossTime(c, L);
      if (!Number.isFinite(t)) continue;
      all.push(t);
      const k = classOf[c];
      if (!cls.has(k)) cls.set(k, []);
      cls.get(k)!.push(t);
    }
    all.sort((a, b) => a - b);
    for (const v of cls.values()) v.sort((a, b) => a - b);
    for (const c of cars) {
      const a = lapArr[c];
      const i = lowerBound(a, L);
      if (i >= a.length || a[i] !== L) continue;
      const row = laps[c][i];
      row.pos = 1 + lowerBound(all, row.endT);
      row.cpos = 1 + lowerBound(cls.get(classOf[c])!, row.endT);
    }
  }

  // lapsDown: highest lap completed by any same-class car at or before the crossing, minus L.
  for (const [, members] of byClass) {
    const xs: { t: number; lap: number }[] = [];
    for (const c of members) for (const r of laps[c]) xs.push({ t: r.endT, lap: r.lap });
    xs.sort((a, b) => a.t - b.t);
    const times = xs.map((x) => x.t);
    const prefMax: number[] = [];
    let m = 0;
    for (const x of xs) {
      m = Math.max(m, x.lap);
      prefMax.push(m);
    }
    for (const c of members) {
      for (const r of laps[c]) {
        const k = upperBound(times, r.endT + 1e-6) - 1;
        r.lapsDown = Math.max(0, (k >= 0 ? prefMax[k] : r.lap) - r.lap);
      }
    }
  }

  const orderCache = new Map<string, string[]>();
  const classOrder = (cls: string, L: number): string[] => {
    const key = `${cls}\u0000${L}`;
    const hit = orderCache.get(key);
    if (hit) return hit;
    const members = byClass.get(cls) ?? [];
    const done: { c: string; t: number }[] = [];
    const rest: { c: string; l: number; e: number }[] = [];
    for (const c of members) {
      const t = crossTime(c, L);
      if (Number.isFinite(t)) done.push({ c, t });
      else {
        const n = laps[c].length;
        rest.push({ c, l: n ? laps[c][n - 1].lap : 0, e: n ? laps[c][n - 1].endT : 0 });
      }
    }
    done.sort((a, b) => a.t - b.t || carOrder(a.c, b.c));
    rest.sort((a, b) => b.l - a.l || a.e - b.e || carOrder(a.c, b.c));
    const out = [...done.map((x) => x.c), ...rest.map((x) => x.c)];
    orderCache.set(key, out);
    return out;
  };

  return {
    crossTime,
    lastLap: (c) => (laps[c]?.length ? laps[c][laps[c].length - 1].lap : 0),
    lastEnd: (c) => (laps[c]?.length ? laps[c][laps[c].length - 1].endT : -Infinity),
    classOrder,
    maxLap,
  };
}

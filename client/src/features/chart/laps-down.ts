/**
 * Laps down ("LD"): how many laps the class leader is ahead of a car, as timing screens show it.
 *
 * Laps completed alone mislead: the moment the leader crosses the line it has a lap more than a
 * car on the same lap that has not crossed yet, which looks a lap down and is not. So a car's laps
 * down is counted at the moment of its own last crossing: the laps the class leader had completed
 * by then, less the car's. A car on the lead lap is 0.
 *
 * A car no longer crossing the line (stopped, in the garage) falls further behind while it sits:
 * once its last crossing is more than STALE_LAPS of the leader's laps old, it is counted against
 * the leader's laps now.
 *
 * The times are each car's summed lap times (the chart's own clock, as the Gaps panel).
 */
import type { RaceChartData } from "@shared/types";

/** A car whose last crossing is this many leader laps old is not running: counted against now. */
export const STALE_LAPS = 2;

type Car = RaceChartData["cars"][string];

/** Summed lap times at each completed lap, in lap order. */
function crossings(c: Car): { l: number; t: number }[] {
  let t = 0;
  return c.laps.map((x) => ((t += x.ltSec > 0 ? x.ltSec : 0), { l: x.l, t }));
}

/** The class leader: class position 1, else the most laps and the earliest to complete them. */
function classLeader(data: RaceChartData, keys: string[]): string | null {
  const first = keys.find((k) => data.cars[k].finishPosClass === 1);
  if (first) return first;
  let best: { k: string; l: number; t: number } | null = null;
  for (const k of keys) {
    const c = crossings(data.cars[k]);
    const last = c[c.length - 1];
    if (last && (!best || last.l > best.l || (last.l === best.l && last.t < best.t))) best = { k, l: last.l, t: last.t };
  }
  return best?.k ?? null;
}

/** Every car's laps down to its class leader, by chart key. Cars with no laps are left out. */
export function lapsDown(data: RaceChartData): Map<number, number> {
  const out = new Map<number, number>();
  const byClass = new Map<string, string[]>();
  for (const [k, c] of Object.entries(data.cars)) {
    if (!c.laps.length) continue;
    if (!byClass.has(c.cls)) byClass.set(c.cls, []);
    byClass.get(c.cls)!.push(k);
  }
  for (const keys of byClass.values()) {
    const lead = classLeader(data, keys);
    if (!lead) continue;
    const lc = crossings(data.cars[lead]);
    const leadNow = lc[lc.length - 1];
    const leadLap = lc.length > 1 ? (leadNow.t - lc[0].t) / (lc.length - 1) : leadNow.t;
    /** The leader's laps completed by time t. */
    const leaderLapsAt = (t: number) => {
      let lo = 0;
      let hi = lc.length - 1;
      let n = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lc[mid].t <= t + 1e-6) {
          n = lc[mid].l;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return n;
    };
    for (const k of keys) {
      if (k === lead) {
        out.set(Number(k), 0);
        continue;
      }
      const c = crossings(data.cars[k]);
      const last = c[c.length - 1];
      const stale = leadNow.t - last.t > STALE_LAPS * leadLap;
      out.set(Number(k), Math.max(0, (stale ? leadNow.l : leaderLapsAt(last.t)) - last.l));
    }
  }
  return out;
}

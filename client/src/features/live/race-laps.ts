/**
 * RaceTrace Live, at the top of the page: laps since the last green (or under this caution) and
 * laps to go.
 */
import type { RaceChartData } from "@shared/types";

/**
 * Laps of the current green run: the leader's laps since the last caution ended (the chart's FCY
 * bands, in leader laps), or since the start. Under a caution: the laps it has run so far.
 */
export function greenRun(data: RaceChartData, leaderLap: number, caution: boolean): { caution: boolean; laps: number } {
  const bands = [...(data.fcy ?? [])].filter(([a]) => a <= leaderLap).sort((x, y) => x[0] - y[0]);
  const last = bands[bands.length - 1];
  if (caution) return { caution: true, laps: last ? Math.max(1, leaderLap - last[0] + 1) : 1 };
  // A band still open at the leader's lap is a caution just ended: the green run starts after it.
  return { caution: false, laps: Math.max(0, leaderLap - (last ? Math.min(last[1], leaderLap) : 0)) };
}

/**
 * Laps to go: the time still to run at the overall leader's average lap so far (its race time over
 * its laps: stops and cautions included, as the rest of the race will have them), and the lap that
 * starts after the clock runs out. Null without a time to go or a leader.
 */
export function lapsToGo(data: RaceChartData, timeToGoS: number | null): number | null {
  if (timeToGoS === null) return null;
  const lead = Object.values(data.cars).find((c) => c.finishPos === 1);
  if (!lead || !lead.laps.length) return null;
  const total = lead.laps.reduce((a, l) => a + (l.ltSec > 0 ? l.ltSec : 0), 0);
  const avg = total / lead.laps.length;
  if (!(avg > 0)) return null;
  return timeToGoS <= 0 ? 0 : Math.ceil(timeToGoS / avg);
}

/** The class leader's laps averaged for the virtual car. */
export const VIRTUAL_LAPS = 3;

/**
 * The virtual car of each class: a car lapping at its class leader's average over its last
 * VIRTUAL_LAPS racing laps (no in- or out-laps), placed so it crosses the line exactly as the race
 * clock runs out. Where it is now (metres past the line) is the time to go at that pace, counted
 * back from the line: the class leader ahead of it on the road has one more lap to run than it.
 */
export function virtualCars(data: RaceChartData, timeToGoS: number, len: number, skip: Set<number> = new Set()): { cls: string; d: number; pace: number }[] {
  if (!(timeToGoS > 0) || !(len > 0)) return [];
  const out: { cls: string; d: number; pace: number }[] = [];
  for (const [k, c] of Object.entries(data.cars)) {
    if (c.finishPosClass !== 1 || skip.has(Number(k))) continue;
    const xs: number[] = [];
    for (let i = c.laps.length - 1; i > 0 && xs.length < VIRTUAL_LAPS; i--) {
      const l = c.laps[i];
      if (l.pit === 0 && c.laps[i - 1].pit === 0 && l.ltSec > 0) xs.push(l.ltSec);
    }
    if (xs.length < VIRTUAL_LAPS) continue;
    const pace = xs.reduce((a, b) => a + b, 0) / xs.length;
    const back = ((timeToGoS / pace) * len) % len;
    out.push({ cls: c.cls, d: (len - back) % len, pace });
  }
  return out.sort((a, b) => a.cls.localeCompare(b.cls));
}

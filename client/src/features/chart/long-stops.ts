/**
 * Long stops (RaceTrace Live): a green-flag lap that took LONG_STOP_S or more over the car's own
 * green pace — repairs in the garage, a car stranded and recovered. The timing does not always mark
 * such a lap as a pit lap (#282 at Sebring: lap 66 the pit lap, lap 67 1:40:41 with no pit mark),
 * so this goes by the lap time alone.
 */
import type { RaceChartData } from "@shared/types";

/** Time lost on one lap, over the car's green pace, that counts as a long stop. */
export const LONG_STOP_S = 300;

export interface LongStop {
  lap: number;
  /** The lap's time (s). */
  lapTime: number;
  /** Time lost over the car's green pace (s). */
  lost: number;
  /** That time in laps of the car's green pace. */
  lapsLost: number;
}

/** The car's green pace: the median of its green laps under the race's green-pace cutoff. */
function greenPace(laps: RaceChartData["cars"][string]["laps"], data: RaceChartData): number | null {
  const xs = laps
    .filter((l) => l.pit === 0 && l.ltSec > 1 && (data.greenPaceCutoff <= 0 || l.ltSec < data.greenPaceCutoff) && (l.flag === undefined || l.flag === "GREEN"))
    .map((l) => l.ltSec)
    .sort((a, b) => a - b);
  if (xs.length < 3) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

export function longStops(data: RaceChartData, num: number): LongStop[] {
  const laps = data.cars[String(num)]?.laps ?? [];
  const pace = greenPace(laps, data);
  if (pace === null) return [];
  const fcy = data.fcy ?? [];
  const underCaution = (l: number) => fcy.some(([a, b]) => l >= a && l <= b);
  const out: LongStop[] = [];
  for (const l of laps) {
    // A caution (or a red flag) slows everyone; that is not this car's stop.
    if (l.flag !== undefined && l.flag !== "GREEN") continue;
    if (underCaution(l.l)) continue;
    const lost = l.ltSec - pace;
    if (lost >= LONG_STOP_S) out.push({ lap: l.l, lapTime: l.ltSec, lost, lapsLost: lost / pace });
  }
  return out;
}

/** A duration as the timing screens write it: "1:40:41", "7:30". */
export function clockText(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** "Lap 67: 1:40:41, about 42 laps lost" */
export function longStopText(s: LongStop): string {
  const n = Math.round(s.lapsLost);
  return `Lap ${s.lap}: ${clockText(s.lapTime)}, about ${n} ${n === 1 ? "lap" : "laps"} lost`;
}

/** Notes shown at most: the longest stops, in lap order, then one line for the rest. */
export const MAX_STOP_NOTES = 3;

/** The notes for a car's long stops: "Lap 67: 1:40:41, about 42 laps lost", "+4 more stops, about 13 laps lost". */
export function longStopNotes(stops: LongStop[]): string[] {
  if (stops.length <= MAX_STOP_NOTES) return stops.map(longStopText);
  const top = [...stops].sort((a, b) => b.lost - a.lost).slice(0, MAX_STOP_NOTES);
  const rest = stops.filter((x) => !top.includes(x));
  const n = Math.round(rest.reduce((a, x) => a + x.lapsLost, 0));
  return [
    ...top.sort((a, b) => a.lap - b.lap).map(longStopText),
    `+${rest.length} more ${rest.length === 1 ? "stop" : "stops"}, about ${n} ${n === 1 ? "lap" : "laps"} lost`,
  ];
}

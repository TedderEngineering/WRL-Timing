/**
 * RaceTrace Live, track map: the cars that will catch the focus car within its next lap, and so
 * have a chance to pass it. From the map's places (metres past the line) and each car's recent
 * green pace (live-battles.ts recentPace, as the Trend column):
 *
 *   - how far behind the focus car each car on track is on the road (metres, then seconds at the
 *     focus car's pace), whatever lap it is on (a faster class lapping it counts too);
 *   - how fast it closes (its speed less the focus car's) and so when it gets there;
 *   - listed when that is within the focus car's next lap, soonest first, with where on the lap
 *     it happens (drawn on the map).
 *
 * Under a caution the field holds station: nothing is listed. Nor with the focus car in the pits
 * or without a pace.
 */
import type { TrackPlace } from "./LiveTrackOrder";

export interface Closing {
  key: number;
  /** Behind the focus car on the road now (s, at the focus car's pace). */
  behindS: number;
  /** How much quicker a lap it is (s/lap). */
  quickerS: number;
  /** Seconds until it reaches the focus car. */
  catchS: number;
  /** Where on the lap it gets there (m past the line). */
  meetD: number;
}

export function closingOnFocus({
  places,
  focusKey,
  len,
  pace,
  caution = false,
}: {
  places: TrackPlace[];
  focusKey: number;
  len: number;
  /** A car's recent green lap time (s); null when not known. */
  pace: (key: number) => number | null;
  caution?: boolean;
}): Closing[] {
  if (caution || !(len > 0)) return [];
  const focus = places.find((p) => p.key === focusKey && !p.inPit);
  const fp = pace(focusKey);
  if (!focus || !fp || !(fp > 0)) return [];
  const vf = len / fp;
  const out: Closing[] = [];
  for (const p of places) {
    if (p.key === focusKey || p.inPit) continue;
    const cp = pace(p.key);
    if (!cp || !(cp > 0) || cp >= fp) continue;
    const closing = len / cp - vf;
    // Behind on the road: the distance forward from it to the focus car, round the lap.
    const behindM = (((focus.d - p.d) % len) + len) % len;
    if (!(behindM > 0)) continue;
    const catchS = behindM / closing;
    // Within the focus car's next lap.
    if (catchS > fp) continue;
    out.push({ key: p.key, behindS: behindM / vf, quickerS: fp - cp, catchS, meetD: (focus.d + vf * catchS) % len });
  }
  return out.sort((a, b) => a.catchS - b.catchS || a.key - b.key);
}

/** How soon, for colour: under URGENT_S it is on the focus car now, under SOON_S coming. */
export const URGENT_S = 10;
export const SOON_S = 30;

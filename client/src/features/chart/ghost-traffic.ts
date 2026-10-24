/**
 * RaceTrace Live: the traffic around the pit ghost (pit-ghost.ts). Where the focus car would
 * rejoin after a stop now, which cars it would come out among (within `windowS` either side, at
 * its pace), and, as the ghost moves at the focus car's pace and every car at its own, when it
 * next comes out in clear air and for how long: so a team can wait until its ghost is past a pack
 * of slower traffic, or stop before it reaches one.
 *
 * Each car's pace is its recent green lap time (the Trend column's). An estimate: under a caution
 * the cars bunch and their paces do not hold, so no "clear in" is given then.
 */

export interface GhostCar {
  key: number;
  /** Where it is (m past the line). */
  d: number;
  /** Its pace (m/s). */
  v: number;
}

export interface GhostTraffic {
  /** The cars within the window now, nearest first, with their gap to the ghost (s; − ahead of it, + behind). */
  near: { key: number; gapS: number }[];
  /** Seconds until the ghost next comes out clear (0: clear now); null when not within the horizon or not known. */
  clearInS: number | null;
  /** How long that clear spell lasts (s), up to the horizon. */
  clearForS: number | null;
}

/** Look ahead this far for a clear spell (s). */
export const GHOST_HORIZON_S = 600;
const STEP_S = 1;

/** The cars within `windowS` of a ghost at `gd` going `vg` m/s, `t` seconds on (each car at its own pace). */
function nearAt(cars: GhostCar[], gd: number, vg: number, len: number, windowS: number, t: number): { key: number; gapS: number }[] {
  const out: { key: number; gapS: number }[] = [];
  const g = gd + vg * t;
  for (const c of cars) {
    // The car ahead (+ metres) or behind (−) the ghost, the nearer way round.
    let dr = (((c.d + c.v * t - g) % len) + len) % len;
    if (dr > len / 2) dr -= len;
    const gapS = -dr / vg;
    if (Math.abs(gapS) < windowS) out.push({ key: c.key, gapS });
  }
  return out.sort((a, b) => Math.abs(a.gapS) - Math.abs(b.gapS) || a.key - b.key);
}

export function ghostTraffic({
  cars,
  ghostD,
  ghostV,
  len,
  windowS,
  caution = false,
  horizonS = GHOST_HORIZON_S,
}: {
  cars: GhostCar[];
  ghostD: number;
  ghostV: number;
  len: number;
  windowS: number;
  caution?: boolean;
  horizonS?: number;
}): GhostTraffic {
  if (!(len > 0) || !(ghostV > 0)) return { near: [], clearInS: null, clearForS: null };
  const near = nearAt(cars, ghostD, ghostV, len, windowS, 0);
  if (caution) return { near, clearInS: near.length ? null : 0, clearForS: null };
  let clearInS: number | null = null;
  let clearForS: number | null = null;
  for (let t = 0; t <= horizonS; t += STEP_S) {
    const busy = nearAt(cars, ghostD, ghostV, len, windowS, t).length > 0;
    if (clearInS === null) {
      if (!busy) clearInS = t;
    } else if (busy) {
      clearForS = t - clearInS;
      break;
    }
  }
  if (clearInS !== null && clearForS === null) clearForS = horizonS - clearInS;
  return { near, clearInS, clearForS };
}

/** "40 s", "1:40". */
export function clockText(s: number): string {
  const r = Math.round(s);
  return r < 60 ? `${r} s` : `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
}

/** The ghost's label after its time: "clear", "3 cars · clear in 1:40", "3 cars" (no clear spell ahead, or a caution). */
export function ghostLabel(t: GhostTraffic): string {
  if (!t.near.length) return "clear";
  const cars = `${t.near.length} car${t.near.length === 1 ? "" : "s"}`;
  return t.clearInS === null ? cars : `${cars} · clear in ${clockText(t.clearInS)}`;
}

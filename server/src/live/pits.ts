/**
 * RaceTrace Live: where the pit lane is on the lap, learned from the timing's pit flags.
 *
 * The timing flags a car in the pits at the pit-in loop and clears it where the pit exit rejoins,
 * but a car is already on the pit limiter for 10-15 s before the flag (on Sunday at Sebring #119
 * and #120 ran down the main straight at 35 mph with no flag yet). Each time a car's flag comes on,
 * its place on the lap and its speed are kept; each time it clears, its place. The map uses the
 * pit-in place and the limiter speed to see a car pitting before its flag, and the pit-out place to
 * bring it back. Learned per track, so a race starts with what its practice sessions showed.
 */
import type { CarPlace, Positions } from "./track.js";
import { IN_PIT } from "./track.js";

/** The pit lane on the lap: where the pit flag comes on and clears (m past the line), the limiter speed. */
export interface PitLane {
  in: number;
  out: number | null;
  mph: number | null;
  /** Pit entries seen. */
  n: number;
}

/** Keep this many of the latest samples. */
const KEEP = 40;
/** A plausible pit-lane speed reading at the pit-in loop (mph). */
const MPH_MIN = 10;
const MPH_MAX = 80;

/** The middle of places round a lap (each taken relative to the first, so the line does not split them). */
export function lapMedian(xs: number[], len: number): number | null {
  if (!xs.length) return null;
  const ref = xs[0];
  const rel = xs.map((x) => ((((x - ref) % len) + len * 1.5) % len) - len / 2).sort((a, b) => a - b);
  return Math.round((((ref + rel[Math.floor(rel.length / 2)]) % len) + len) % len);
}

export class PitLearner {
  private was = new Map<string, boolean>();
  private ins: number[] = [];
  private outs: number[] = [];
  private speeds: number[] = [];

  /** Take a reading of every car's place: a pit flag coming on or clearing is a sample. */
  take(cars: CarPlace[]) {
    for (const [num, d, mph, flags] of cars) {
      const pit = (flags & IN_PIT) !== 0;
      const was = this.was.get(num);
      this.was.set(num, pit);
      if (was === undefined || was === pit || d === null) continue;
      if (pit) {
        this.ins = [...this.ins, d].slice(-KEEP);
        if (mph !== null && mph >= MPH_MIN && mph <= MPH_MAX) this.speeds = [...this.speeds, mph].slice(-KEEP);
      } else this.outs = [...this.outs, d].slice(-KEEP);
    }
  }

  /** The pit lane learned so far, or null before the first pit entry. */
  lane(len: number): PitLane | null {
    const pin = lapMedian(this.ins, len);
    if (pin === null) return null;
    const sp = [...this.speeds].sort((a, b) => a - b);
    return { in: pin, out: lapMedian(this.outs, len), mph: sp.length ? sp[Math.floor(sp.length / 2)] : null, n: this.ins.length };
  }
}

const learners = new Map<string, PitLearner>();
/** The learner for a track (shared by its sessions). */
export function pitLearnerFor(key: string): PitLearner {
  const k = key.trim().toLowerCase();
  let l = learners.get(k);
  if (!l) learners.set(k, (l = new PitLearner()));
  return l;
}

/**
 * When each car now in the pits went in (ms): the read its pit flag came on; null when it was in
 * the pits the first time it was seen (it went in before this server was watching). Cars out of
 * the pits drop out; `seen` collects every car read so far (updated).
 */
export function pitSinceNow(prev: Map<string, number | null>, seen: Set<string>, pos: Positions): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const [num, , , flags] of pos.cars) {
    if (flags & IN_PIT) out.set(num, prev.has(num) ? prev.get(num)! : seen.has(num) ? pos.t : null);
    seen.add(num);
  }
  return out;
}

/** How long each car has been in the pits at `t` (ms), for those whose entry was seen. */
export function pitForAt(since: Map<string, number | null>, t: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [num, at] of since) if (at !== null) out[num] = Math.max(0, t - at);
  return out;
}

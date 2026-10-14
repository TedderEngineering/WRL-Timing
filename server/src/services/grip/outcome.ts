/**
 * Finding Grip — how a calculated run came in.
 *
 * After a run the driver records the hot pressures they measured. Comparing
 * them with the target hot pressures shows how close the calculation got.
 * Pure functions, so they are easy to test; the routes load the rows.
 */

/** A corner is "on target" when it came in within this many PSI of its target hot pressure. */
export const ON_TARGET_PSI = 0.5;

export interface Four {
  lf: number;
  rf: number;
  lr: number;
  rr: number;
}
const KEYS = ["lf", "rf", "lr", "rr"] as const;

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface Comparison {
  /** Measured minus target, per corner (PSI). Positive means it came in high. */
  delta: Four;
  onTarget: boolean;
  /** Largest miss on any corner (PSI, absolute). */
  worstMiss: number;
  /** Mean miss across the four corners (PSI, absolute). */
  averageMiss: number;
}

export function compare(target: Four, hot: Four): Comparison {
  const delta = Object.fromEntries(
    KEYS.map((k) => [k, round2(hot[k] - target[k])])
  ) as unknown as Four;
  const misses = KEYS.map((k) => Math.abs(delta[k]));
  return {
    delta,
    // A hair of tolerance so 0.5 PSI on the nose counts, whatever the float maths says.
    onTarget: misses.every((m) => m <= ON_TARGET_PSI + 1e-9),
    worstMiss: round2(Math.max(...misses)),
    averageMiss: round2(misses.reduce((a, b) => a + b, 0) / 4),
  };
}

/** The measured hot pressures, or null when the run has not been recorded. */
export function actualOf(c: {
  actualHotLf: number | null;
  actualHotRf: number | null;
  actualHotLr: number | null;
  actualHotRr: number | null;
  outcomeAt: Date | null;
}): Four | null {
  if (
    c.outcomeAt === null ||
    c.actualHotLf === null ||
    c.actualHotRf === null ||
    c.actualHotLr === null ||
    c.actualHotRr === null
  )
    return null;
  return { lf: c.actualHotLf, rf: c.actualHotRf, lr: c.actualHotLr, rr: c.actualHotRr };
}

/**
 * RaceTrace Live: the pit ghost. Where the focus car would rejoin if it stopped now and lost the
 * time the viewer typed (pit lane plus fuelling, say 35 + 30 s): that many seconds behind it on
 * the road, at its pace. Drawn on the track map and listed in the Live Crossing Order in its place
 * on the road, so the viewer can see what traffic it would come out in. The cars around it are
 * taken to keep their gaps meanwhile (an estimate). Off until the viewer turns it on; the time and
 * the switch are kept on this device.
 */

/** The ghost's key among the map's places (no car has it). */
export const GHOST_KEY = -1;

/** Where the ghost is: `lossS` behind the focus car (m past the line), at `speed` (m/s). */
export function ghostPlace(focusD: number, speed: number, lossS: number, len: number): number {
  return (((focusD - lossS * speed) % len) + len) % len;
}

export interface PitGhost {
  on: boolean;
  /** The time a stop would lose (s). */
  lossS: number;
  /** Clear air: no car within this many seconds either side of where it would rejoin (ghost-traffic.ts). */
  windowS: number;
}

const KEY = "rt.live.pitGhost";
export const DEFAULT_GHOST: PitGhost = { on: false, lossS: 60, windowS: 3 };
/** The time a stop can be set to lose (s). */
export const GHOST_MAX_S = 900;
/** The clear-air window can be set up to this (s). */
export const WINDOW_MAX_S = 30;

export function readPitGhost(): PitGhost {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<PitGhost> | null;
    const s = Number(v?.lossS);
    const w = Number(v?.windowS);
    return {
      on: v?.on === true,
      lossS: Number.isFinite(s) && s >= 0 && s <= GHOST_MAX_S ? s : DEFAULT_GHOST.lossS,
      windowS: Number.isFinite(w) && w > 0 && w <= WINDOW_MAX_S ? w : DEFAULT_GHOST.windowS,
    };
  } catch {
    return DEFAULT_GHOST;
  }
}

export function savePitGhost(g: PitGhost): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* private window: for this visit only */
  }
}

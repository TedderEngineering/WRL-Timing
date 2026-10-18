/**
 * RaceTrace Live track map: smooth motion between position readings ("marching ants").
 *
 * The server places every car on the lap every 5 s (metres past the start/finish line). Between
 * readings each car carries on at its own pace: the distance it covered between its last two
 * readings, or its speed from the timing, or a typical lap. A new reading is eased into over about
 * a second, so dots glide instead of jumping; a small correction never moves a car backwards (it
 * waits for the reading to catch up), and a large one (the timing's placement changed, the car
 * left the pits) moves it straight there.
 */

/** [car, metres past the line (null: unplaced), mph (null), flags] as the server sends them. */
export type CarPlace = [string, number | null, number | null, number];
export const IN_PIT = 1;
export const NO_GPS = 2;
export const STALE = 4;

/** Carry on at a car's pace for at most this long after its reading; then hold. */
export const MAX_COAST_MS = 9_000;
/** Corrections are eased in over about this long (exponential time constant). */
export const EASE_MS = 600;
/** A correction this large (m) moves the car straight to its new place. */
export const SNAP_M = 250;
/** Faster than this (m/s, about 210 mph) is a misreading, not a pace. */
const MAX_SPEED = 95;

export interface CarMotion {
  num: string;
  /** Last reading: metres past the line, when it was taken (client clock), flags. */
  d: number;
  at: number;
  flags: number;
  mph: number | null;
  /** Pace (m/s) between readings. */
  v: number;
  /** Where it is drawn now (m past the line). */
  shown: number;
}

/** Forward distance from a to b round a lap of `len` (0 … len). */
export const ahead = (a: number, b: number, len: number) => (((b - a) % len) + len) % len;
/** Signed shortest distance from a to b round the lap (−len/2 … len/2). */
export const signedGap = (a: number, b: number, len: number) => {
  const f = ahead(a, b, len);
  return f > len / 2 ? f - len : f;
};

/**
 * Take a reading (cars as the server sent them, read `ageMs` before `now`) into the motion state.
 * `typicalSpeed` (m/s) stands in until a car's own pace is known.
 */
export function takeReading(
  motions: Map<string, CarMotion>,
  cars: CarPlace[],
  now: number,
  ageMs: number,
  len: number,
  typicalSpeed: number
): Map<string, CarMotion> {
  const at = now - Math.max(0, ageMs);
  const next = new Map<string, CarMotion>();
  for (const [num, d, mph, flags] of cars) {
    if (d === null) continue;
    const prev = motions.get(num);
    let v = mph !== null && mph > 0 ? mph * 0.44704 : prev?.v ?? typicalSpeed;
    if (prev && at - prev.at > 1_000 && at - prev.at < 20_000) {
      const moved = ahead(prev.d, d, len);
      const pace = moved / ((at - prev.at) / 1000);
      if (moved < len / 2 && pace <= MAX_SPEED) v = pace;
    }
    if (flags & IN_PIT) v = Math.min(v, 60 * 0.44704 * 0.5); // the pit lane: slow, and it waits for the next reading
    v = Math.max(0, Math.min(MAX_SPEED, v));
    next.set(num, { num, d, at, flags, mph, v, shown: prev ? prev.shown : d });
  }
  return next;
}

/** Where a car should be at `now` by its last reading and pace. */
export function targetOf(m: CarMotion, now: number, len: number): number {
  const coast = Math.max(0, Math.min(now - m.at, MAX_COAST_MS)) / 1000;
  return (m.d + m.v * coast) % len;
}

/** Move every car's drawn place towards where it should be, `dtMs` after the last frame. */
export function step(motions: Map<string, CarMotion>, now: number, dtMs: number, len: number) {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / EASE_MS);
  for (const m of motions.values()) {
    const target = targetOf(m, now, len);
    const gap = signedGap(m.shown, target, len);
    if (Math.abs(gap) > SNAP_M) m.shown = target;
    else if (gap > 0) m.shown = (m.shown + gap * k + len) % len;
    // gap < 0: a little ahead of the reading — hold until it catches up, never roll backwards.
  }
}

/** A point at `d` metres past the line on the outline (points ordered from the line, closing back to the first). */
export function pointAt(pts: [number, number][], ds: number[], len: number, d: number): [number, number] {
  const n = pts.length;
  const x = ((d % len) + len) % len;
  let i = 0;
  // Binary search for the last point at or before x.
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ds[mid] <= x) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (x < ds[0]) {
    // Before the first point: on the closing segment from the last point.
    const a = pts[n - 1];
    const b = pts[0];
    const seg = ds[0] + (len - ds[n - 1]);
    const t = seg > 0 ? (x + len - ds[n - 1]) / seg : 0;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }
  const a = pts[i];
  const b = pts[(i + 1) % n];
  const segEnd = i + 1 < n ? ds[i + 1] : ds[0] + len;
  const t = segEnd > ds[i] ? (x - ds[i]) / (segEnd - ds[i]) : 0;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

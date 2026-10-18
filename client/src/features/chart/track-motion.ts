/**
 * RaceTrace Live track map: smooth motion between position readings ("marching ants").
 *
 * The server places every car on the lap about every 5 s (metres past the start/finish line), but a
 * reading is a poor clock: the timing repeats a car's GPS fix for 10-20 s and its fixes arrive with
 * uneven delay, so the distance between two readings says little about pace (on Sunday's race, from
 * half to one and a half times the car's real pace). So a car is never moved by its readings
 * directly. It runs on at its own steady pace: from its laps, or, once it has run 15 s of fixes,
 * the average over its last 45 s of them, kept within 85-115% of its lap pace under green (fixes
 * arrive late together, so a lower bound let a whole group crawl) and 35-130% under a caution.
 * A repeated fix is not news. A new fix only nudges its pace (at most 25% slower under green, 50%
 * under a caution; 50% faster, twice as fast for a gap over 250 m) until it is back where the fix
 * says; it never stops or rolls backwards for a correction. Only a gap over 800 m (a car placed on
 * the wrong stretch) moves it straight there, and only once the next fix agrees.
 *
 * No new fix for over 25 s means its fix is frozen, not that the car has parked (a parked car's
 * GPS still wanders a few metres): on Sunday #77 kept one fix for three and a half minutes while
 * lapping. The car runs on at its pace, drawn as a faint signal, for as long as the timing shows it
 * completing laps. A car stops only when its fixes say it is barely moving, or when it has neither
 * a new fix nor a new lap for a while.
 *
 * A car that has completed no lap since its fix froze, and reads 0 mph for 25 s, or is marked stale
 * with its speed unchanged too for 60 s, is parked (retired by the paddock, in the garage): it is
 * not drawn on the track at all (on Sunday #77 and #282 sat like that for minutes). Stale alone is
 * not enough: #119 was marked stale with its fix frozen for 22 s while its speed read 94-122 mph.
 */

/** [car, metres past the line (null: unplaced), mph (null), flags] as the server sends them. */
export type CarPlace = [string, number | null, number | null, number];
export const IN_PIT = 1;
export const NO_GPS = 2;
export const STALE = 4;

/** A car runs on at its pace at least this long after its last new fix (longer while it completes laps). */
export const MAX_COAST_MS = 30_000;
/** A gap to where the fix says is closed over about this long, by easing the car's pace. */
export const CATCH_S = 12;
/** The pace a correction may give a car: at most this much slower / faster than its own. */
export const MIN_K = 0.75;
export const MAX_K = 1.5;
/** Under a caution (cars really do slow), at most this much slower. */
export const MIN_K_CAUTION = 0.5;
/** For a gap ahead over LARGE_M, at most this much faster. */
export const LARGE_M = 250;
const MAX_K_LARGE = 2;
/** A new fix this far (m) from where the car is drawn waits for the next to agree, then moves it there. */
export const FAR_M = 800;
/** No new fix for this long: its fix is frozen, and it runs on by its pace and laps. */
export const FROZEN_MS = 25_000;
/** Marked stale with fix and speed unchanged this long: parked. */
export const STALE_PARKED_MS = 60_000;
/** A frozen car runs on until it has gone this many of its lap times without a new lap. */
const LAPS_WITHOUT_LAP = 1.5;
/** Fixes saying under this share of its lap pace: the car really is crawling or stopped. */
const CRAWL = 0.2;
/** Pace from fixes: over at least this span, from the fixes of the last HISTORY_MS. */
const PACE_SPAN_MS = 15_000;
const HISTORY_MS = 45_000;
/** Pace from fixes is kept within this share of the car's lap pace. */
const PACE_MIN = 0.85;
const PACE_MAX = 1.15;
const PACE_MIN_CAUTION = 0.35;
const PACE_MAX_CAUTION = 1.3;
/** The pit lane (m/s, about 30 mph). */
const PIT_SPEED = 13.4;
/** Faster than this (m/s, about 210 mph) is a misreading, not a pace. */
const MAX_SPEED = 95;

export interface CarMotion {
  num: string;
  /** Last fix taken in: metres past the line, when (client clock), flags. */
  d: number;
  at: number;
  flags: number;
  mph: number | null;
  /** Pace (m/s). */
  v: number;
  /** Where it is drawn now (m past the line). */
  shown: number;
  /** The place in the last reading, and since when it has been the same (a repeated fix is not news). */
  raw: number;
  rawSince: number;
  /** Its pace from its laps (m/s). */
  base: number;
  /** Recent fixes, for its pace. */
  fixes: { d: number; at: number }[];
  /** New fixes in a row far from where it is drawn. */
  far: number;
  /** Move straight to its place on the next frame. */
  snap: boolean;
  /** Its completed laps, and when (client clock) that last went up. */
  laps: number;
  lapAt: number;
  /** Its completed laps and its speed at its last new fix. */
  fixLaps: number;
  fixMph: number | null;
  /** Read under a caution. */
  caution: boolean;
}

/** What the race says of a car: its pace from its laps (m/s) and its completed laps. */
export interface CarLaps {
  pace: number | null;
  laps: number;
}

/** Forward distance from a to b round a lap of `len` (0 … len). */
export const ahead = (a: number, b: number, len: number) => (((b - a) % len) + len) % len;
/** Signed shortest distance from a to b round the lap (−len/2 … len/2). */
export const signedGap = (a: number, b: number, len: number) => {
  const f = ahead(a, b, len);
  return f > len / 2 ? f - len : f;
};
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** A car's pace from its recent fixes, within bounds of its lap pace; its lap pace until they span 15 s. */
export function paceFromFixes(fixes: { d: number; at: number }[], len: number, base: number, caution = false): number {
  if (fixes.length < 2) return base;
  const span = fixes[fixes.length - 1].at - fixes[0].at;
  if (span < PACE_SPAN_MS) return base;
  let dist = 0;
  for (let i = 1; i < fixes.length; i++) dist += ahead(fixes[i - 1].d, fixes[i].d, len) < len / 2 ? ahead(fixes[i - 1].d, fixes[i].d, len) : 0;
  const pace = dist / (span / 1000);
  // Crawling or stopped (a spin, a stoppage): trust it. Otherwise within bounds of its lap pace.
  if (pace < base * CRAWL) return pace;
  return caution ? clamp(pace, base * PACE_MIN_CAUTION, base * PACE_MAX_CAUTION) : clamp(pace, base * PACE_MIN, base * PACE_MAX);
}

/**
 * Take a reading (cars as the server sent them, read `ageMs` before `now`) into the motion state.
 * `lapsOf` gives a car's pace from its laps (m/s) and its completed laps; `typicalSpeed` stands in
 * for a pace without one. `caution`: the session is under a caution.
 */
export function takeReading(
  motions: Map<string, CarMotion>,
  cars: CarPlace[],
  now: number,
  ageMs: number,
  len: number,
  typicalSpeed: number,
  lapsOf: (num: string) => CarLaps | null = () => null,
  caution = false
): Map<string, CarMotion> {
  const at = now - Math.max(0, ageMs);
  const next = new Map<string, CarMotion>();
  for (const [num, d, mph, flags] of cars) {
    const prev = motions.get(num);
    const info = lapsOf(num);
    const laps = info?.laps ?? 0;
    const lapAt = prev && laps <= prev.laps ? prev.lapAt : at;
    if (d === null) {
      // No place this time: it carries on from its last.
      if (prev) next.set(num, { ...prev, flags, mph, laps, lapAt, caution });
      continue;
    }
    const base = clamp(info?.pace ?? typicalSpeed, 1, MAX_SPEED);
    const pit = (flags & IN_PIT) !== 0;
    const capped = (v: number) => (pit ? Math.min(v, PIT_SPEED) : v);
    if (!prev || ((prev.flags ^ flags) & IN_PIT) !== 0) {
      // New on the map, or into or out of the pit lane: placed where it is.
      const m: CarMotion = { num, d, at, flags, mph, v: capped(base), shown: d, raw: d, rawSince: at, base, fixes: [{ d, at }], far: 0, snap: true, laps, lapAt, fixLaps: laps, fixMph: mph, caution };
      next.set(num, m);
      continue;
    }
    if (d === prev.raw) {
      // The same fix again: not news.
      next.set(num, { ...prev, flags, mph, base, laps, lapAt, caution });
      continue;
    }
    // A new fix.
    const v = capped(paceFromFixes([...prev.fixes, { d, at }].filter((f) => at - f.at <= HISTORY_MS), len, base, caution));
    const gap = signedGap(prev.shown, (d + (v * Math.max(0, now - at)) / 1000) % len, len);
    const far = Math.abs(gap) > FAR_M ? prev.far + 1 : 0;
    if (far === 1) {
      // Far from where it is drawn: wait for the next fix to agree.
      next.set(num, { ...prev, flags, mph, base, laps, lapAt, caution, raw: d, rawSince: at, far });
      continue;
    }
    // After a frozen spell its pace starts afresh from this fix.
    const thawed = at - prev.at >= FROZEN_MS;
    const fixes = thawed ? [{ d, at }] : [...prev.fixes, { d, at }].filter((f) => at - f.at <= HISTORY_MS);
    next.set(num, { ...prev, d, at, flags, mph, v: thawed ? capped(base) : v, base, laps, lapAt, fixLaps: laps, fixMph: mph, caution, raw: d, rawSince: at, fixes, far: 0, snap: far >= 2 });
  }
  return next;
}

/** Its fix is frozen: no new one for FROZEN_MS (drawn as a faint signal). */
export const isFrozen = (m: CarMotion, now: number) => now - m.at >= FROZEN_MS;

/**
 * Parked (retired by the paddock, in the garage): no lap since its fix froze, and it reads 0 mph,
 * or the timing marks it stale with its speed unchanged for STALE_PARKED_MS, or it is past its
 * coast limit.
 */
export function isParked(m: CarMotion, now: number, len: number): boolean {
  if (!isFrozen(m, now) || m.laps > m.fixLaps) return false;
  if (m.mph === 0) return true;
  if ((m.flags & STALE) !== 0 && m.mph === m.fixMph && now - m.at >= STALE_PARKED_MS) return true;
  return now - m.at >= coastLimit(m, len);
}

/**
 * How long after its last fix a car runs on: at least MAX_COAST_MS, and for as long as it keeps
 * completing laps (until LAPS_WITHOUT_LAP of its lap times pass without one).
 */
export function coastLimit(m: CarMotion, len: number): number {
  return Math.max(MAX_COAST_MS, m.lapAt + (LAPS_WITHOUT_LAP * len * 1000) / m.base - m.at);
}

/** Where a car's last fix says it is at `now`, by its pace. */
export function targetOf(m: CarMotion, now: number, len: number): number {
  const coast = Math.max(0, Math.min(now - m.at, coastLimit(m, len))) / 1000;
  return (m.d + m.v * coast) % len;
}

/**
 * Move every car on `dtMs` after the last frame: at its own pace, eased (MIN_K … MAX_K of it) to
 * close the gap to where its fix says over about CATCH_S. Never backwards. Past its coast limit, or
 * crawling by its fixes, it eases to where they say and waits there.
 */
export function step(motions: Map<string, CarMotion>, now: number, dtMs: number, len: number) {
  const dt = Math.max(0, dtMs) / 1000;
  for (const m of motions.values()) {
    const target = targetOf(m, now, len);
    if (m.snap) {
      m.shown = target;
      m.snap = false;
      continue;
    }
    const gap = signedGap(m.shown, target, len);
    const moving = m.v > m.base * CRAWL && now - m.at < coastLimit(m, len);
    // A car stopped (or its fixes stopped coming) eases to its place and waits there.
    const v = moving ? m.v : Math.max(m.v, m.base);
    const lo = m.caution ? MIN_K_CAUTION : MIN_K;
    const hi = gap > LARGE_M ? MAX_K_LARGE : MAX_K;
    const k = moving ? clamp(1 + gap / (v * CATCH_S), lo, hi) : clamp(gap / (v * CATCH_S), 0, hi);
    m.shown = (m.shown + v * k * dt) % len;
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

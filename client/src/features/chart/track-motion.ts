/**
 * RaceTrace Live track map: smooth motion between position readings ("marching ants").
 *
 * The server places every car on the lap about every 5 s (metres past the start/finish line), but a
 * reading is a poor clock: the timing repeats a car's GPS fix for 10-20 s and its fixes arrive with
 * uneven delay, so the distance between two readings says little about pace (on Sunday's race, from
 * half to one and a half times the car's real pace). So a car is never moved by its readings
 * directly. It runs on at its own steady pace: from its laps, or, once it has run 15 s of fixes,
 * the average over its last 45 s of them (so a caution slows it). A repeated fix is not news. A new
 * fix only nudges its pace (at most 40% slower or 50% faster; for a gap over 250 m, 70% slower or
 * twice as fast) until it is back where the fix says; it never stops or rolls backwards for a
 * correction. Only a gap over 800 m (a car placed on the wrong stretch) moves it straight there,
 * and only once the next fix agrees.
 *
 * No new fix for over 25 s means its fix is frozen, not that the car has parked (a parked car's
 * GPS still wanders a few metres): on Sunday #77 kept one fix for three and a half minutes while
 * lapping. The car runs on at its pace, drawn as a faint signal, for as long as the timing shows it
 * completing laps. A car stops only when its fixes say it is barely moving, or when it has neither
 * a new fix nor a new lap for a while.
 *
 * A car off the track (OFF_TRACK: a gravel trap, the grass, parked off, towed across the infield)
 * comes with its own point and is drawn there, eased between fixes; it does not run on at a pace.
 * Back on the track it is placed where its fix says, as a car new to the map.
 */

/** [car, metres past the line (null: unplaced), mph (null), flags, its point [x, y] when off the track] as the server sends them. */
export type CarPlace = [string, number | null, number | null, number] | [string, number | null, number | null, number, [number, number]];
export const IN_PIT = 1;
export const NO_GPS = 2;
export const STALE = 4;
export const OFF_TRACK = 8;
/** An off-track car eases to its next point over about this long. */
export const OFF_EASE_MS = 1_500;

/** A car runs on at its pace at least this long after its last new fix (longer while it completes laps). */
export const MAX_COAST_MS = 30_000;
/** A gap to where the fix says is closed over about this long, by easing the car's pace. */
export const CATCH_S = 8;
/** The pace a correction may give a car: at most this much slower / faster than its own. */
export const MIN_K = 0.6;
export const MAX_K = 1.5;
/** For a gap over LARGE_M, at most this much slower / faster. */
export const LARGE_M = 250;
const MIN_K_LARGE = 0.3;
const MAX_K_LARGE = 2;
/** A new fix this far (m) from where the car is drawn waits for the next to agree, then moves it there. */
export const FAR_M = 800;
/** No new fix for this long: its fix is frozen, and it runs on by its pace and laps. */
export const FROZEN_MS = 25_000;
/** A frozen car runs on until it has gone this many of its lap times without a new lap. */
const LAPS_WITHOUT_LAP = 1.5;
/** Fixes saying under this share of its lap pace: the car really is crawling or stopped. */
const CRAWL = 0.2;
/** Pace from fixes: over at least this span, from the fixes of the last HISTORY_MS. */
const PACE_SPAN_MS = 15_000;
const HISTORY_MS = 45_000;
/** Pace from fixes is kept within this share of the car's lap pace. */
const PACE_MIN = 0.35;
const PACE_MAX = 1.3;
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
  /** Off the track: where its fix says it is (outline metres), and where it is drawn now. */
  off?: [number, number] | null;
  offShown?: [number, number] | null;
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
export function paceFromFixes(fixes: { d: number; at: number }[], len: number, base: number): number {
  if (fixes.length < 2) return base;
  const span = fixes[fixes.length - 1].at - fixes[0].at;
  if (span < PACE_SPAN_MS) return base;
  let dist = 0;
  for (let i = 1; i < fixes.length; i++) dist += ahead(fixes[i - 1].d, fixes[i].d, len) < len / 2 ? ahead(fixes[i - 1].d, fixes[i].d, len) : 0;
  const pace = dist / (span / 1000);
  // Crawling or stopped (a spin, a stoppage): trust it. Otherwise within bounds of its lap pace.
  return pace < base * CRAWL ? pace : clamp(pace, base * PACE_MIN, base * PACE_MAX);
}

/**
 * Take a reading (cars as the server sent them, read `ageMs` before `now`) into the motion state.
 * `lapsOf` gives a car's pace from its laps (m/s) and its completed laps; `typicalSpeed` stands in
 * for a pace without one.
 */
export function takeReading(
  motions: Map<string, CarMotion>,
  cars: CarPlace[],
  now: number,
  ageMs: number,
  len: number,
  typicalSpeed: number,
  lapsOf: (num: string) => CarLaps | null = () => null
): Map<string, CarMotion> {
  const at = now - Math.max(0, ageMs);
  const next = new Map<string, CarMotion>();
  for (const place of cars) {
    const [num, d, mph, flags] = place;
    const xy = place[4] ?? null;
    const prev = motions.get(num);
    const info = lapsOf(num);
    const laps = info?.laps ?? 0;
    const lapAt = prev && laps <= prev.laps ? prev.lapAt : at;
    if (xy && flags & OFF_TRACK) {
      // Off the track: drawn at its own point (eased from where it was drawn off the track), still.
      const base0 = clamp(info?.pace ?? typicalSpeed, 1, MAX_SPEED);
      const wasOff = !!prev?.off;
      const shown = d ?? prev?.shown ?? 0;
      next.set(num, {
        num, d: shown, at, flags, mph, v: 0, shown, raw: shown, rawSince: at, base: base0, fixes: [], far: 0, snap: false, laps, lapAt,
        off: xy, offShown: wasOff ? prev!.offShown ?? xy : xy,
      });
      continue;
    }
    if (d === null) {
      // No place this time: it carries on from its last.
      if (prev) next.set(num, { ...prev, flags, mph, laps, lapAt });
      continue;
    }
    const base = clamp(info?.pace ?? typicalSpeed, 1, MAX_SPEED);
    const pit = (flags & IN_PIT) !== 0;
    const capped = (v: number) => (pit ? Math.min(v, PIT_SPEED) : v);
    if (!prev || prev.off || ((prev.flags ^ flags) & IN_PIT) !== 0) {
      // New on the map, or into or out of the pit lane: placed where it is.
      const m: CarMotion = { num, d, at, flags, mph, v: capped(base), shown: d, raw: d, rawSince: at, base, fixes: [{ d, at }], far: 0, snap: true, laps, lapAt };
      next.set(num, m);
      continue;
    }
    if (d === prev.raw) {
      // The same fix again: not news.
      next.set(num, { ...prev, flags, mph, base, laps, lapAt });
      continue;
    }
    // A new fix.
    const v = capped(paceFromFixes([...prev.fixes, { d, at }].filter((f) => at - f.at <= HISTORY_MS), len, base));
    const gap = signedGap(prev.shown, (d + (v * Math.max(0, now - at)) / 1000) % len, len);
    const far = Math.abs(gap) > FAR_M ? prev.far + 1 : 0;
    if (far === 1) {
      // Far from where it is drawn: wait for the next fix to agree.
      next.set(num, { ...prev, flags, mph, base, laps, lapAt, raw: d, rawSince: at, far });
      continue;
    }
    // After a frozen spell its pace starts afresh from this fix.
    const thawed = at - prev.at >= FROZEN_MS;
    const fixes = thawed ? [{ d, at }] : [...prev.fixes, { d, at }].filter((f) => at - f.at <= HISTORY_MS);
    next.set(num, { ...prev, d, at, flags, mph, v: thawed ? capped(base) : v, base, laps, lapAt, raw: d, rawSince: at, fixes, far: 0, snap: far >= 2 });
  }
  return next;
}

/** Its fix is frozen: no new one for FROZEN_MS (drawn as a faint signal). */
export const isFrozen = (m: CarMotion, now: number) => now - m.at >= FROZEN_MS;

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
    if (m.off) {
      // Off the track: eased towards its point, nothing else.
      const k = Math.min(1, Math.max(0, dtMs) / OFF_EASE_MS);
      const [x0, y0] = m.offShown ?? m.off;
      m.offShown = [x0 + (m.off[0] - x0) * k, y0 + (m.off[1] - y0) * k];
      continue;
    }
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
    const lo = gap < -LARGE_M ? MIN_K_LARGE : MIN_K;
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

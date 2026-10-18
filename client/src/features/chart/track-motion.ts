/**
 * RaceTrace Live track map: smooth motion between position readings ("marching ants").
 *
 * The server places every car on the lap about every 5 s (metres past the start/finish line), but a
 * reading is a poor clock: the timing repeats a car's GPS fix for 10-20 s and its fixes arrive with
 * uneven delay, so the distance between two readings says little about pace (on Sunday's race, from
 * half to one and a half times the car's real pace). So a car is never moved by its readings
 * directly. It runs on at its own steady pace: from its laps, or, once it has run 15 s of fixes,
 * the average over its last 45 s of them, kept within 85-115% of its lap pace under green and
 * 35-130% under a caution (so a caution slows it). Fixes often arrive late together: with a lower
 * bound, and a correction allowed to slow a car to 30%, whole groups crawled ("false stopped cars").
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
 * A stopped car with a frozen fix (the usual case: the timing repeats its last fix) is caught by its
 * laps, which come from the timing loop and stay true when the GPS does not: frozen for 25 s and
 * overdue at the line (its lap time plus 10 %, plus the delay before laps reach the page), it is
 * stopped. Sooner, with no lap since its fix froze: reading 0 mph for 25 s (#282 parked by the
 * paddock), or marked stale by the timing with its speed unchanged too for 60 s (#77 retired: one
 * fix and 54 mph for minutes; stale alone is not enough, #119 was stale for 22 s at 94-122 mph).
 * It goes back to its last real fix and waits there, drawn as stopped, until a new fix comes. A
 * frozen car that keeps crossing the line on time keeps running on.
 *
 * A car going into the pits is on the pit limiter for 10-15 s before the timing flags it (on
 * Sunday #119 and #120 ran down Sebring's main straight at 35 mph with no flag yet), and running it
 * on at race pace put it 200-350 m down the straight by the time the flag came. The server learns
 * where the pit flag comes on and the limiter speed (server live/pits.ts). A car whose fix is in the
 * last 600 m before that point reading limiter speed is pitting: it runs no faster than its
 * reading, never past the pit-in point, and fades out there. A car new to the map fades in.
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
/** Overdue at the line: its lap time × this, plus OVERDUE_SLACK_MS (laps reach the page a few seconds late). */
export const OVERDUE_FACTOR = 1.1;
export const OVERDUE_SLACK_MS = 10_000;
/** A car this far (m) before the pit-in point at limiter speed is pitting (and up to PIT_PAST_M past it, before its flag). */
export const PIT_APPROACH_M = 600;
export const PIT_PAST_M = 100;
/** Limiter speed: up to this much (mph) over the pit lane's learned speed; without one, PIT_MPH_DEFAULT. */
export const PIT_MPH_MARGIN = 12;
export const PIT_MPH_DEFAULT = 40;
/** A car new to the map fades in over this long, and a pitting car fades out over the last PIT_FADE_M before the pit-in point. */
export const FADE_IN_MS = 800;
export const PIT_FADE_M = 80;
/** Within this of the pit-in point a pitting car is gone (it eases there slowly). */
export const PIT_GONE_M = 10;
/** Marked stale with fix and speed unchanged this long: stopped. */
export const STALE_STOPPED_MS = 60_000;
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
  /** Its last lap time (s), when known. */
  lastLapS?: number | null;
  /** Its completed laps and its speed at its last new fix. */
  fixLaps?: number;
  fixMph?: number | null;
  /** Read under a caution. */
  caution?: boolean;
  /** Pitting before its flag: the pit-in point it runs to (m past the line). */
  pitIn?: number | null;
  /** When it came onto the map (client clock), for fading in. */
  born?: number;
  /** Off the track: where its fix says it is (outline metres), and where it is drawn now. */
  off?: [number, number] | null;
  offShown?: [number, number] | null;
}

/** The pit lane on the lap, learned from the pit flags (server live/pits.ts). */
export interface PitLane {
  in: number;
  out: number | null;
  mph: number | null;
  n: number;
}

/** m/s per mph. */
const MPH = 0.44704;

/** Pitting before its flag: its fix in the approach to the pit-in point, at limiter speed. */
export function isPitting(d: number, mph: number | null, lane: PitLane | null, len: number): boolean {
  if (!lane || mph === null || mph <= 0) return false;
  const limit = lane.mph !== null ? lane.mph + PIT_MPH_MARGIN : PIT_MPH_DEFAULT + PIT_MPH_MARGIN;
  const before = signedGap(d, lane.in, len); // > 0: the pit-in point is ahead
  return mph <= limit && before <= PIT_APPROACH_M && before >= -PIT_PAST_M;
}

/** What the race says of a car: its pace from its laps (m/s) and its completed laps. */
export interface CarLaps {
  pace: number | null;
  laps: number;
  /** Its last lap time (s), when known: a lap under a caution takes longer than its pace says. */
  lastLapS?: number | null;
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
 * for a pace without one. `caution`: the session is under a caution. `pit`: the pit lane, once
 * learned.
 */
export function takeReading(
  motions: Map<string, CarMotion>,
  cars: CarPlace[],
  now: number,
  ageMs: number,
  len: number,
  typicalSpeed: number,
  lapsOf: (num: string) => CarLaps | null = () => null,
  caution = false,
  pit: PitLane | null = null
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
      const m: CarMotion = { num, d, at, flags, mph, v: capped(base), shown: d, raw: d, rawSince: at, base, fixes: [{ d, at }], far: 0, snap: true, laps, lapAt, fixLaps: laps, fixMph: mph, born: now };
      next.set(num, m);
      continue;
    }
    if (d === prev.raw) {
      // The same fix again: not news.
      next.set(num, { ...prev, flags, mph, base, laps, lapAt });
      continue;
    }
    // A new fix.
    const v = capped(paceFromFixes([...prev.fixes, { d, at }].filter((f) => at - f.at <= HISTORY_MS), len, base, caution));
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
    next.set(num, { ...prev, d, at, flags, mph, v: thawed ? capped(base) : v, base, laps, lapAt, fixLaps: laps, fixMph: mph, raw: d, rawSince: at, fixes, far: 0, snap: far >= 2 });
  }
  for (const [num, m] of next) {
    m.lastLapS = lapsOf(num)?.lastLapS ?? null;
    m.caution = caution;
    // Pitting before its flag: no faster than its reading, and only as far as the pit-in point.
    const pitting = !m.off && isPitting(m.raw, m.mph, pit, len);
    if (pitting) m.v = Math.min(m.v, (m.mph as number) * MPH);
    else if (m.pitIn != null) m.v = m.base; // it was not pitting after all: back to its pace
    m.pitIn = pitting ? pit!.in : null;
  }
  return next;
}

/** Its fix is frozen: no new one for FROZEN_MS (drawn as a faint signal). */
export const isFrozen = (m: CarMotion, now: number) => now - m.at >= FROZEN_MS;

/** When its next lap is overdue (client clock): its lap time (the longer of its pace and its last lap) × 1.1, plus the slack. */
export function overdueAt(m: CarMotion, len: number): number {
  const lapMs = Math.max((len * 1000) / m.base, (m.lastLapS ?? 0) * 1000);
  return m.lapAt + lapMs * OVERDUE_FACTOR + OVERDUE_SLACK_MS;
}

/**
 * Stopped: its fix frozen and its next lap overdue; or sooner, with no lap since its fix froze,
 * reading 0 mph, or marked stale with its speed unchanged for STALE_STOPPED_MS. Off-track cars
 * are drawn where they are instead.
 */
export function isStopped(m: CarMotion, now: number, len: number): boolean {
  if (m.off || m.pitIn != null || !isFrozen(m, now)) return false;
  if (now > overdueAt(m, len)) return true;
  if (m.laps > (m.fixLaps ?? m.laps)) return false;
  return m.mph === 0 || ((m.flags & STALE) !== 0 && m.mph === m.fixMph && now - m.at >= STALE_STOPPED_MS);
}

/**
 * How long after its last fix a car runs on: at least MAX_COAST_MS, and for as long as it keeps
 * completing laps (until its next lap is overdue).
 */
export function coastLimit(m: CarMotion, len: number): number {
  return Math.max(MAX_COAST_MS, overdueAt(m, len) - m.at);
}

/** Where a car's last fix says it is at `now`, by its pace; a stopped car, its last fix. */
export function targetOf(m: CarMotion, now: number, len: number): number {
  if (isStopped(m, now, len)) return m.d;
  const coast = Math.max(0, Math.min(now - m.at, coastLimit(m, len))) / 1000;
  // Pitting: no further than the pit-in point.
  const run = m.pitIn != null ? Math.min(m.v * coast, Math.max(0, signedGap(m.d, m.pitIn, len))) : m.v * coast;
  return (m.d + run) % len;
}

/**
 * Move every car on `dtMs` after the last frame: at its own pace, eased (MIN_K … MAX_K of it) to
 * close the gap to where its fix says over about CATCH_S. Never backwards, except a stopped car
 * going back to its last fix. Past its coast limit, or crawling by its fixes, it eases to where
 * they say and waits there.
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
    if (isStopped(m, now, len)) {
      // Stopped: back to its last real fix (it may have run on past it), straight there if far.
      if (Math.abs(gap) > LARGE_M) m.shown = target;
      else m.shown = (m.shown + m.base * clamp(gap / (m.base * CATCH_S), -MAX_K, MAX_K) * dt + len) % len;
      continue;
    }
    // Pitting and its place has reached the pit-in point: it eases there and waits for its flag.
    const atPit = m.pitIn != null && Math.abs(signedGap(target, m.pitIn, len)) < 1;
    const moving = m.v > m.base * CRAWL && now - m.at < coastLimit(m, len) && !atPit;
    // A car stopped (or its fixes stopped coming) eases to its place and waits there.
    const v = moving ? m.v : Math.max(m.v, m.base);
    const lo = m.caution || m.pitIn != null ? MIN_K_CAUTION : MIN_K;
    const hi = gap > LARGE_M ? MAX_K_LARGE : MAX_K;
    const k = moving ? clamp(1 + gap / (v * CATCH_S), lo, hi) : clamp(gap / (v * CATCH_S), 0, hi);
    m.shown = (m.shown + v * k * dt) % len;
  }
}

/**
 * How visible a car is (0 … 1): fading in after it comes onto the map, and a pitting car fading
 * out over PIT_FADE_M before the pit-in point (gone within PIT_GONE_M of it).
 */
export function visibility(m: CarMotion, now: number, len: number): number {
  const born = m.born === undefined ? 1 : Math.min(1, Math.max(0, now - m.born) / FADE_IN_MS);
  if (m.pitIn == null) return born;
  return born * Math.min(1, Math.max(0, (signedGap(m.shown, m.pitIn, len) - PIT_GONE_M) / PIT_FADE_M));
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

/**
 * RaceTrace Live track map: the circuit's outline and where each car is on it.
 *
 * The timing feed learns a track's centreline from car GPS (a closed polyline of lat/lon points
 * with distances along it, and the start/finish line located on it). Here it becomes:
 *   - an outline to draw: points in metres (x east, y down), no coordinates or feed ids;
 *   - a way to place a car: its GPS point projected onto the nearest stretch of the centreline,
 *     as metres past the start/finish line (0 … length).
 * Each state read (every 5 s) gives every car's GPS position, speed, and pit and stale flags.
 */

export interface FeedTrackPoint {
  lat: number;
  lon: number;
  d: number;
}

export interface TrackGeometry {
  /** Lap length (m), the closing segment included. */
  len: number;
  /** Start/finish line: distance from the path origin (m). */
  sfD: number;
  pts: { lat: number; lon: number; d: number; x: number; y: number }[];
  /** Planar frame: metres per degree at the track's latitude, and its north-west corner. */
  frame: { lat0: number; lon0: number; mLat: number; mLon: number };
  w: number;
  h: number;
}

const R = 6371008.8;

/** The feed's track map JSON → geometry; null when it is not a usable map (too few points). */
export function trackFromFeed(map: unknown): TrackGeometry | null {
  if (!map || typeof map !== "object") return null;
  const m = map as { pts?: unknown; len?: unknown; sf?: { d?: unknown } | null };
  const raw = Array.isArray(m.pts) ? m.pts : [];
  const pts0 = raw
    .map((p) => p as Partial<FeedTrackPoint>)
    .filter((p): p is FeedTrackPoint => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.d));
  if (pts0.length < 10) return null;
  const len = Number.isFinite(m.len) ? Number(m.len) : pts0[pts0.length - 1].d;
  if (!(len > 0)) return null;
  const maxLat = Math.max(...pts0.map((p) => p.lat));
  const minLon = Math.min(...pts0.map((p) => p.lon));
  const midLat = (Math.max(...pts0.map((p) => p.lat)) + Math.min(...pts0.map((p) => p.lat))) / 2;
  const mLat = (Math.PI / 180) * R;
  const mLon = mLat * Math.cos((midLat * Math.PI) / 180);
  const frame = { lat0: maxLat, lon0: minLon, mLat, mLon };
  const pts = pts0.map((p) => ({ ...p, ...toXY(frame, p.lat, p.lon) }));
  const sfD = Number.isFinite(m.sf?.d) ? Number(m.sf!.d) % len : 0;
  return { len, sfD, pts, frame, w: Math.max(...pts.map((p) => p.x)), h: Math.max(...pts.map((p) => p.y)) };
}

export function toXY(f: TrackGeometry["frame"], lat: number, lon: number): { x: number; y: number } {
  return { x: (lon - f.lon0) * f.mLon, y: (f.lat0 - lat) * f.mLat };
}

/** What viewers get: the outline in metres and where the line is (no coordinates, no ids). */
export interface PublicTrack {
  len: number;
  w: number;
  h: number;
  /** [x, y] in metres, to the decimetre, from the start/finish line round the lap. */
  pts: [number, number][];
  /** Each point's distance past the start/finish line (m), to the decimetre. */
  ds: number[];
}

export function publicTrack(g: TrackGeometry): PublicTrack {
  const r = (v: number) => Math.round(v * 10) / 10;
  const order = g.pts.map((p) => ({ ...p, s: (p.d - g.sfD + g.len) % g.len })).sort((a, b) => a.s - b.s);
  return { len: r(g.len), w: r(g.w), h: r(g.h), pts: order.map((p) => [r(p.x), r(p.y)]), ds: order.map((p) => r(p.s)) };
}

/**
 * Where a GPS point is on the lap: metres past the start/finish line, and how far it is from the
 * centreline. Close parallel stretches (a hairpin's two sides) are told apart by `prev`, the car's
 * last distance: of the stretches within 15 m of the nearest, the one closest ahead of it wins.
 */
export function placeOnTrack(g: TrackGeometry, lat: number, lon: number, prev?: number | null): { d: number; off: number } {
  const { x, y } = toXY(g.frame, lat, lon);
  const n = g.pts.length;
  const cands: { d: number; off: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = g.pts[i];
    const b = g.pts[(i + 1) % n];
    const segLen = i + 1 < n ? b.d - a.d : g.len - a.d;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
    const off = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
    cands.push({ d: (a.d + t * segLen - g.sfD + 2 * g.len) % g.len, off });
  }
  cands.sort((p, q) => p.off - q.off);
  const best = cands[0];
  if (prev == null || !Number.isFinite(prev)) return best;
  // The nearest place on each other stretch (over 100 m away along the lap) within 15 m of the
  // nearest overall: neighbouring segments of one stretch are the same place, not a choice.
  const along = (a: number, b: number) => Math.min(Math.abs(a - b), g.len - Math.abs(a - b));
  const stretches: { d: number; off: number }[] = [best];
  for (const c of cands) {
    if (c.off > best.off + 15) break;
    if (stretches.every((r) => along(r.d, c.d) > 100)) stretches.push(c);
  }
  const ahead = (c: { d: number }) => (c.d - prev + g.len) % g.len; // 0 … len, small = just ahead
  return stretches.reduce((p, c) => (ahead(c) < ahead(p) ? c : p), stretches[0]);
}

/** Car position fields in the feed's state (its car record's field positions). */
const CP = { number: 2, inPit: 34, enteredPit: 31, stale: 37, lat: 47, lon: 48, mph: 54, lapPct: 66 } as const;
/** The state's car records. */
const SS_CARS = 14;

/** One car's place: [car number, metres past the line (null: no position), mph (null), flags]. */
export type CarPlace = [string, number | null, number | null, number];
/** Flags: in the pit lane. */
export const IN_PIT = 1;
/** Flags: no usable GPS (placed from the timing's lap share instead, or not at all). */
export const NO_GPS = 2;
/** Flags: the timing marks the car's data stale. */
export const STALE = 4;

/** Further than this from the centreline, a GPS point is not on track (the paddock, the pit lane's far side). */
export const OFF_TRACK_M = 60;

export interface Positions {
  /** When the state was read (ms). */
  t: number;
  cars: CarPlace[];
}

/** Every car's place from a decoded state, using each car's last distance to settle close stretches. */
export function positionsFromState(raw: unknown, g: TrackGeometry, t: number, prev?: Map<string, number>): Positions | null {
  if (!Array.isArray(raw) || !Array.isArray(raw[SS_CARS])) return null;
  const cars: CarPlace[] = [];
  for (const c of raw[SS_CARS] as unknown[]) {
    if (!Array.isArray(c)) continue;
    const num = typeof c[CP.number] === "string" ? (c[CP.number] as string) : null;
    if (!num) continue;
    let flags = 0;
    if (c[CP.inPit] === true || c[CP.enteredPit] === true) flags |= IN_PIT;
    if (c[CP.stale] === true) flags |= STALE;
    const mph = Number.isFinite(c[CP.mph]) && (c[CP.mph] as number) >= 0 ? Math.round(c[CP.mph] as number) : null;
    const lat = c[CP.lat];
    const lon = c[CP.lon];
    let d: number | null = null;
    if (typeof lat === "number" && typeof lon === "number" && lat !== 0 && lon !== 0) {
      const p = placeOnTrack(g, lat, lon, prev?.get(num));
      if (p.off <= OFF_TRACK_M) d = Math.round(p.d);
    }
    if (d === null) {
      flags |= NO_GPS;
      const pct = c[CP.lapPct];
      if (typeof pct === "number" && pct >= 0 && pct <= 100) d = Math.round((pct / 100) * g.len);
    }
    cars.push([num, d, mph, flags]);
  }
  return { t, cars };
}

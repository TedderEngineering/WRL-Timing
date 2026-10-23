/**
 * RaceTrace Live: turning the track map. The viewer turns the circuit to suit it (Road Atlanta,
 * VIR, COTA): dragging round the map's centre, or a step of 45° at a time. The map fits the turned
 * outline to the space it has, so it fills it at any angle. Only positions turn: car numbers,
 * tags and labels stay upright.
 *
 * Angles are in degrees, clockwise on screen, kept in [0, 360). The angle is kept per circuit on
 * this device.
 */

/** Within this many degrees of a multiple of 45° (vertical, horizontal, diagonal), a drag snaps to it. */
export const SNAP_DEG = 5;

/** An angle folded into [0, 360). */
export function normDeg(a: number): number {
  const x = a % 360;
  const r = x < 0 ? x + 360 : x;
  return r >= 360 - 1e-9 ? 0 : r;
}

/** A dragged angle, snapped to the nearest multiple of 45° when within SNAP_DEG of it (unless `free`). */
export function snapDeg(a: number, free = false): number {
  const n = normDeg(a);
  if (free) return n;
  const near = Math.round(n / 45) * 45;
  return Math.abs(n - near) <= SNAP_DEG ? normDeg(near) : n;
}

/** The next multiple of 45° clockwise (dir 1) or anticlockwise (dir −1) from an angle. */
export function stepDeg(a: number, dir: 1 | -1): number {
  const n = normDeg(a);
  const k = n / 45;
  const onStep = Math.abs(k - Math.round(k)) < 1e-6;
  return normDeg((dir > 0 ? (onStep ? Math.round(k) + 1 : Math.ceil(k)) : onStep ? Math.round(k) - 1 : Math.floor(k)) * 45);
}

/**
 * The projection from the outline's coordinates (y down) to the canvas: the outline turned by
 * `deg` about its centre, then scaled to fit a W × H canvas inside `pad` and centred.
 */
export function rotatedFit(pts: [number, number][], w: number, h: number, deg: number, W: number, H: number, pad: number): (p: [number, number]) => [number, number] {
  const rad = (normDeg(deg) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  const turn = ([x, y]: [number, number]): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    return [dx * cos - dy * sin, dx * sin + dy * cos];
  };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts.length ? pts : [[0, 0] as [number, number], [w, h] as [number, number]]) {
    const [x, y] = turn(p);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bw = Math.max(1e-6, maxX - minX);
  const bh = Math.max(1e-6, maxY - minY);
  const scale = Math.max(0, Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh));
  const ox = W / 2 - ((minX + maxX) / 2) * scale;
  const oy = H / 2 - ((minY + maxY) / 2) * scale;
  return (p) => {
    const [x, y] = turn(p);
    return [ox + x * scale, oy + y * scale];
  };
}

const KEY = (circuit: string) => `rt.live.mapAngle:${circuit.trim().toLowerCase()}`;

/** The angle this viewer turned this circuit to (0 when not turned, or storage is unavailable). */
export function readMapAngle(circuit: string): number {
  if (!circuit) return 0;
  try {
    const v = Number(localStorage.getItem(KEY(circuit)));
    return Number.isFinite(v) ? normDeg(v) : 0;
  } catch {
    return 0;
  }
}

export function saveMapAngle(circuit: string, deg: number): void {
  if (!circuit) return;
  try {
    const n = normDeg(deg);
    if (n < 1e-6) localStorage.removeItem(KEY(circuit));
    else localStorage.setItem(KEY(circuit), n.toFixed(1));
  } catch {
    /* private window: for this visit only */
  }
}

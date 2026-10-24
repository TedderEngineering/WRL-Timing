/**
 * Touch gestures for the lap charts (Position Trace and Lap Times), the ones phones already teach
 * in Photos and Maps:
 *
 *  - pinch: zoom the laps in or out, holding the laps under your fingers in place
 *  - two-finger drag: move along the race while pinching
 *  - double-tap: zoom in on the tapped lap; double-tap again to see the whole race (as a photo)
 *  - two-finger tap: zoom out a step (as Maps)
 *  - one-finger drag: move along the race when zoomed in, and read each lap you pass;
 *    let go while moving and it glides to a stop
 *  - tap: pick a lap; the lap sheet rises once the tap is known not to be a double-tap
 *
 * Only the laps (the x axis) zoom; positions stay put. The page's own zoom is switched off over
 * the chart (`touch-action: none`), so a pinch zooms the chart, not the page.
 *
 * The window math is pure and tested; `useChartGestures` wires it to a canvas.
 */
import { useEffect, useRef, type RefObject } from "react";
import { lapOfX, type ChartDimensions } from "./chart-renderer";

/** The fewest laps a zoom can show, as the mouse wheel. */
export const MIN_LAPS = 5;
/** How far a double-tap zooms in. */
export const DOUBLE_TAP_ZOOM = 3;
/** A second tap this soon and this near the first is a double-tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;
/** A finger that moves less than this is still tapping. */
export const TAP_SLOP_PX = 8;

export type LapWindow = [start: number, end: number];

/** The widest window: the whole race. */
function fullRange(maxLap: number): number {
  return Math.max(0, maxLap - 1);
}

/** A window `range` laps wide starting at `start`, kept inside laps 1..maxLap. */
export function clampWindow(start: number, range: number, maxLap: number): LapWindow {
  const full = fullRange(maxLap);
  const r = Math.min(Math.max(range, Math.min(MIN_LAPS, full)), full);
  const s = Math.min(Math.max(start, 1), maxLap - r);
  return [s, s + r];
}

/**
 * A window `range` laps wide that puts `anchorLap` at `frac` of the way across (0 = left
 * edge, 1 = right edge), so the lap under a finger stays under it as the zoom changes.
 */
export function zoomAt(anchorLap: number, frac: number, range: number, maxLap: number): LapWindow {
  const full = fullRange(maxLap);
  const r = Math.min(Math.max(range, Math.min(MIN_LAPS, full)), full);
  return clampWindow(anchorLap - frac * r, r, maxLap);
}

/** Where x sits across the plot, 0 at the left edge and 1 at the right. */
export function fracOfX(x: number, dim: Pick<ChartDimensions, "ML" | "CW">): number {
  return dim.CW > 0 ? (x - dim.ML) / dim.CW : 0.5;
}

export function isZoomedIn([start, end]: LapWindow, maxLap: number): boolean {
  return end - start < fullRange(maxLap) - 0.5;
}

/**
 * What a double-tap at `lap` shows: zoomed in around it, or the whole race when already zoomed
 * in (Photos' double-tap).
 */
export function doubleTapWindow(win: LapWindow, lap: number, maxLap: number): LapWindow {
  if (isZoomedIn(win, maxLap)) return [1, maxLap];
  const [s, e] = win;
  const range = e - s;
  const frac = range > 0 ? (lap - s) / range : 0.5;
  return zoomAt(lap, frac, range / DOUBLE_TAP_ZOOM, maxLap);
}

/** A two-finger tap zooms out a step around the point between the fingers (Maps). */
export function zoomOutWindow(win: LapWindow, lap: number, maxLap: number): LapWindow {
  const [s, e] = win;
  const range = e - s;
  const frac = range > 0 ? (lap - s) / range : 0.5;
  return zoomAt(lap, frac, range * 2, maxLap);
}

/**
 * A pinch: the window it started with, scaled by how far the fingers spread (`startDist` to
 * `dist`), with the lap that was between the fingers kept between them (`frac`, which also
 * carries a two-finger drag).
 */
export function pinchWindow(
  startWin: LapWindow,
  anchorLap: number,
  startDist: number,
  dist: number,
  frac: number,
  maxLap: number
): LapWindow {
  const range = (startWin[1] - startWin[0]) * (startDist / Math.max(dist, 1));
  return zoomAt(anchorLap, frac, range, maxLap);
}

/** One-finger drag: the window moved by `dx` pixels across a plot `cw` pixels wide. */
export function panWindow(startWin: LapWindow, dx: number, cw: number, maxLap: number): LapWindow {
  const range = startWin[1] - startWin[0];
  return clampWindow(startWin[0] - (dx / Math.max(cw, 1)) * range, range, maxLap);
}

export function isDoubleTap(
  prev: { t: number; x: number; y: number } | null,
  cur: { t: number; x: number; y: number }
): boolean {
  if (!prev) return false;
  return cur.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= DOUBLE_TAP_PX;
}

// ─── The hook ──────────────────────────────────────────────────────────────

export interface ChartGestureConfig {
  dim: ChartDimensions | null;
  maxLap: number;
  /** The window now shown. */
  getWindow: () => LapWindow;
  setWindow: (win: LapWindow) => void;
  /** A lap was tapped or passed under a dragging finger: show its details. */
  showLap: (lap: number) => void;
  /** A tap that was not the first half of a double-tap: raise the lap sheet. */
  onTap?: () => void;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Attaches the gestures to `target` (the chart canvas). The listeners are native and not
 * passive, so they can stop the browser's own pinch-zoom and the mouse events it would
 * otherwise copy from a tap (which would start the desktop's double-click range select).
 */
export function useChartGestures(
  target: RefObject<HTMLElement | null>,
  config: ChartGestureConfig,
  /** Anything that swaps the canvas element (the phone and laptop layouts render it apart). */
  remountKey?: unknown
) {
  const cfg = useRef(config);
  cfg.current = config;

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    el.style.touchAction = "none";

    type Pt = { x: number; y: number };
    let mode: "none" | "pan" | "pinch" = "none";
    let startPt: Pt = { x: 0, y: 0 };
    let startT = 0;
    let startWin: LapWindow = [1, 1];
    let moved = false;
    // Pinch
    let pinchDist = 1;
    let pinchLap = 1;
    let pinchStartMid: Pt = { x: 0, y: 0 };
    let twoFingerTap = false;
    let liftPt: Pt | null = null;
    // Taps
    let lastTap: { t: number; x: number; y: number } | null = null;
    let tapTimer: ReturnType<typeof setTimeout> | undefined;
    // Glide and zoom animation
    let samples: { t: number; x: number }[] = [];
    let raf = 0;

    const localX = (clientX: number) => clientX - el.getBoundingClientRect().left;
    const lapAt = (x: number, win: LapWindow) => {
      const { dim, maxLap } = cfg.current;
      if (!dim) return 1;
      return Math.max(1, Math.min(maxLap, Math.round(lapOfX(x, win[0], win[1], dim))));
    };
    const stopMotion = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const animateTo = (to: LapWindow) => {
      stopMotion();
      const from = cfg.current.getWindow();
      if (prefersReducedMotion()) return cfg.current.setWindow(to);
      const t0 = performance.now();
      const ms = 220;
      const frame = (now: number) => {
        const p = Math.min(1, (now - t0) / ms);
        const k = 1 - Math.pow(1 - p, 3);
        cfg.current.setWindow([from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k]);
        raf = p < 1 ? requestAnimationFrame(frame) : 0;
      };
      raf = requestAnimationFrame(frame);
    };
    const glide = (pxPerMs: number) => {
      stopMotion();
      if (prefersReducedMotion() || Math.abs(pxPerMs) < 0.3) return;
      let v = pxPerMs;
      let last = performance.now();
      // Kept here, not read back each frame: the chart may not have drawn the last one yet.
      let win = cfg.current.getWindow();
      const frame = (now: number) => {
        const { dim, maxLap } = cfg.current;
        const dt = now - last;
        last = now;
        v *= Math.pow(0.995, dt);
        if (!dim || Math.abs(v) < 0.02) return void (raf = 0);
        const next = panWindow(win, v * dt, dim.CW, maxLap);
        if (next[0] === win[0]) return void (raf = 0); // hit an end of the race
        win = next;
        cfg.current.setWindow(next);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };

    const beginPinch = (a: Touch, b: Touch) => {
      const { dim } = cfg.current;
      mode = "pinch";
      startWin = cfg.current.getWindow();
      pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchStartMid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
      pinchLap = dim ? lapOfX(localX(pinchStartMid.x), startWin[0], startWin[1], dim) : 1;
    };
    const beginPan = (t: Touch) => {
      mode = "pan";
      startPt = { x: t.clientX, y: t.clientY };
      startWin = cfg.current.getWindow();
      samples = [{ t: performance.now(), x: t.clientX }];
    };

    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      stopMotion();
      if (mode === "none") startT = performance.now();
      liftPt = null;
      if (e.touches.length >= 2) {
        // A second finger: a pinch (or a two-finger tap) begins, and no tap is coming.
        twoFingerTap = mode !== "pan" || !moved;
        if (e.touches.length > 2) twoFingerTap = false;
        moved = true;
        beginPinch(e.touches[0], e.touches[1]);
        return;
      }
      const t = e.touches[0];
      beginPan(t);
      moved = false;
      twoFingerTap = false;
    };

    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      const { dim, maxLap } = cfg.current;
      if (!dim) return;
      if (mode === "pinch" && e.touches.length === 1 && liftPt) {
        // One finger of a two-finger tap still down: it becomes a drag once it moves.
        const t = e.touches[0];
        if (Math.hypot(t.clientX - liftPt.x, t.clientY - liftPt.y) < TAP_SLOP_PX) return;
        twoFingerTap = false;
        liftPt = null;
        beginPan(t);
        startPt = { x: t.clientX, y: t.clientY };
      }
      if (mode === "pinch" && e.touches.length >= 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
        if (Math.abs(dist - pinchDist) > TAP_SLOP_PX || Math.hypot(mid.x - pinchStartMid.x, mid.y - pinchStartMid.y) > TAP_SLOP_PX)
          twoFingerTap = false;
        cfg.current.setWindow(pinchWindow(startWin, pinchLap, pinchDist, dist, fracOfX(localX(mid.x), dim), maxLap));
        return;
      }
      if (mode !== "pan" || !e.touches.length) return;
      const t = e.touches[0];
      const dx = t.clientX - startPt.x;
      if (!moved && Math.hypot(dx, t.clientY - startPt.y) < TAP_SLOP_PX) return;
      moved = true;
      const next = panWindow(startWin, dx, dim.CW, maxLap);
      cfg.current.setWindow(next);
      cfg.current.showLap(lapAt(localX(t.clientX), next));
      const now = performance.now();
      samples.push({ t: now, x: t.clientX });
      samples = samples.filter((s) => now - s.t < 100);
    };

    const onEnd = (e: TouchEvent) => {
      // Stops the mouse events a browser copies from a tap.
      if (e.cancelable) e.preventDefault();
      const { dim, maxLap } = cfg.current;
      if (e.touches.length === 1 && mode === "pinch") {
        const t = e.touches[0];
        // One finger lifted from a pinch: carry on moving with the other; or, if this may be a
        // two-finger tap, wait to see whether the other finger moves.
        if (twoFingerTap) liftPt = { x: t.clientX, y: t.clientY };
        else beginPan(t);
        return;
      }
      if (e.touches.length > 0) return;

      const wasPinch = mode === "pinch";
      mode = "none";
      if (!dim) return;

      if (wasPinch) {
        if (twoFingerTap && performance.now() - startT < 400) {
          const win = cfg.current.getWindow();
          animateTo(zoomOutWindow(win, pinchLap, maxLap));
        }
        return;
      }

      const ct = e.changedTouches[0];
      if (moved) {
        // Let go while moving: glide on.
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dt = last && first ? last.t - first.t : 0;
        if (dt > 0 && performance.now() - last.t < 60) glide((last.x - first.x) / dt);
        return;
      }

      const tap = { t: performance.now(), x: ct.clientX, y: ct.clientY };
      const win = cfg.current.getWindow();
      const lap = lapAt(localX(ct.clientX), win);
      if (isDoubleTap(lastTap, tap)) {
        clearTimeout(tapTimer);
        lastTap = null;
        animateTo(doubleTapWindow(win, lapOfX(localX(ct.clientX), win[0], win[1], dim), maxLap));
        return;
      }
      lastTap = tap;
      // The lap's details show at once; the sheet waits to see whether a second tap follows.
      cfg.current.showLap(lap);
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => cfg.current.onTap?.(), DOUBLE_TAP_MS);
    };

    const onCancel = () => {
      mode = "none";
      moved = false;
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
      clearTimeout(tapTimer);
      stopMotion();
    };
  }, [target, remountKey]);
}

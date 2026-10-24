import { describe, expect, it } from "vitest";
import {
  clampWindow,
  doubleTapWindow,
  fracOfX,
  isDoubleTap,
  isZoomedIn,
  panWindow,
  pinchWindow,
  zoomAt,
  zoomOutWindow,
} from "../chart-gestures";

const MAX = 121; // a 121-lap race: the whole race is laps 1–121, 120 laps wide

describe("chart gestures: lap window math", () => {
  it("keeps a window inside the race and at least 5 laps wide", () => {
    expect(clampWindow(-10, 20, MAX)).toEqual([1, 21]);
    expect(clampWindow(110, 20, MAX)).toEqual([101, 121]);
    expect(clampWindow(50, 2, MAX)).toEqual([50, 55]);
    expect(clampWindow(1, 500, MAX)).toEqual([1, 121]);
  });

  it("copes with a race shorter than the 5-lap minimum", () => {
    expect(clampWindow(1, 1, 3)).toEqual([1, 3]);
  });

  it("zooms around a lap, holding it at the same place across the chart", () => {
    const [s, e] = zoomAt(61, 0.5, 20, MAX);
    expect([s, e]).toEqual([51, 71]);
    expect((61 - s) / (e - s)).toBeCloseTo(0.5);
  });

  it("pinching apart zooms in on the laps between the fingers", () => {
    // Fingers spread from 100 px to 300 px: a third of the laps, lap 61 kept in the middle.
    const [s, e] = pinchWindow([1, MAX], 61, 100, 300, 0.5, MAX);
    expect(e - s).toBeCloseTo(40);
    expect((s + e) / 2).toBeCloseTo(61);
  });

  it("pinching together zooms out, but no further than the whole race", () => {
    expect(pinchWindow([41, 81], 61, 300, 100, 0.5, MAX)).toEqual([1, 121]);
  });

  it("a two-finger drag moves the window with the fingers", () => {
    // Same spread, midpoint moved from the middle to a quarter across: lap 61 follows.
    const [s, e] = pinchWindow([41, 81], 61, 200, 200, 0.25, MAX);
    expect([s, e]).toEqual([51, 91]);
  });

  it("double-tap zooms in 3× on the tapped lap, and again shows the whole race", () => {
    const zoomed = doubleTapWindow([1, MAX], 31, MAX);
    expect(zoomed[1] - zoomed[0]).toBeCloseTo(40);
    expect((31 - zoomed[0]) / (zoomed[1] - zoomed[0])).toBeCloseTo(0.25);
    expect(isZoomedIn(zoomed, MAX)).toBe(true);
    expect(doubleTapWindow(zoomed, 40, MAX)).toEqual([1, MAX]);
  });

  it("two-finger tap zooms out a step", () => {
    const [s, e] = zoomOutWindow([51, 71], 61, MAX);
    expect([s, e]).toEqual([41, 81]);
  });

  it("dragging right shows earlier laps and stops at the start of the race", () => {
    expect(panWindow([51, 71], 100, 400, MAX)).toEqual([46, 66]);
    expect(panWindow([11, 31], 1000, 400, MAX)).toEqual([1, 21]);
    expect(panWindow([1, MAX], -200, 400, MAX)).toEqual([1, MAX]);
  });

  it("knows where across the plot a point is", () => {
    expect(fracOfX(60, { ML: 40, CW: 200 })).toBeCloseTo(0.1);
  });

  it("a double-tap is two taps within 300 ms and 30 px", () => {
    const a = { t: 0, x: 100, y: 100 };
    expect(isDoubleTap(null, a)).toBe(false);
    expect(isDoubleTap(a, { t: 250, x: 110, y: 120 })).toBe(true);
    expect(isDoubleTap(a, { t: 350, x: 100, y: 100 })).toBe(false);
    expect(isDoubleTap(a, { t: 100, x: 160, y: 100 })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { nextZoom } from "../live-zoom";
import { lapLabelStep } from "../chart-renderer";

describe("nextZoom", () => {
  it("resets to the whole race for a finished race", () => {
    expect(nextZoom(100, 120, 20, 40, false)).toEqual([1, 120]);
  });
  it("follows the latest lap on a live race", () => {
    expect(nextZoom(100, 101, 1, 100, true)).toEqual([1, 101]);
  });
  it("slides a zoomed-in window at the end along, keeping its width", () => {
    expect(nextZoom(100, 101, 60, 100, true)).toEqual([61, 101]);
  });
  it("keeps following after a swipe left the end a fraction short", () => {
    // Laps 1-99.97 of 100: still the whole race, so it shows 1-101 of 101.
    expect(nextZoom(100, 101, 1, 99.97, true)).toEqual([1, 101]);
    const [s, e] = nextZoom(100, 102, 60.5, 99.6, true);
    expect(e).toBe(102);
    expect(s).toBeCloseTo(102 - 39.1, 6);
  });
  it("keeps a live view zoomed into earlier laps", () => {
    expect(nextZoom(100, 101, 20, 40, true)).toEqual([20, 40]);
  });
  it("resets when a live race loses laps (a new session)", () => {
    expect(nextZoom(100, 3, 20, 40, true)).toEqual([1, 3]);
  });
});


describe("lapLabelStep", () => {
  it("keeps the old steps when labels fit", () => {
    expect(lapLabelStep(10, 60)).toBe(1);
    expect(lapLabelStep(40, 20)).toBe(5);
    expect(lapLabelStep(200, 7)).toBe(10);
  });
  it("widens the step on a narrow chart", () => {
    // 200 laps on a ~330 px phone chart: 1.65 px a lap → every 25 laps.
    expect(lapLabelStep(200, 1.65)).toBe(25);
    expect(lapLabelStep(800, 0.4)).toBe(100);
  });
});

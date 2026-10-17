import { describe, expect, it } from "vitest";
import { nextZoom } from "../live-zoom";

describe("nextZoom", () => {
  it("resets to the whole race for a finished race", () => {
    expect(nextZoom(100, 120, 20, 40, false)).toEqual([1, 120]);
  });
  it("follows the latest lap on a live race", () => {
    expect(nextZoom(100, 101, 1, 100, true)).toEqual([1, 101]);
    expect(nextZoom(100, 101, 60, 100, true)).toEqual([60, 101]);
  });
  it("keeps a live view zoomed into earlier laps", () => {
    expect(nextZoom(100, 101, 20, 40, true)).toEqual([20, 40]);
  });
  it("resets when a live race loses laps (a new session)", () => {
    expect(nextZoom(100, 3, 20, 40, true)).toEqual([1, 3]);
  });
});

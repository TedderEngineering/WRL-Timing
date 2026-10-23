import { describe, expect, it } from "vitest";
import { normDeg, rotatedFit, snapDeg, stepDeg } from "../map-rotate";

describe("turning the track map", () => {
  // A long, flat circuit: 1000 × 200.
  const pts: [number, number][] = [[0, 0], [1000, 0], [1000, 200], [0, 200]];

  it("fits the outline unturned as before: centred and as large as the space allows", () => {
    const px = rotatedFit(pts, 1000, 200, 0, 600, 400, 50);
    // Width limits: 500 px for 1000 m, so 0.5 a metre; centred in 600 × 400.
    expect(px([0, 0])).toEqual([50, 150]);
    expect(px([1000, 200])).toEqual([550, 250]);
  });

  it("turned 90° on a tall space, fits the turned outline (larger, since it now runs the long way)", () => {
    const px = rotatedFit(pts, 1000, 200, 90, 300, 600, 50);
    // The turned outline is 200 wide and 1000 tall: height limits, 500 / 1000.
    const a = px([0, 0]);
    const b = px([1000, 200]);
    expect(Math.abs(b[1] - a[1])).toBeCloseTo(500, 6);
    expect(Math.abs(b[0] - a[0])).toBeCloseTo(100, 6);
    // Turned clockwise on screen: the outline's right end (x 1000) is now at the bottom.
    expect(px([1000, 100])[1]).toBeGreaterThan(px([0, 100])[1]);
    // Centred.
    expect((a[0] + b[0]) / 2).toBeCloseTo(150, 6);
    expect((a[1] + b[1]) / 2).toBeCloseTo(300, 6);
  });

  it("keeps every point inside the space at any angle", () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const px = rotatedFit(pts, 1000, 200, deg, 500, 300, 20);
      for (const p of pts) {
        const [x, y] = px(p);
        expect(x).toBeGreaterThanOrEqual(20 - 1e-6);
        expect(x).toBeLessThanOrEqual(480 + 1e-6);
        expect(y).toBeGreaterThanOrEqual(20 - 1e-6);
        expect(y).toBeLessThanOrEqual(280 + 1e-6);
      }
    }
  });

  it("snaps a drag to vertical, horizontal or 45° when near one, unless turned freely", () => {
    expect(snapDeg(93)).toBe(90);
    expect(snapDeg(-2)).toBe(0);
    expect(snapDeg(357)).toBe(0);
    expect(snapDeg(41)).toBe(45);
    expect(snapDeg(60)).toBe(60);
    expect(snapDeg(93, true)).toBe(93);
    expect(normDeg(-90)).toBe(270);
  });

  it("steps 45° at a time from any angle", () => {
    expect(stepDeg(0, 1)).toBe(45);
    expect(stepDeg(0, -1)).toBe(315);
    expect(stepDeg(60, 1)).toBe(90);
    expect(stepDeg(60, -1)).toBe(45);
    expect(stepDeg(315, 1)).toBe(0);
  });
});

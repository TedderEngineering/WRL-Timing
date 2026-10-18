import { describe, expect, it } from "vitest";
import { IN_PIT, MAX_COAST_MS, pointAt, signedGap, step, takeReading, targetOf, type CarMotion } from "../track-motion";

const LEN = 5734.36;

describe("motion between readings", () => {
  it("carries a car on at the pace between its last two readings", () => {
    let m = takeReading(new Map(), [["119", 1000, 100, 0]], 0, 0, LEN, 40);
    m = takeReading(m, [["119", 1200, 100, 0]], 5000, 0, LEN, 40);
    const car = m.get("119")!;
    expect(car.v).toBeCloseTo(40, 6); // 200 m in 5 s
    expect(targetOf(car, 7500, LEN)).toBeCloseTo(1300, 6);
  });
  it("uses the timing's speed, then a typical pace, before it has two readings", () => {
    expect(takeReading(new Map(), [["1", 10, 100, 0]], 0, 0, LEN, 40).get("1")!.v).toBeCloseTo(44.704, 3);
    expect(takeReading(new Map(), [["1", 10, null, 0]], 0, 0, LEN, 38).get("1")!.v).toBe(38);
  });
  it("counts the reading's age, so a car read 2 s ago is already 2 s further on", () => {
    const m = takeReading(new Map(), [["1", 100, null, 0]], 10_000, 2_000, LEN, 40);
    expect(targetOf(m.get("1")!, 10_000, LEN)).toBeCloseTo(180, 6);
  });
  it("crosses the line: 5,700 m to 60 m is 94 m covered, not a lap backwards", () => {
    let m = takeReading(new Map(), [["1", 5700, null, 0]], 0, 0, LEN, 40);
    m = takeReading(m, [["1", 60, null, 0]], 2500, 0, LEN, 40);
    expect(m.get("1")!.v).toBeCloseTo((LEN - 5700 + 60) / 2.5, 3);
  });
  it("holds after coasting too long without a reading", () => {
    const m = takeReading(new Map(), [["1", 0, null, 0]], 0, 0, LEN, 40);
    expect(targetOf(m.get("1")!, 60_000, LEN)).toBeCloseTo((40 * MAX_COAST_MS) / 1000, 6);
  });
  it("slows a car in the pit lane", () => {
    expect(takeReading(new Map(), [["1", 0, 120, IN_PIT]], 0, 0, LEN, 40).get("1")!.v).toBeLessThan(14);
  });
  it("leaves out a car with no place", () => {
    expect(takeReading(new Map(), [["1", null, null, 2]], 0, 0, LEN, 40).size).toBe(0);
  });
});

describe("easing", () => {
  const car = (shown: number, d: number): Map<string, CarMotion> => new Map([["1", { num: "1", d, at: 0, flags: 0, mph: null, v: 0, shown }]]);
  it("glides towards a reading ahead", () => {
    const m = car(1000, 1100);
    step(m, 0, 600, LEN);
    expect(m.get("1")!.shown).toBeGreaterThan(1060);
    expect(m.get("1")!.shown).toBeLessThan(1100);
  });
  it("never rolls back for a small correction", () => {
    const m = car(1100, 1080);
    step(m, 0, 600, LEN);
    expect(m.get("1")!.shown).toBe(1100);
  });
  it("moves straight to a large correction", () => {
    const m = car(1000, 2000);
    step(m, 0, 16, LEN);
    expect(m.get("1")!.shown).toBe(2000);
  });
  it("measures gaps the short way round the lap", () => {
    expect(signedGap(5700, 30, LEN)).toBeCloseTo(64.36, 2);
    expect(signedGap(30, 5700, LEN)).toBeCloseTo(-64.36, 2);
  });
});

describe("pointAt", () => {
  const pts: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const ds = [0, 100, 200, 300];
  it("interpolates along the outline and closes the lap", () => {
    expect(pointAt(pts, ds, 400, 50)).toEqual([50, 0]);
    expect(pointAt(pts, ds, 400, 250)).toEqual([50, 100]);
    expect(pointAt(pts, ds, 400, 350)).toEqual([0, 50]);
    expect(pointAt(pts, ds, 400, 450)).toEqual([50, 0]);
  });
  it("handles an outline whose first point is past the line", () => {
    const ds2 = [20, 120, 220, 320];
    expect(pointAt(pts, ds2, 400, 10)).toEqual([0, 10]); // 90% along the closing segment from [0, 100] to [0, 0]
  });
});

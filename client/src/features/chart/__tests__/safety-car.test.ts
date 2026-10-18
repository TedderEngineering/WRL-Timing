import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import { SC_AHEAD_M, SC_RESET_M, findSafetyCar, isCaution, scSpeed, scTarget, stepSafetyCar } from "../TrackMap";
import { IN_PIT, type CarMotion } from "../track-motion";

const LEN = 5734.36;
const m = (num: string, shown: number, flags = 0, mph: number | null = null): CarMotion => ({ num, d: shown, at: 0, flags, mph, v: 40, shown });
const data = {
  maxLap: 10,
  cars: {
    "119": { num: 119, team: "AE Victory Racing", cls: "GTO", finishPos: 1, finishPosClass: 1, laps: [] },
    "776": { num: 776, team: "HM Road and Race", cls: "GTO", finishPos: 2, finishPosClass: 2, laps: [] },
  },
} as unknown as RaceChartData;

describe("the safety car on the track map", () => {
  it("only under a caution", () => {
    expect(isCaution("Yellow")).toBe(true);
    expect(isCaution("Code 35")).toBe(true);
    expect(isCaution("Green")).toBe(false);
  });
  it("heads the field: just ahead of the first car in the running order still on track", () => {
    expect(scTarget(new Map([["119", m("119", 1000)], ["776", m("776", 900)]]), data, LEN)).toBe(1000 + SC_AHEAD_M);
    // The leader in the pits: the next car on track.
    expect(scTarget(new Map([["119", m("119", 1000, IN_PIT)], ["776", m("776", 900)]]), data, LEN)).toBe(900 + SC_AHEAD_M);
  });
  it("runs at the field's median speed under the caution, within 40-90 mph", () => {
    expect(scSpeed(new Map([["a", m("a", 0, 0, 60)], ["b", m("b", 0, 0, 70)], ["c", m("c", 0, 0, 200)]]))).toBeCloseTo(70 * 0.44704, 6);
    expect(scSpeed(new Map([["a", m("a", 0, 0, 20)]]))).toBeCloseTo(40 * 0.44704, 6);
    expect(scSpeed(new Map())).toBeCloseTo(65 * 0.44704, 6);
  });
  it("moves steadily at its pace, nudged towards the head of the field, never backwards", () => {
    const v = 30;
    let sc = stepSafetyCar({ d: 0, active: false }, 1000, v, 16, LEN);
    expect(sc).toEqual({ d: 1000, active: true });
    // The leader's place stalls (a repeated GPS fix): the safety car keeps going at its pace…
    sc = stepSafetyCar(sc, 1000, v, 1000, LEN);
    expect(sc.d).toBeCloseTo(1000 + v, 6);
    // …and, now ahead of where it should be, a little slower, still forward.
    sc = stepSafetyCar(sc, 1000, v, 1000, LEN);
    expect(sc.d).toBeGreaterThan(1000 + v + 0.74 * v);
    expect(sc.d).toBeLessThan(1000 + 2 * v);
    // The leader's place jumps 300 m ahead: faster, at most +25%, no jump.
    const before = sc.d;
    sc = stepSafetyCar(sc, before + 300, v, 1000, LEN);
    expect(sc.d - before).toBeCloseTo(1.25 * v, 6);
    // Far behind it (a new reading puts the field 200 m back): slower, still forward.
    const b2 = sc.d;
    sc = stepSafetyCar(sc, b2 - 200, v, 1000, LEN);
    expect(sc.d).toBeGreaterThan(b2);
  });
  it("is placed again only when over 800 m out, and keeps going with no car to follow", () => {
    const sc = stepSafetyCar({ d: 1000, active: true }, 1000 + SC_RESET_M + 50, 30, 16, LEN);
    expect(sc.d).toBe(1000 + SC_RESET_M + 50);
    expect(stepSafetyCar({ d: 1000, active: true }, null, 30, 1000, LEN)).toEqual({ d: 1030, active: true });
    expect(stepSafetyCar({ d: 0, active: false }, null, 30, 1000, LEN)).toEqual({ d: 0, active: false });
  });
  it("round the line", () => {
    expect(stepSafetyCar({ d: LEN - 10, active: true }, 50, 30, 1000, LEN).d).toBeGreaterThan(0);
    expect(stepSafetyCar({ d: LEN - 10, active: true }, 50, 30, 1000, LEN).d).toBeLessThan(40);
  });
  it("a safety car the timing sends as a car of its own is used as it is", () => {
    expect(findSafetyCar(new Map([["SC", m("SC", 1500)], ["119", m("119", 1000)]]))?.shown).toBe(1500);
    expect(findSafetyCar(new Map([["119", m("119", 1000)]]))).toBeNull();
  });
});

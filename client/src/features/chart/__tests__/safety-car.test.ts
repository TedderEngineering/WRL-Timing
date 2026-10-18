import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import { SC_AHEAD_M, isCaution, safetyCarAt } from "../TrackMap";
import { IN_PIT, type CarMotion } from "../track-motion";

const LEN = 5734.36;
const m = (num: string, shown: number, flags = 0): CarMotion => ({ num, d: shown, at: 0, flags, mph: null, v: 40, shown });
const data = {
  maxLap: 10,
  cars: {
    "87": { num: 87, team: "Stoic Racing", cls: "GTO", finishPos: 1, finishPosClass: 1, laps: [] },
    "119": { num: 119, team: "AE Victory Racing", cls: "GTO", finishPos: 2, finishPosClass: 2, laps: [] },
  },
} as unknown as RaceChartData;

describe("the safety car on the track map", () => {
  it("only under a caution", () => {
    expect(isCaution("Yellow")).toBe(true);
    expect(isCaution("Code 35")).toBe(true);
    expect(isCaution("Green")).toBe(false);
    expect(safetyCarAt(new Map([["87", m("87", 1000)]]), data, "Green", LEN)).toBeNull();
  });
  it("is estimated just ahead of the overall leader when the timing does not send it", () => {
    expect(safetyCarAt(new Map([["87", m("87", 1000)], ["119", m("119", 900)]]), data, "Yellow", LEN)).toEqual({ d: 1000 + SC_AHEAD_M, estimated: true });
    // Round the line.
    expect(safetyCarAt(new Map([["87", m("87", 5700)]]), data, "Yellow", LEN)!.d).toBeCloseTo(5700 + SC_AHEAD_M - LEN, 6);
  });
  it("uses the timing's own safety car when it sends one", () => {
    expect(safetyCarAt(new Map([["87", m("87", 1000)], ["SC", m("SC", 1500)]]), data, "Yellow", LEN)).toEqual({ d: 1500, estimated: false });
  });
  it("is not drawn when the leader is in the pits", () => {
    expect(safetyCarAt(new Map([["87", m("87", 1000, IN_PIT)]]), data, "Yellow", LEN)).toBeNull();
  });
});

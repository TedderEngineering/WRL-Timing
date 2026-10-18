import { describe, expect, it } from "vitest";
import type { CarData, RaceChartData } from "@shared/types";
import { SCORE_MIN_DISTANCE, computeStrategyMetrics } from "../strategy-engine";

/** A car of `n` laps of `lt` s, pitting (a 200-s lap) every `every` laps. */
function car(num: number, n: number, lt: number, every: number, finishPosClass: number): CarData {
  const laps = Array.from({ length: n }, (_, i) => {
    const l = i + 1;
    const pit = l % every === 0 ? 1 : 0;
    return { l, p: finishPosClass, cp: finishPosClass, lt: "", ltSec: pit ? 200 : lt + (l % 3) * 0.2, flag: "GF", pit };
  });
  return { num, team: `Team ${num}`, cls: "GTO", finishPos: finishPosClass, finishPosClass, laps };
}

const chart = (cars: CarData[]): RaceChartData => ({
  maxLap: 175,
  totalCars: cars.length,
  greenPaceCutoff: 180,
  cars: Object.fromEntries(cars.map((c) => [String(c.num), c])),
  fcy: [],
  classGroups: { GTO: cars.map((c) => c.num) },
  classCarCounts: { GTO: cars.length },
});

describe("strategy score", () => {
  // The winner ran 175 laps; #410 stopped after 44 with fewer stops and a quicker early pace.
  const data = chart([car(120, 175, 140.3, 25, 1), car(119, 175, 140.6, 22, 2), car(410, 44, 139.9, 22, 13)]);
  const m = Object.fromEntries(computeStrategyMetrics(data, {} as any).map((x) => [x.carNum, x]));

  it("does not score a car that ran under three quarters of its class's laps", () => {
    expect(44 / 175).toBeLessThan(SCORE_MIN_DISTANCE);
    expect(m[410].strategyScore).toBe(-1);
  });

  it("scores the cars that ran the race against each other, pit time as a share of race time", () => {
    expect(m[120].strategyScore).toBeGreaterThanOrEqual(0);
    expect(m[119].strategyScore).toBeGreaterThanOrEqual(0);
    // #120 stopped less often for its distance and lapped quicker: the better score.
    expect(m[120].strategyScore).toBeGreaterThan(m[119].strategyScore);
  });
});

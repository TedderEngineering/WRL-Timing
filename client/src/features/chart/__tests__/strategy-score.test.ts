import { describe, expect, it } from "vitest";
import type { CarData, RaceChartData } from "@shared/types";
import { SCORE_MIN_DISTANCE, computeStrategyMetrics, pitTimeSentence } from "../strategy-engine";

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

describe("strategy stops from the verified pit stops", () => {
  // Laps flagged in the pit lane: lap 1 (flagged by the feed, no stop), laps 12-13 (one stop under
  // a caution, over two laps), lap 33 (a stop), lap 50 (a drive-through penalty).
  const flagged = new Set([1, 12, 13, 33, 50]);
  const laps = Array.from({ length: 60 }, (_, i) => {
    const l = i + 1;
    const pit = flagged.has(l) ? 1 : 0;
    return { l, p: 1, cp: 1, lt: "", ltSec: pit ? 200 : 140, flag: "GF", pit };
  });
  const data = chart([{ num: 120, team: "AE Victory Racing", cls: "GTO", finishPos: 1, finishPosClass: 1, laps } as CarData]);
  const timing = (pitRoadTime: number | null, context: "green" | "fcy") => ({ pitInTime: null, pitRoadTime, pitOutTime: null, isDriveThrough: false, totalPitLoss: null, inLapTime: null, outLapTime: null, avgGreenLapTime: null, context, splitReliable: true, decompositionLevel: "total_only" as const });
  const note = (l: number, kind: string, t: ReturnType<typeof timing>) => ({ l, lb: "", c: "", yo: 0, da: 0, kind, pitTiming: t });
  const annotations: any = {
    "120": { reasons: {}, pits: [note(12, "stop", timing(null, "fcy")), note(33, "stop", timing(55, "green")), note(50, "drive_through", timing(30, "green"))] },
  };

  it("counts each stop once, not the drive-through or the flagged first lap", () => {
    const [m] = computeStrategyMetrics(data, annotations);
    expect(m.verified).toBe(true);
    expect(m.stops).toBe(2);
    expect(m.stintCount).toBe(3);
    expect(m.stints.map((s) => s.laps)).toEqual([12, 21, 27]);
    expect(m.yellowPitPct).toBe(50);
  });

  it("adds up the time in the pit lane and names the stop without one", () => {
    const [m] = computeStrategyMetrics(data, annotations);
    expect(m.totalPitTime).toBe(85);
    expect(m.untimedStops).toBe(1);
    expect(pitTimeSentence(m)).toMatch(/^Time in the pit lane: 1:25\.0 over 1 timed stop \(/);
  });

  it("falls back to the laps' pit flags for a race without verified stops", () => {
    const [m] = computeStrategyMetrics(data, {} as any);
    expect(m.verified).toBe(false);
    expect(m.stops).toBe(5);
  });
});

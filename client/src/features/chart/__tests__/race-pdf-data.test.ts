import { describe, expect, it } from "vitest";
import type { CarData, LapData, RaceChartData } from "@shared/types";
import { classPlacesGained, finishOrder, finishText, lapStats, racingLaps, stopsOf } from "../pdf/raceData";

const lap = (l: number, ltSec: number, extra: Partial<LapData> = {}): LapData => ({ l, p: 1, cp: 1, lt: "", ltSec, flag: "GF", pit: 0, ...extra });
const car = (num: number, laps: LapData[], extra: Partial<CarData> = {}): CarData => ({ num, team: `Team ${num}`, cls: "GTO", finishPos: 1, finishPosClass: 1, laps, ...extra });
const chart = (cars: CarData[]): RaceChartData => ({
  maxLap: 20,
  totalCars: cars.length,
  greenPaceCutoff: 999,
  cars: Object.fromEntries(cars.map((c) => [String(c.num), c])),
  fcy: [],
  classGroups: {},
  classCarCounts: {},
});

describe("race PDF figures", () => {
  // Laps 12-13 are one stop over two laps; lap 1 is flagged by the feed but is not a stop.
  const laps = Array.from({ length: 20 }, (_, i) => lap(i + 1, 100 + (i % 3) * 0.5, [1, 12, 13].includes(i + 1) ? { pit: 1 } : {}));
  const data = chart([car(7, laps)]);

  it("counts a visit over two laps once, from the flags or the verified stops", () => {
    expect(stopsOf(data, null, "7").map((s) => s.lap)).toEqual([12]);
    const notes: any = { "7": { reasons: {}, pits: [{ l: 12, lb: "", c: "", yo: 0, da: 0, kind: "stop" }, { l: 18, lb: "", c: "", yo: 0, da: 0, kind: "drive_through" }] } };
    expect(stopsOf(data, notes, "7")).toEqual([
      { lap: 12, kind: "stop" },
      { lap: 18, kind: "penalty" },
    ]);
  });

  it("keeps racing laps only and finds the best run of 10", () => {
    const racing = racingLaps(data.cars["7"], new Set([5]), stopsOf(data, null, "7"));
    // Not lap 1 or the lap after its pit flag, the caution lap 5, the in-laps 12-13 or the out-lap 14.
    expect(racing.map((l) => l.l)).toEqual([3, 4, 6, 7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 20]);
    const s = lapStats(racing);
    expect(s.best).toEqual({ t: 100, lap: 4 });
    expect(s.racingLaps).toBe(14);
    // No 10 consecutive racing laps here (5 and 12-14 break every run).
    expect(s.best10).toBeNull();
    const full = lapStats(Array.from({ length: 12 }, (_, i) => lap(i + 2, i < 10 ? 100 : 110)));
    expect(full.best10).toBe(100);
  });

  it("orders cars by result, unclassified last, and reads their finish", () => {
    const a = { key: "1", label: "1", car: car(1, [lap(1, 100, { cp: 3 })], { finishPosClass: 2 }) };
    const b = { key: "2", label: "2", car: car(2, [lap(1, 100, { cp: 1 })], { finishPosClass: 1 }) };
    const c = { key: "3", label: "3", car: car(3, [lap(1, 100)], { finishPosClass: 999, status: "dnf" }) };
    expect(finishOrder([c, a, b], "class").map((e) => e.key)).toEqual(["2", "1", "3"]);
    expect(finishText(c.car, "class", 3)).toBe("DNF");
    expect(classPlacesGained(a.car)).toBe(1);
  });
});

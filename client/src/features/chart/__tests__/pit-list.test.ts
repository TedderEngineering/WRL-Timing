import { describe, expect, it } from "vitest";
import type { CarData, RaceChartData } from "@shared/types";
import { OUT_AFTER_S, outCars } from "../RunningOrder";

const lapsOf = (n: number, sec: number) => Array.from({ length: n }, (_, i) => ({ l: i + 1, p: 1, cp: 1, lt: "", ltSec: sec, flag: "GF", pit: 0 }));
const car = (num: number, laps: CarData["laps"]): CarData => ({ num, team: "T", cls: "GTO", finishPos: num, finishPosClass: num, laps });
const chart = (cars: CarData[]): RaceChartData => ({
  maxLap: 0,
  totalCars: cars.length,
  greenPaceCutoff: 0,
  cars: Object.fromEntries(cars.map((c) => [String(c.num), c])),
  fcy: [],
  classGroups: {},
  classCarCounts: {},
});

describe("cars not running (OUT)", () => {
  it("is a car whose last lap ended over 15 minutes before the latest lap anyone completed", () => {
    const data = chart([
      car(119, lapsOf(160, 140)), // the leader: its last lap ended at 22,400 s
      car(62, lapsOf(150, 147)), // 22,050 s: 6 minutes behind, running
      car(282, lapsOf(112, 140)), // 15,680 s: 112 minutes behind, out (in the garage)
      car(2, lapsOf(4, 150)), // retired on lap 4
      car(9, []), // never started
    ]);
    expect([...outCars(data)].sort((a, b) => a - b)).toEqual([2, 9, 282]);
    expect(OUT_AFTER_S).toBe(900);
  });

  it("is nobody when nobody has lapped for a while (a red flag), or before the race", () => {
    expect(outCars(chart([car(119, lapsOf(100, 140)), car(120, lapsOf(100, 141))])).size).toBe(0);
    expect(outCars(chart([car(1, []), car(2, [])])).size).toBe(0);
  });

  it("is not a car making a long stop of under 15 minutes", () => {
    const data = chart([car(119, lapsOf(160, 140)), car(48, [...lapsOf(155, 140), { l: 156, p: 1, cp: 1, lt: "", ltSec: 0, flag: "GF", pit: 1 }])]);
    // #48 last crossed at 21,700 s, 700 s (under 15 minutes) before the leader's latest lap.
    expect(outCars(data).has(48)).toBe(false);
  });
});

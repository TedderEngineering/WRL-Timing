import { describe, expect, it } from "vitest";
import type { CarData, RaceChartData } from "@shared/types";
import { classColor, runningOrder } from "../RunningOrder";
import { CLASS_COLORS } from "../constants";

const car = (num: number, cls: string, finishPos: number, finishPosClass: number, label?: string): CarData => ({
  num,
  label,
  team: `Team ${num}`,
  cls,
  finishPos,
  finishPosClass,
  laps: [],
});

const chart = (cars: CarData[]): RaceChartData => ({
  maxLap: 10,
  totalCars: cars.length,
  greenPaceCutoff: 0,
  cars: Object.fromEntries(cars.map((c) => [String(c.num), c])),
  fcy: [],
  classGroups: {},
  classCarCounts: {},
});

describe("runningOrder", () => {
  it("lists cars by their position now, with class position and class", () => {
    const rows = runningOrder(chart([car(282, "GTO", 3, 2), car(119, "GP1", 1, 1), car(5, "GTO", 2, 1)]));
    expect(rows.map((r) => [r.pos, r.key, r.cls, r.posClass])).toEqual([
      [1, 119, "GP1", 1],
      [2, 5, "GTO", 1],
      [3, 282, "GTO", 2],
    ]);
  });

  it("puts cars without a position yet last, by car number, with no positions shown", () => {
    const rows = runningOrder(chart([car(51, "GTU", 0, 0), car(9, "GP2", 0, 0), car(2, "GP1", 1, 1)]));
    expect(rows.map((r) => r.key)).toEqual([2, 9, 51]);
    expect(rows[1]).toMatchObject({ pos: null, posClass: null });
  });

  it("orders unplaced cars by the published number", () => {
    const rows = runningOrder(chart([car(1007, "GTO", 0, 0, "007"), car(8, "GTO", 0, 0)]));
    expect(rows.map((r) => r.key)).toEqual([1007, 8]);
  });
});

describe("classColor", () => {
  it("uses each class's own colour, grey for any other", () => {
    expect(classColor("GTO")).toBe(CLASS_COLORS.GTO);
    expect(classColor("XYZ")).toBe("#9a9ab4");
  });
});

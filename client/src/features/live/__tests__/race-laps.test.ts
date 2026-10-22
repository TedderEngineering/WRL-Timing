import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import { greenRun, lapsToGo, virtualCars } from "../race-laps";

const race = (fcy: [number, number][], lead: number[] = []) =>
  ({ fcy, cars: { "1": { finishPos: 1, laps: lead.map((ltSec, i) => ({ l: i + 1, ltSec })) } } }) as unknown as RaceChartData;

describe("laps since the last green", () => {
  it("counts the leader's laps since the last caution ended, or since the start", () => {
    expect(greenRun(race([[30, 34], [80, 83]]), 95, false)).toEqual({ caution: false, laps: 12 });
    expect(greenRun(race([]), 40, false)).toEqual({ caution: false, laps: 40 });
  });
  it("counts the laps of the caution running now", () => {
    expect(greenRun(race([[30, 34], [96, 98]]), 98, true)).toEqual({ caution: true, laps: 3 });
  });
});

describe("laps to go", () => {
  it("is the time to go at the leader's average lap so far, the lap after the clock runs out included", () => {
    // 10 laps in 1500 s: 150 s a lap. 20 min to go: 8 laps.
    expect(lapsToGo(race([], Array(10).fill(150)), 1200)).toBe(8);
    expect(lapsToGo(race([], Array(10).fill(150)), 1201)).toBe(9);
    expect(lapsToGo(race([], Array(10).fill(150)), 0)).toBe(0);
    expect(lapsToGo(race([], []), 1200)).toBeNull();
    expect(lapsToGo(race([], Array(10).fill(150)), null)).toBeNull();
  });
});

describe("the virtual car", () => {
  const car = (cls: string, pos: number, laps: [number, number][]) => ({ cls, finishPosClass: pos, laps: laps.map(([ltSec, pit], i) => ({ l: i + 1, ltSec, pit })) });
  const data = {
    cars: {
      "120": car("GTO", 1, [[150, 0], [140, 0], [145, 1], [200, 0], [139, 0], [141, 0], [140, 0]]),
      "5": car("GP1", 1, [[150, 0], [150, 0], [150, 0], [150, 0]]),
      "99": car("GTO", 2, [[150, 0], [150, 0], [150, 0], [150, 0]]),
    },
  } as unknown as RaceChartData;

  it("laps at the class leader's last 3 racing laps and reaches the line as the clock runs out", () => {
    // GTO: 139, 141, 140 → 140 s (the in-lap and out-lap left out). 6000 m lap.
    const v = virtualCars(data, 700, 6000);
    const gto = v.find((x) => x.cls === "GTO")!;
    expect(gto.pace).toBe(140);
    // 700 s at 140 s a lap is 5 laps exactly: on the line now.
    expect(gto.d).toBeCloseTo(0, 6);
    // GP1 at 150 s: 700 s is 4 laps and 100 s, so it is 4000 m (100 s) from the line: 2000 m past it.
    expect(virtualCars(data, 700, 6000).find((x) => x.cls === "GP1")!.d).toBeCloseTo(2000, 6);
    // Ten seconds later (690 s to go) the GTO car has moved on 10 s at 140 s a lap.
    expect(virtualCars(data, 690, 6000).find((x) => x.cls === "GTO")!.d).toBeCloseTo((10 / 140) * 6000, 6);
  });

  it("is gone once the clock has run out, and leaves out a class leader that is not running", () => {
    expect(virtualCars(data, 0, 6000)).toEqual([]);
    expect(virtualCars(data, 700, 6000, new Set([5])).map((x) => x.cls)).toEqual(["GTO"]);
  });
});

import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import { classRivals } from "../car-groups";

/** A class of seven cars finishing in number order (#1 P1 … #7 P7), plus one car in another class. */
function race(): RaceChartData {
  const lap = { l: 1, p: 1, cp: 1, lt: "1:00.000", ltSec: 60, flag: "GF", pit: 0 };
  const cars: RaceChartData["cars"] = {};
  for (let n = 1; n <= 7; n++) cars[n] = { num: n, team: `T${n}`, cls: "GTO", finishPos: n, finishPosClass: n, laps: [lap] } as never;
  cars[9] = { num: 9, team: "T9", cls: "GTU", finishPos: 8, finishPosClass: 1, laps: [lap] } as never;
  return { maxLap: 1, totalCars: 8, greenPaceCutoff: 0, cars, fcy: [], classGroups: { GTO: [1, 2, 3, 4, 5, 6, 7], GTU: [9] }, classCarCounts: { GTO: 7, GTU: 1 } };
}
const all = [1, 2, 3, 4, 5, 6, 7, 9];

describe("class rivals", () => {
  it("are two cars ahead and two behind in the class", () => {
    expect(classRivals(race(), 4, all)).toEqual([2, 3, 5, 6]);
  });
  it("come from behind for the class leader, and from ahead for the last car", () => {
    expect(classRivals(race(), 1, all)).toEqual([2, 3, 4, 5]);
    expect(classRivals(race(), 7, all)).toEqual([3, 4, 5, 6]);
  });
  it("stay in the car's class and in view", () => {
    expect(classRivals(race(), 9, all)).toEqual([]);
    expect(classRivals(race(), 4, [1, 2, 4, 6, 7])).toEqual([1, 2, 6, 7]);
  });
  it("leave out cars that did not run", () => {
    const r = race();
    r.cars[3] = { ...r.cars[3], laps: [] };
    expect(classRivals(r, 4, all)).toEqual([1, 2, 5, 6]);
  });
});

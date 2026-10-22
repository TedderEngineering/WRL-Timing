import { describe, expect, it } from "vitest";
import { pitVisitLaps } from "../pit-visits.js";

describe("a car's pit stops (every page counts them this way)", () => {
  it("counts every pit-lane visit from the pit notes, one per in-lap, the last lap included", () => {
    expect(pitVisitLaps([], [{ l: 29 }, { l: 45 }, { l: 62 }, { l: 62 }, { l: 76 }])).toEqual([29, 45, 62, 76]);
  });
  it("without notes, counts a visit flagged over several laps once", () => {
    const laps = [1, 2, 3, 4, 5, 6, 7].map((l) => ({ l, pit: [3, 4, 7].includes(l) ? 1 : 0 }));
    expect(pitVisitLaps(laps, undefined)).toEqual([3, 7]);
  });
});

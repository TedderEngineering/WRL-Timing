import { describe, expect, it } from "vitest";
import { setPitLaneTimes } from "../pit-lane.js";

const lap = (llp: number, pet: string, pdm: number) => ({ n: "119", llp, pet, pdm });
const timing = (lost: number) => ({ pitRoadTime: lost, totalPitLoss: lost, decompositionLevel: "total_only" });

describe("live pit-lane times", () => {
  it("takes each stop's time in the pit lane from the timing, never its time lost", () => {
    const laps = [
      lap(11, "0001-01-01T09:00:00Z", 61200), // the previous visit, sticky
      lap(12, "0001-01-01T09:40:10Z", 0), // in-lap: the new entry, duration not in yet
      lap(13, "0001-01-01T09:40:10Z", 83400),
      lap(14, "0001-01-01T09:40:10Z", 83400),
      lap(33, "0001-01-01T10:30:00Z", 81900),
      lap(34, "0001-01-01T10:30:00Z", 81900),
    ];
    const ann = { "119": { pits: [{ l: 12, pitTiming: timing(125.2) }, { l: 33, pitTiming: timing(119.8) }, { l: 40, pitTiming: timing(130) }] } };
    expect(setPitLaneTimes(ann, { cars: { "119": {} } }, laps)).toBe(2);
    expect(ann["119"].pits.map((p) => [p.pitTiming.pitRoadTime, p.pitTiming.totalPitLoss])).toEqual([
      [83.4, 125.2],
      [81.9, 119.8],
      // No lap after it with a new entry: unknown, not the time lost.
      [null, 130],
    ]);
  });

  it("finds the car by its published number and ignores a reissued entry's partial time", () => {
    const laps = [{ n: "216x", llp: 4, pet: "a", pdm: 0 }, { n: "216x", llp: 5, pet: "b", pdm: 2300 }];
    const ann = { "216": { pits: [{ l: 5, pitTiming: timing(70) }] } };
    setPitLaneTimes(ann, { cars: { "216": { label: "216x" } } }, laps);
    expect(ann["216"].pits[0].pitTiming.pitRoadTime).toBeNull();
  });
});

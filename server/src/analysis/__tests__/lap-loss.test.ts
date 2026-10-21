import { describe, expect, it } from "vitest";
import { lapLossFacts } from "../lap-loss.js";
import type { RaceAnalysisPackage } from "../schema/package-types.js";

const pkg = (lapDowns: { car: string[]; lap: number[]; lapsDown: number[]; cause: string[] }, passages: object[] = [], extra: Partial<RaceAnalysisPackage> = {}) =>
  ({
    entries: [
      { car: "1", class: "A", result: { positionClass: 1, laps: 100 } },
      { car: "2", class: "A", result: { positionClass: 2, laps: 90 } },
    ],
    events: { pitPassages: passages, retirements: [] },
    positionChanges: { rows: { lap: [], winner: [], loser: [], mechanism: [] }, lapDowns },
    ...extra,
  }) as unknown as RaceAnalysisPackage;

describe("lapLossFacts", () => {
  it("splits the laps lost by how they went: stops, garage, caution stops, on track", () => {
    const P = pkg(
      { car: ["2", "2", "2", "2"], lap: [10, 30, 50, 80], lapsDown: [1, 2, 8, 10], cause: ["on_track", "pit", "pit", "fcy_pit"] },
      [
        { car: "2", inLap: 30, outLap: 31, kind: "stop" },
        { car: "2", inLap: 48, outLap: 55, kind: "garage" },
        { car: "2", inLap: 80, outLap: 81, kind: "stop" },
      ],
    );
    const l = lapLossFacts(P).get("2")!;
    expect(l).toMatchObject({ lapsLost: 10, onTrack: 1, inPitStops: 1, inGarage: 6, underCaution: 2, notExplained: 0, onTrackFirstLap: 10, onTrackLastLap: 10 });
    expect(l).toMatchObject({ biggestLap: 48, biggestLaps: 6, biggestCause: "garage", finishLapsDown: 10 });
  });
  it("adds up the laps lost over one garage visit", () => {
    const P = pkg({ car: ["2", "2"], lap: [50, 51], lapsDown: [1, 5], cause: ["pit", "pit"] }, [{ car: "2", inLap: 49, outLap: 52, kind: "garage" }]);
    expect(lapLossFacts(P).get("2")).toMatchObject({ lapsLost: 5, inGarage: 5, biggestLap: 49, biggestLaps: 5, biggestCause: "garage" });
  });
  it("counts each confirmed lap-down as at least a lap, and keeps unknown causes apart", () => {
    // Laps won back between the events: the later event still lost a lap.
    const l = lapLossFacts(pkg({ car: ["2", "2"], lap: [10, 40], lapsDown: [1, 1], cause: ["on_track", "unknown"] })).get("2")!;
    expect(l).toMatchObject({ lapsLost: 2, onTrack: 1, notExplained: 1 });
  });
  it("has no finish gap for a car that retired, and nothing for cars that lost no laps", () => {
    const P = pkg({ car: ["2"], lap: [10], lapsDown: [1], cause: ["on_track"] }, [], { events: { pitPassages: [], retirements: [{ car: "2" }] } as never });
    expect(lapLossFacts(P).get("2")!.finishLapsDown).toBeNull();
    expect(lapLossFacts(P).has("1")).toBe(false);
  });
});

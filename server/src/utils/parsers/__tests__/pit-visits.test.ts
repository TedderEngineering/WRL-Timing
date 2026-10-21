import { describe, expect, it } from "vitest";
import { generateAnnotations } from "../position-analysis.js";

// Sebring 2026 Sunday #120: the timing flags its first stop under the caution on laps 12 and 13
// (in-lap and the lap after). That is one stop, not two: the race made 6, as its stops show.
function race(pitLaps: number[]) {
  const car = (num: number, pits: number[]) => ({
    num,
    team: `T${num}`,
    cls: "GTO",
    finishPos: num === 120 ? 1 : 2,
    finishPosClass: num === 120 ? 1 : 2,
    laps: Array.from({ length: 40 }, (_, i) => {
      const l = i + 1;
      const pit = pits.includes(l) ? 1 : 0;
      return { l, p: num === 120 ? 1 : 2, cp: num === 120 ? 1 : 2, lt: "", ltSec: pit ? 160 : 100, flag: "GREEN", pit };
    }),
  });
  return { maxLap: 40, totalCars: 2, greenPaceCutoff: 130, cars: { "120": car(120, pitLaps), "119": car(119, [20]) }, fcy: [], classGroups: { GTO: [120, 119] }, classCarCounts: { GTO: 2 } };
}

describe("pit markers", () => {
  it("mark a visit flagged over two laps once, on its in-lap, with its timing", () => {
    const pits = (generateAnnotations(race([12, 13, 33]) as any) as any)["120"].pits;
    expect(pits.map((p: any) => [p.l, p.lb])).toEqual([
      [12, "Pit 1"],
      [33, "Pit 2"],
    ]);
    expect(pits[0].pitTiming).toBeTruthy();
  });
});

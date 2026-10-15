import { describe, expect, it } from "vitest";
import { applyPitFacts, extractPitFacts, matchCars } from "../pit-facts.js";
import { carFacts } from "../../dashboard/my-car.js";

// Three GTU cars over 6 laps. The import put #1's stop on lap 4 (a phantom on lap 2 as well);
// the package has it on lap 3, in class pit cycle 1 with #2, and #1 drops P1 → P2 in class.
const lap = (l: number, p: number, cp: number, pit = 0) => ({ l, p, cp, lt: "1:40.000", ltSec: 100, flag: "GREEN", pit });
function chart() {
  return {
    maxLap: 6,
    totalCars: 4,
    greenPaceCutoff: 0,
    fcy: [[2, 2]] as [number, number][],
    classGroups: { GTU: [1, 2, 3], GP1: [4] },
    classCarCounts: { GTU: 3, GP1: 1 },
    cars: {
      "1": { num: 1, team: "Alpha", cls: "GTU", finishPos: 2, finishPosClass: 2, laps: [lap(1, 1, 1), lap(2, 1, 1, 1), lap(3, 1, 1), lap(4, 2, 2, 1), lap(5, 2, 2), lap(6, 2, 2)] },
      "2": { num: 2, team: "Bravo", cls: "GTU", finishPos: 1, finishPosClass: 1, laps: [lap(1, 2, 2), lap(2, 2, 2), lap(3, 2, 2, 1), lap(4, 1, 1), lap(5, 1, 1), lap(6, 1, 1)] },
      "3": { num: 3, team: "Charlie", cls: "GTU", finishPos: 3, finishPosClass: 3, laps: [1, 2, 3, 4, 5, 6].map((l) => lap(l, 3, 3)) },
      "4": { num: 4, team: "Delta Racing", cls: "GP1", finishPos: 4, finishPosClass: 1, laps: [1, 2, 3, 4, 5, 6].map((l) => lap(l, 4, 1)) },
    },
  };
}
const annotations = () => ({
  "1": {
    reasons: { "2": "Pit stop — Lost 1 in pit cycle" },
    pits: [
      { l: 2, lb: "Pit 1", c: "#fbbf24", yo: 0, da: 0, pitTiming: { totalPitLoss: 300, isDriveThrough: false } },
      { l: 4, lb: "Pit 2 · SMITH", c: "#fbbf24", yo: 0, da: 0, outDriver: "Smith", inDriver: "Jones", driverChanged: true },
    ],
    settles: [{ l: 5, p: 2, lb: "Settled P2", su: "Was P1 · Lost 1", c: "#f87171" }],
  },
});

const cols = (pos: number[], cpos: number[], pit: number[], fcy = [0, 0, 0, 0, 0, 0]) => ({
  lap: [1, 2, 3, 4, 5, 6],
  lapTimeS: [100, 100, 130, 125, 100, 100],
  endS: [100, 200, 330, 455, 555, 655],
  pos,
  cpos,
  pit,
  fcy,
});
function pkg() {
  return {
    packageId: "pkg-1",
    engineVersion: "2.1.0",
    entries: [
      { car: "1", class: "GTU", team: "Alpha" },
      { car: "2", class: "GTU", team: "Bravo" },
      { car: "3", class: "GTU", team: "Charlie" },
      { car: "4", class: "GP1", team: "Echo" },
      { car: "4A", class: "GP1", team: "Delta Racing" },
    ],
    fcyPeriods: [{ id: "fcy:1", leaderLaps: [5, 5] }],
    laps: {
      cars: {
        "1": cols([1, 1, 2, 2, 2, 2], [1, 1, 2, 2, 2, 2], [0, 0, 1, 2, 0, 0], [0, 0, 0, 0, 2, 0]),
        "2": cols([2, 2, 1, 1, 1, 1], [2, 2, 1, 1, 1, 1], [0, 0, 1, 2, 0, 0]),
        "3": cols([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 3], [0, 0, 0, 0, 0, 0]),
        "4": cols([4, 4, 4, 4, 4, 4], [1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0]),
        "4A": cols([5, 5, 5, 5, 5, 5], [2, 2, 2, 2, 2, 2], [0, 0, 0, 0, 0, 0]),
      },
    },
    events: {
      pitPassages: [
        { id: "pit:1:1", car: "1", kind: "stop", inLap: 3, outLap: 4, stopNumber: 1, officialPitLaneTimeS: null, fcyContext: "green", timeLost: { valueS: 55.5, method: "green_reference", refLapS: 100 }, cycleId: "cycle:GTU:1" },
        { id: "pit:2:1", car: "2", kind: "stop", inLap: 3, outLap: 4, stopNumber: 1, officialPitLaneTimeS: 40.2, fcyContext: "fcy", timeLost: { valueS: -4, method: "fcy_neighbours" }, cycleId: "cycle:GTU:1" },
        { id: "pit:3:1", car: "3", kind: "drive_through", inLap: 5, outLap: 6, stopNumber: null, officialPitLaneTimeS: null, fcyContext: "green", timeLost: { valueS: 20, method: "green_reference", refLapS: 100 }, cycleId: null },
      ],
      pitGroups: [],
    },
    pitCycles: [{ id: "cycle:GTU:1", class: "GTU", ordinal: 1, members: [{ car: "1", passageId: "pit:1:1" }, { car: "2", passageId: "pit:2:1" }] }],
    cycleResults: [
      { cycleId: "cycle:GTU:1", car: "1", passageId: "pit:1:1", beforeLap: 2, afterLap: 4, classPosBefore: 1, classPosAfter: 2, netClass: -1, overallPosBefore: 1, overallPosAfter: 2 },
      { cycleId: "cycle:GTU:1", car: "2", passageId: "pit:2:1", beforeLap: 2, afterLap: 4, classPosBefore: 2, classPosAfter: 1, netClass: 1, overallPosBefore: 2, overallPosAfter: 1 },
    ],
    positionChanges: { rows: { lap: [3], winner: ["2"], loser: ["1"], mechanism: ["both_pitted"] } },
  };
}

describe("pit facts from the analysis package", () => {
  const facts = extractPitFacts(pkg());

  it("matches package cars to chart cars, and leaves a number two cars share to the one that is plainly it", () => {
    const m = matchCars(chart() as any, facts);
    expect([...m]).toEqual([["1", "1"], ["2", "2"], ["3", "3"], ["4A", "4"]]);
  });

  it("replaces the import's pit markers with one per passage at its in-lap, keeping driver names", () => {
    const out = applyPitFacts(chart() as any, annotations() as any, facts);
    const pits = out.annotations["1"].pits as any[];
    expect(pits.map((p) => p.l)).toEqual([3]);
    expect(pits[0]).toMatchObject({ lb: "Pit 1", kind: "stop", alsoPittingCars: [2], cycle: { id: "cycle:GTU:1", ordinal: 1, cls: "GTU" } });
    expect(pits[0].pitTiming).toMatchObject({ totalPitLoss: 55.5, context: "green", lossMethod: "green_reference", avgGreenLapTime: 100, isDriveThrough: false, inLapTime: 130, outLapTime: 125 });
    expect(out.annotations["3"].pits[0]).toMatchObject({ l: 5, lb: "Drive-through", kind: "drive_through" });
    expect((out.annotations["3"].pits[0] as any).pitTiming.isDriveThrough).toBe(true);
  });

  it("takes laps, caution bands and pit flags from the package", () => {
    const out = applyPitFacts(chart() as any, annotations() as any, facts);
    expect(out.data.fcy).toEqual([[5, 5]]);
    expect(out.data.cars["1"].laps.map((l) => l.pit)).toEqual([0, 0, 1, 0, 0, 0]);
    expect(out.data.cars["1"].laps.map((l) => l.flag)).toEqual(["GF", "GF", "GF", "GF", "FCY", "GF"]);
    // Car 4 on the chart is the package's 4A: its positions come from 4A.
    expect(out.data.cars["4"].laps[0].p).toBe(5);
  });

  it("settles carry the class positions before the stop and when the cycle closed", () => {
    const out = applyPitFacts(chart() as any, annotations() as any, facts);
    expect(out.annotations["1"].settles).toEqual([
      expect.objectContaining({ l: 4, p: 2, cpBefore: 1, cpAfter: 2, su: "Was P1 · Lost 1", stopLap: 3 }),
    ]);
    expect(out.annotations["1"].reasons["3"]).toBe(
      "Pit 1 — P1 in class before; P2 when the cycle closed on lap 4. Lost 1 in class — passed by #2 Bravo in the pit cycle"
    );
    expect(out.annotations["1"].reasons["2"]).toBeUndefined();
  });

  it("Your car counts pit cycles in class and ranks only green stops", () => {
    const out = applyPitFacts(chart() as any, annotations() as any, facts);
    const f = carFacts(out.data as any, out.annotations as any, "1")!;
    expect(f.pitCycles).toEqual([{ cycle: 1, lap: 4, before: 1, after: 2, net: -1 }]);
    // #2's stop was under a caution, so there is no field of three green stops to rank against.
    expect(f.benchmarks.filter((b) => b.startsWith("Pit loss"))).toEqual([]);
  });

  it("does not touch the inputs", () => {
    const c = chart();
    const a = annotations();
    const before = JSON.stringify([c, a]);
    applyPitFacts(c as any, a as any, facts);
    expect(JSON.stringify([c, a])).toBe(before);
  });
});

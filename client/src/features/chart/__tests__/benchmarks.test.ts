import { describe, expect, it } from "vitest";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { classBenchmarks, lapsAt, ordinal } from "../benchmarks";

const lap = (l: number, p: number, cp: number, ltSec: number, pit = 0) => ({ l, p, cp, lt: "", ltSec, flag: "GF", pit });
const car = (num: number, cls: string, laps: ReturnType<typeof lap>[]) => ({ num, team: `T${num}`, cls, finishPos: num, finishPosClass: num, laps });
const timing = (loss: number, driveThrough = false) => ({ pitInTime: null, pitRoadTime: null, pitOutTime: null, isDriveThrough: driveThrough, totalPitLoss: loss } as any);
const pit = (l: number, loss: number, dt = false) => ({ l, lb: "Pit", c: "#fff", yo: 0, da: 0, pitTiming: timing(loss, dt) });

// Four GS cars (one TCR car that must not count). #1 has the quickest stop and the 2nd best lap.
const data = {
  maxLap: 4, totalCars: 5, greenPaceCutoff: 200, fcy: [],
  cars: {
    "1": car(1, "GS", [lap(1, 3, 3, 100.5), lap(2, 3, 3, 130, 1), lap(3, 1, 1, 101), lap(4, 1, 1, 101)]),
    "2": car(2, "GS", [lap(1, 1, 1, 100.0), lap(2, 1, 1, 100.2), lap(3, 2, 2, 135, 1), lap(4, 2, 2, 101)]),
    "3": car(3, "GS", [lap(1, 2, 2, 101.0), lap(2, 2, 2, 140, 1), lap(3, 3, 3, 101), lap(4, 3, 3, 101)]),
    "4": car(4, "GS", [lap(1, 4, 4, 102.0), lap(2, 4, 4, 103), lap(3, 4, 4, 150, 1), lap(4, 4, 4, 103)]),
    "9": car(9, "TCR", [lap(1, 5, 1, 90), lap(2, 5, 1, 90), lap(3, 5, 1, 90, 1), lap(4, 5, 1, 90)]),
  },
  classGroups: { GS: [1, 2, 3, 4], TCR: [9] },
  classCarCounts: { GS: 4, TCR: 1 },
} as unknown as RaceChartData;
const ann = {
  "1": { reasons: {}, pits: [pit(2, 30.1)], settles: [{ l: 3, p: 1, lb: "Settled P1", su: "Was P3 · Gained 2", c: "" }] },
  "2": { reasons: {}, pits: [pit(3, 33.0)], settles: [] },
  "3": { reasons: {}, pits: [pit(2, 38.0)], settles: [] },
  "4": { reasons: {}, pits: [pit(3, 49.0)], settles: [] },
  "9": { reasons: {}, pits: [pit(3, 10.0)], settles: [] },
} as unknown as AnnotationData;

describe("class benchmarks", () => {
  it("states the top-three facts for the car's class only", () => {
    expect(classBenchmarks(data, ann, 1).map((b) => b.text)).toEqual([
      "Pit loss 1st of 4 in GS's 1st stops",
      "Fastest lap 2nd of 4 in GS",
      "Gained 2 places over 1 pit cycle in GS",
    ]);
  });

  it("says when: the stop's lap, the best lap's, the laps the cycles settled on", () => {
    expect(classBenchmarks(data, ann, 1).map((b) => b.at)).toEqual(["lap 2", "lap 1", "lap 3"]);
  });

  it("gives a weak result no badge", () => {
    // #4: slowest stop and slowest lap in GS, no pit-cycle gain: nothing at all.
    expect(classBenchmarks(data, ann, 4)).toEqual([]);
  });

  it("leaves a drive-through out of the pit-loss ranking", () => {
    const dt = { ...ann, "1": { ...ann["1"], pits: [pit(2, 30.1, true)] } } as AnnotationData;
    expect(classBenchmarks(data, dt, 1).some((b) => b.kind === "pit_loss")).toBe(false);
  });

  it("works without annotations (fastest lap only)", () => {
    expect(classBenchmarks(data, null, 2).map((b) => b.text)).toEqual(["Fastest lap 1st of 4 in GS"]);
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});

describe("benchmarks from the analysis package's pit facts", () => {
  // Same race, now with class pit cycles: #1 and #3 in GS cycle 1, #2 and #4 in GS cycle 2 (a
  // second cycle ten laps later in a real race). #4 stopped under a caution.
  const withCycle = (a: any, id: string, ordinal: number, context = "green") => ({
    ...a,
    pits: a.pits.map((p: any) => ({ ...p, cycle: { id, ordinal, cls: "GS" }, pitTiming: { ...p.pitTiming, context } })),
    settles: a.settles.map((s: any) => ({ ...s, cpBefore: 3, cpAfter: 1 })),
  });
  const facts = {
    ...ann,
    "1": withCycle(ann["1"], "c1", 1),
    "2": withCycle(ann["2"], "c2", 2),
    "3": withCycle(ann["3"], "c1", 1),
    "4": withCycle(ann["4"], "c2", 2, "fcy"),
  } as unknown as AnnotationData;

  it("ranks a stop within its class pit cycle, and only green stops", () => {
    // Cycle 1 has two green stops, cycle 2 one: no field of three anywhere.
    expect(classBenchmarks(data, facts, 1).filter((b) => b.kind === "pit_loss")).toEqual([]);
    const three = { ...facts, "2": withCycle(ann["2"], "c1", 1) } as unknown as AnnotationData;
    expect(classBenchmarks(data, three, 1).find((b) => b.kind === "pit_loss")?.text).toBe("Pit loss 1st of 3 in GS pit cycle 1");
  });

  it("counts places gained from the class positions the package gives", () => {
    expect(classBenchmarks(data, facts, 1).find((b) => b.kind === "pit_cycles")?.text).toBe("Gained 2 places over 1 pit cycle in GS");
  });
});

describe("lapsAt", () => {
  it("lists up to three laps, then a range", () => {
    expect(lapsAt([23])).toBe("lap 23");
    expect(lapsAt([71, 23, 47])).toBe("laps 23, 47, 71");
    expect(lapsAt([23, 47, 71, 95, 150])).toBe("laps 23–150");
  });
});

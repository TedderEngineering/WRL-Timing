import { describe, expect, it } from "vitest";
import { carFacts, classPitCycles, extractCarStory, tookFlag } from "../my-car.js";

// Two GS cars and one TCR car over 6 laps; #7 pits on lap 3 and settles on lap 5.
const lap = (l: number, p: number, cp: number, ltSec: number, pit = 0, flag = "GF") => ({ l, p, cp, ltSec, pit, flag, lt: "" });
const data = {
  maxLap: 6,
  classCarCounts: { GS: 2, TCR: 1 },
  cars: {
    "7": { num: 7, team: "Blackdog Racing", cls: "GS", vehicle: "Mustang GT4", finishPos: 1, finishPosClass: 1,
      laps: [lap(1, 2, 2, 100), lap(2, 2, 2, 99.5), lap(3, 3, 2, 130, 1), lap(4, 3, 2, 101), lap(5, 1, 1, 99.8), lap(6, 1, 1, 99.9)] },
    "12": { num: 12, team: "Other", cls: "GS", finishPos: 2, finishPosClass: 2,
      laps: [lap(1, 1, 1, 99.0), lap(2, 1, 1, 99.1), lap(3, 1, 1, 99.2), lap(4, 1, 1, 99.3), lap(5, 2, 2, 135, 1), lap(6, 2, 2, 100)] },
    "33": { num: 33, team: "T", cls: "TCR", status: "dsq", finishPos: 98, finishPosClass: 1,
      laps: [lap(1, 3, 1, 105), lap(2, 3, 1, 105), lap(3, 2, 1, 104), lap(4, 2, 1, 104), lap(5, 3, 1, 104), lap(6, 3, 1, 104)] },
  },
};
const ann = { "7": { settles: [{ l: 5, p: 1, su: "Was P2 · Gained 1", lb: "Settled P1", c: "#4ade80" }] } };

describe("your car's race facts", () => {
  it("states the finish, class size, laps, best green lap and the settled pit cycle in class", () => {
    const f = carFacts(data as any, ann as any, "007")!;
    expect(f).toMatchObject({ carKey: "7", number: "7", cls: "GS", finishClass: 1, finishOverall: 1, classSize: 2, laps: 6, raceLaps: 6, vehicle: "Mustang GT4" });
    // Best green lap 99.5 on lap 2 (the 130 s in-lap does not count); 12's best is 99.0, so 2nd in GS.
    expect(f.bestLap).toEqual({ sec: 99.5, lap: 2 });
    expect(f.bestLapClassRank).toBe(2);
    expect(f.pitCycles).toEqual([{ cycle: 1, lap: 5, before: 2, after: 1, net: 1 }]);
    // Only two GS cars: too few to rank, so the class benchmarks are the pit-cycle gain alone.
    expect(f.benchmarks).toEqual(["Gained 1 place over 1 pit cycle in GS"]);
  });

  it("states pit-loss and fastest-lap ranks in the class top three, never a weak one", () => {
    const big = structuredClone(data) as any;
    const pits = (loss: number, l = 3) => ({ pits: [{ l, pitTiming: { totalPitLoss: loss, isDriveThrough: false } }], settles: [] as any[] });
    big.cars["20"] = { ...big.cars["12"], num: 20, laps: [lap(1, 4, 3, 98.0), lap(2, 4, 3, 99), lap(3, 4, 3, 140, 1)] };
    big.cars["21"] = { ...big.cars["12"], num: 21, laps: [lap(1, 5, 4, 103), lap(2, 5, 4, 104), lap(3, 5, 4, 150, 1)] };
    const a: any = { "7": { ...pits(31), settles: ann["7"].settles }, "12": pits(35, 5), "20": pits(40), "21": pits(50) };
    expect(carFacts(big, a, "7")!.benchmarks).toEqual([
      "Pit loss 1st of 4 in GS's 1st stops",
      "Fastest lap 3rd of 4 in GS",
      "Gained 1 place over 1 pit cycle in GS",
    ]);
    expect(carFacts(big, a, "21")!.benchmarks).toEqual([]);
  });

  it("gives no position to a disqualified car", () => {
    const f = carFacts(data as any, null, "33")!;
    expect(f.finishClass).toBeNull();
    expect(f.finishOverall).toBeNull();
    expect(f.status).toBe("dsq");
  });

  it("never badges a fastest lap outside the class's top three", () => {
    const many = structuredClone(data) as any;
    for (const n of ["1", "2", "3"]) many.cars[n] = { ...many.cars["12"], num: Number(n), laps: [lap(1, 4, 3, 90)] };
    expect(carFacts(many, null, "7")!.bestLapClassRank).toBeNull();
  });

  it("is null for a car not in the race", () => {
    expect(carFacts(data as any, null, "99")).toBeNull();
  });

  it("skips a settle it cannot place in class", () => {
    expect(classPitCycles(data.cars["7"].laps, [{ l: 5, p: 1, su: "no baseline" }])).toEqual([]);
  });
});

describe("the car's story from a package", () => {
  it("takes the car's headline and paragraphs with the entity lookups", () => {
    const pkg = {
      entries: [{ car: "7", team: "Blackdog Racing", make: "Ford", drivers: [{ name: "A B", number: 1 }] }],
      metadata: { classes: [{ id: "GS", name: "GS" }] },
      carStories: [{ car: "7", headline: { text: "{car:7} finished {0}.", refs: [] }, paragraphs: [{ text: "x", refs: [] }] }],
    };
    const s = extractCarStory(pkg, "007")!;
    expect(s.headline.text).toBe("{car:7} finished {0}.");
    expect(s.paragraphs).toHaveLength(1);
    expect(s.cars["7"]).toMatchObject({ team: "Blackdog Racing", make: "Ford", drivers: ["A B"] });
    expect(s.classes).toEqual({ GS: "GS" });
    expect(extractCarStory(pkg, "8")).toBeNull();
  });
});

describe("tookFlag", () => {
  const lap = (l: number, t = 100) => ({ l, p: 1, cp: 1, ltSec: t, pit: 0 });
  const car = (n: number, laps: number, t = 100, status?: string) => ({ num: n, team: "T", cls: "Am", status, finishPos: n, finishPosClass: n, laps: Array.from({ length: laps }, (_, i) => lap(i + 1, t)) });
  const data = { maxLap: 23, cars: { "1": car(1, 23), "2": car(2, 22, 106), "21": car(21, 16) } } as never;
  it("is true for the full distance and for a lapped car still running at the flag, false for a car that stopped early", () => {
    const cars = (data as { cars: Record<string, never> }).cars;
    expect(tookFlag(data, cars["1"], null)).toBe(true);
    expect(tookFlag(data, cars["2"], null)).toBe(true);
    expect(tookFlag(data, cars["21"], "classified")).toBe(false);
    expect(tookFlag(data, cars["1"], "dnf")).toBe(false);
  });
});

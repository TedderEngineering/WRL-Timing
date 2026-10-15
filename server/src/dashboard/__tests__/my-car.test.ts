import { describe, expect, it } from "vitest";
import { carFacts, classPitCycles, extractCarStory } from "../my-car.js";

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

import { describe, expect, it, vi } from "vitest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));

import { driverFacts, stintsOf } from "../my-driver.js";
import { bestSpelling, coDrivers, driverInNames, sameDriver } from "../../services/my-drivers.js";

const laps = (n: number, sec: (l: number) => number, pits: number[] = [], fcy: number[] = []) =>
  Array.from({ length: n }, (_, i) => {
    const l = i + 1;
    return { l, ltSec: sec(l), pit: pits.includes(l) ? 1 : 0, flag: fcy.includes(l) ? "FCY" : "GF" };
  });

describe("sameDriver", () => {
  it("ignores case, accents and word order, and allows a middle name or initial", () => {
    expect(sameDriver("Marvin Kirchhöfer", "KIRCHHOFER Marvin")).toBe(true);
    expect(sameDriver("Alex Rivera", "Alex J. Rivera")).toBe(true);
    expect(sameDriver("Alex Rivera", "Alexander Rivera")).toBe(false);
    expect(sameDriver("Rivera", "Alex Rivera")).toBe(false); // one word is too little to go on
  });

  it("finds the driver in an entry's names and lists the others", () => {
    expect(driverInNames("Jamie Cole; RIVERA Alex", "Alex Rivera")).toBe("RIVERA Alex");
    expect(driverInNames("Jamie Cole", "Alex Rivera")).toBeNull();
    expect(coDrivers("Jamie Cole; RIVERA Alex; CHRIS PARK", "Alex Rivera")).toEqual(["Jamie Cole", "Chris Park"]);
  });

  it("shows the spelling seen most, in mixed case", () => {
    expect(bestSpelling([{ spelledAs: "RIVERA Alex" }, { spelledAs: "Alex Rivera" }, { spelledAs: "Alex Rivera" }], "x")).toBe("Alex Rivera");
    expect(bestSpelling([{ spelledAs: "ALEX RIVERA" }], "x")).toBe("Alex Rivera");
  });
});

describe("driverFacts", () => {
  // 30 laps; stops on 10 and 20; Rivera starts, Cole drives the middle, Rivera finishes.
  const car = { laps: laps(30, (l) => (l === 25 ? 88 : l === 5 ? 89 : 90), [10, 20], [3]) };
  const pits = [
    { l: 10, inDriver: "Alex Rivera", outDriver: "Jamie Cole" },
    { l: 20, inDriver: "Jamie Cole", outDriver: "RIVERA Alex" },
  ];

  it("splits the race into stints by stop, with who drove each", () => {
    expect(stintsOf(car.laps, pits, null)).toEqual([
      { start: 1, end: 10, driver: "Alex Rivera" },
      { start: 11, end: 20, driver: "Jamie Cole" },
      { start: 21, end: 30, driver: "RIVERA Alex" },
    ]);
  });

  it("gives the driver's stints, drive time and best green lap, ranked within the car", () => {
    const f = driverFacts(car, pits, "Alex Rivera", ["Alex Rivera", "Jamie Cole"]);
    expect(f.known).toBe(true);
    expect(f.myStints).toBe(2);
    expect(f.driveTimeS).toBe(20 * 90 - 1 - 2);
    expect(f.carTimeS).toBe(30 * 90 - 1 - 2);
    expect(f.bestLap).toEqual({ sec: 88, lap: 25 });
    expect(f.bestRank).toEqual({ rank: 1, of: 2 });
    expect(driverFacts(car, pits, "Jamie Cole", []).bestRank).toEqual({ rank: 2, of: 2 });
  });

  it("says when the timing doesn't name the drivers, and gives a sole driver every lap", () => {
    const none = driverFacts(car, [{ l: 10 }, { l: 20 }], "Alex Rivera", ["Alex Rivera", "Jamie Cole"]);
    expect(none.known).toBe(false);
    expect(none.bestLap).toBeNull();
    expect(none.driveTimeS).toBe(0);
    const solo = driverFacts(car, [{ l: 10 }], "Alex Rivera", ["Alex Rivera"]);
    expect(solo.known).toBe(true);
    expect(solo.myStints).toBe(2);
    expect(solo.driveTimeS).toBe(solo.carTimeS);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));

import { driverFacts, stintAverage, stintsOf } from "../my-driver.js";
import { bestSpelling, coDrivers, driverInNames, expandDriverName, sameDriver } from "../../services/my-drivers.js";

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

describe("short names in the timing", () => {
  it("become the car's full name when exactly one driver fits", () => {
    const car = ["Kevin Boehm", "Francis Selldorff"];
    expect(expandDriverName("Boehm", car)).toBe("Kevin Boehm");
    expect(expandDriverName("K. Boehm", car)).toBe("Kevin Boehm");
    expect(expandDriverName("BOEHM Kevin", car)).toBe("Kevin Boehm");
    expect(expandDriverName("J. Boehm", car)).toBe("J. Boehm"); // the initial does not fit
    expect(expandDriverName("Smith", ["Ann Smith", "Bo Smith"])).toBe("Smith"); // two fit: kept
  });

  it("let a surname-only pit record count for the followed driver", () => {
    const car = { laps: laps(10, () => 90, [4]) };
    const f = driverFacts(car, [{ l: 4, inDriver: "Selldorff", outDriver: "Boehm" }], "Kevin Boehm", ["Kevin Boehm", "Francis Selldorff"]);
    expect(f.myStints).toBe(1);
    expect(f.stints.map((s) => s.driver)).toEqual(["Francis Selldorff", "Kevin Boehm"]);
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

describe("stint averages", () => {
  it("average each stint's green laps: no pit lap, out-lap, caution lap or lap far over pace", () => {
    // Laps 1-10: 90 s, lap 3 under caution (120), lap 10 the pit lap (150); lap 11 the out-lap (130),
    // lap 15 a slow lap (200, over 1.25 x the median), the rest 92 s.
    const ls = laps(20, (l) => (l === 3 ? 120 : l === 10 ? 150 : l === 11 ? 130 : l === 15 ? 200 : l <= 10 ? 90 : 92), [10], [3]);
    const avg = stintAverage(ls);
    expect(avg({ start: 1, end: 10 })).toEqual({ avgLapS: 90, avgLaps: 8 });
    expect(avg({ start: 11, end: 20 })).toEqual({ avgLapS: 92, avgLaps: 8 });
  });

  it("are on every stint of the driver's facts", () => {
    const car = { laps: laps(20, (l) => (l <= 10 ? 90 : 92), [10]) };
    const f = driverFacts(car, [{ l: 10, inDriver: "Alex Rivera", outDriver: "Jamie Cole" }], "Jamie Cole", ["Alex Rivera", "Jamie Cole"]);
    expect(f.stints.map((s) => s.avgLapS)).toEqual([90, 92]);
  });
});

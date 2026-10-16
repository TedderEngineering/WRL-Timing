import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { MyDriverCard, type MyDriverResponse } from "../MyDriverCard";
import { driveOf, driveTimeText, stintsOf } from "../../my-drivers/stints";
import { sameDriver } from "../../my-drivers/api";
import { carDriverNames } from "../../my-drivers/CarDrivers";

const text = (node: React.ReactNode) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const base: MyDriverResponse = {
  driverCount: 2,
  driver: { id: "d1", name: "Alex Rivera" },
  drivers: [
    { id: "d1", name: "Alex Rivera" },
    { id: "d2", name: "Sam Okafor" },
  ],
  race: { id: "plm", name: "Petit Le Mans", date: "2026-10-10", track: "Road Atlanta", series: "IMSA", resultsStatus: "official", locked: false, lockReason: null },
  car: { number: "7", team: "Example Racing", cls: "GTP", coDrivers: ["Jamie Cole", "Chris Park"] },
  facts: {
    number: "7", team: "Example Racing", cls: "GTP", vehicle: null, finishClass: 1, finishOverall: 1, classSize: 9, status: null,
    laps: 30, raceLaps: 30, bestLap: { sec: 70.881, lap: 25 }, bestLapClassRank: 1, pitCycles: [],
  },
  driverFacts: {
    known: true,
    stints: [
      { start: 1, end: 10, driver: "Alex Rivera", mine: true },
      { start: 11, end: 20, driver: "JAMIE COLE", mine: false },
      { start: 21, end: 30, driver: "Alex Rivera", mine: true },
    ],
    myStints: 2,
    driveTimeS: 13320,
    carTimeS: 36000,
    bestLap: { sec: 70.881, lap: 25 },
    bestRank: { rank: 1, of: 2 },
  },
  story: null,
  recent: [
    { raceId: "plm", raceName: "Petit Le Mans", date: "2026-10-10", track: "Road Atlanta", series: "IMSA", subSeries: null, carNumber: "7", carClass: "GTP", finishPos: 1, finishPosClass: 1 },
    { raceId: "indy", raceName: "Indianapolis 8 Hour", date: "2026-09-27", track: "IMS", series: "SRO", subSeries: null, carNumber: "23", carClass: "GT3", finishPos: 9, finishPosClass: 4 },
  ],
  totals: { races: 2, series: ["IMSA", "SRO"] },
};

describe("MyDriverCard", () => {
  it("shows the car the driver raced, the result and the driver's own drive", () => {
    const t = text(<MyDriverCard data={base} />);
    expect(t).toContain("Alex Rivera");
    expect(t).toContain("#7 Example Racing · GTP");
    expect(t).toContain("with Jamie Cole and Chris Park");
    expect(t).toContain("Finished P1 in GTP of 9 · P1 overall · 30 of 30 laps");
    expect(t).toContain("3:42 h");
    expect(t).toContain("drive time · 37%");
    expect(t).toContain("laps 1–10, 21–30");
    expect(t).toContain("1:10.881");
    expect(t).toContain("quickest of 2");
    expect(t).toContain("Jamie Cole"); // the legend, display-cased
    expect(t).toContain("Alex's recent races");
    expect(t).toContain("Indianapolis 8 Hour");
  });

  it("says so when the timing doesn't name who drove when", () => {
    const t = text(<MyDriverCard data={{ ...base, driverFacts: { ...base.driverFacts!, known: false, myStints: 0, stints: [], bestLap: null, bestRank: null } }} />);
    expect(t).toContain("This race's timing doesn't say who drove when, so the numbers here are the car's.");
    expect(t).toContain("Car's best lap 1:10.881 on lap 25");
  });
});

describe("who drove when", () => {
  const laps = Array.from({ length: 12 }, (_, i) => ({ l: i + 1, ltSec: i === 9 ? 95 : 100, pit: i === 5 ? 1 : 0, flag: "GF" }));
  it("splits stints at stops and adds up one driver's part", () => {
    const st = stintsOf(laps, [{ l: 6, inDriver: "A Driver", outDriver: "Bea Second" }], null);
    expect(st).toEqual([
      { start: 1, end: 6, driver: "A Driver" },
      { start: 7, end: 12, driver: "Bea Second" },
    ]);
    expect(driveOf(laps, st, "SECOND Bea")).toEqual({ stints: 1, driveTimeS: 595, best: { sec: 95, lap: 10 } });
    expect(driveOf(laps, stintsOf(laps, [{ l: 6 }], null), "Bea Second")).toBeNull();
    expect(driveTimeText(13320)).toBe("3:42 h");
    expect(driveTimeText(2900)).toBe("48 min");
  });

  it("reads the car's drivers from the list or from 'Team (A / B)'", () => {
    expect(carDriverNames({ team: "BSI Racing (Weisenberg / Goodman)" })).toEqual(["Weisenberg", "Goodman"]);
    expect(carDriverNames({ team: "X", drivers: ["Alex Rivera", "RIVERA Alex", "Jamie Cole"] })).toEqual(["Alex Rivera", "Jamie Cole"]);
    expect(sameDriver("Marvin Kirchhöfer", "KIRCHHOFER Marvin")).toBe(true);
  });
});

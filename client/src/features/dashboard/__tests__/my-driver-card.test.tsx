import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { MyDriverCard, type MyDriverResponse } from "../MyDriverCard";
import { driveOf, driveTimeText, stintsOf } from "../../my-drivers/stints";
import { sameDriver } from "../../my-drivers/api";
import { carDriverNames } from "../../my-drivers/CarDrivers";
import { chartCarKey, driverCardBanner, driverCardFact, driverCardPills, driverCardLines, driverShareUrl, lapOwners, ShareRaceDriverCard } from "../../my-drivers/driverCard";
import { formatDuration } from "../../../lib/prose";

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
    expect(t).not.toContain("quickest of");
    expect(t).toContain("Jamie Cole"); // the legend, display-cased
    expect(t).toContain("Alex's races");
    expect(t).toContain("Indianapolis 8 Hour");
  });

  it("lets any of the driver's races be picked, and an earlier one goes back to the latest", () => {
    const pick = () => undefined;
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MyDriverCard data={base} onPickRace={pick} />
      </MemoryRouter>
    );
    expect(html).toContain("Pick a race to see it above and share its card.");
    // Both races are buttons; the one shown is marked.
    expect(html.match(/<button[^>]*aria-current="true"[^>]*>.*?Petit Le Mans/s)).not.toBeNull();
    expect(html.match(/<button[^>]*>(?:(?!<\/button>).)*Indianapolis 8 Hour/s)).not.toBeNull();
    expect(text(<MyDriverCard data={base} onPickRace={pick} />)).not.toContain("Latest race");

    const earlier = { ...base, isLatest: false, race: { ...base.race!, id: "indy", name: "Indianapolis 8 Hour", date: "2026-09-27" } };
    const t = text(<MyDriverCard data={earlier} onPickRace={pick} />);
    expect(t).toContain("← Latest race");
    expect(t).toContain("Indianapolis 8 Hour · Sep 27");
  });

  it("lists the first five races, the rest behind More races, with the year for another season", () => {
    const recent = Array.from({ length: 8 }, (_, i) => ({
      ...base.recent![1], raceId: `r${i}`, raceName: `Race ${i}`, date: i < 7 ? `${new Date().getFullYear()}-0${9 - Math.floor(i / 2)}-1${i}` : "2025-11-02",
    }));
    const t = text(<MyDriverCard data={{ ...base, recent, totals: { races: 8, series: ["SRO"] } }} onPickRace={() => undefined} />);
    expect(t).toContain("Race 4");
    expect(t).not.toContain("Race 5");
    expect(t).toContain("More races (3)");
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

describe("driver card share image", () => {
  const input = { driverName: "Alex Rivera", race: base.race!, car: base.car!, facts: base.facts!, drive: base.driverFacts! };

  it("puts the driver's top highlight on the card when the server ranks them", () => {
    expect(driverCardFact({ ...input, highlights: [{ text: "Brought #7 home to the GTP win" }] })).toEqual({ text: "Brought #7 home to the GTP win", tone: "good" });
  });

  it("leads with the car's podium as a banner and shows up to two of the driver's highlights", () => {
    const won = { ...input, facts: { ...input.facts, finishClass: 1, highlights: [{ kind: "result", text: "Won GTP", score: 100 }] } as any };
    expect(driverCardBanner(won)).toEqual({ text: "#7 won GTP", place: 1 });
    expect(driverCardBanner({ ...input, facts: { ...input.facts, highlights: [] } as any })).toBeNull();
    const three = [{ kind: "brought_home", text: "Brought #7 home to the GTP win" }, { kind: "driver_laps_led", text: "Led the race for 8 laps" }, { kind: "longest_stint", text: "Longest stint" }];
    // Under the banner, "brought home" repeats it.
    expect(driverCardPills({ ...won, highlights: three }, null)).toEqual(["Led the race for 8 laps", "Longest stint"]);
    expect(driverCardPills({ ...won, highlights: three.slice(0, 2) }, null)).toEqual(["Led the race for 8 laps"]);
    expect(driverCardPills({ ...won, highlights: three.slice(0, 1) }, null)).toEqual([]);
    expect(driverCardPills({ ...input, facts: { ...input.facts, highlights: [] } as any, highlights: three }, null)).toEqual(three.slice(0, 2).map((h) => h.text));
  });

  it("offers each driver's card on the race page", () => {
    const t = text(<ShareRaceDriverCard raceId="plm" carNumber="7" driver="Jamie Cole" />);
    expect(t).toMatch(/(Share|Copy) Jamie's card/);
  });

  it("puts a share button on the card", () => {
    const t = text(<MyDriverCard data={base} />);
    expect(t).toMatch(/(Share|Copy) Alex's race card/);
  });

  it("says the finish and the driver's drive under the trace", () => {
    expect(driverCardLines(input)).toEqual(["Finished P1 in GTP of 9 · P1 overall · 30 laps", "Alex: 3:42 h (37%) · 2 stints · best lap 1:10.881"]);
  });

  it("adds the driver's stint averages, one line per stint up to three", () => {
    const drive = {
      ...input.drive,
      stints: input.drive.stints.map((s: any, i: number) => ({ ...s, avgLapS: s.mine ? 71.5 + i : null, avgLaps: 5 })),
    };
    const lines = driverCardLines({ ...input, drive });
    const mine = drive.stints.filter((s: any) => s.mine);
    expect(lines.slice(2)).toEqual(mine.map((s: any) => `Laps ${s.start}–${s.end} · stint avg ${formatDuration(s.avgLapS)}`));
  });

  it("falls back to the car's best lap when the timing doesn't say who drove", () => {
    const lines = driverCardLines({ ...input, drive: { ...input.drive, known: false, myStints: 0 } });
    expect(lines[1]).toBe("Car's best lap 1:10.881 on lap 25");
  });

  // Alex drives laps 1-10 and 21-30; Jamie 11-20. Three GTP cars.
  const lap = (l: number, p: number, cp: number, ltSec: number) => ({ l, p, cp, ltSec, lt: "", flag: "GF", pit: 0 });
  const chartWith = (alex: (l: number) => [number, number, number]) =>
    ({
      maxLap: 30,
      totalCars: 3,
      fcy: [],
      cars: {
        "7": { num: 7, team: "Example Racing", cls: "GTP", laps: Array.from({ length: 30 }, (_, i) => lap(i + 1, ...alex(i + 1))) },
        "8": { num: 8, team: "B", cls: "GTP", laps: Array.from({ length: 30 }, (_, i) => lap(i + 1, 1, 1, 71.2)) },
        "9": { num: 9, team: "C", cls: "GTP", laps: Array.from({ length: 30 }, (_, i) => lap(i + 1, 3, 3, 70.5)) },
      },
    }) as unknown as Parameters<typeof chartCarKey>[0];

  it("never compares the driver with the co-drivers", () => {
    const chart = chartWith((l) => [2, 2, l === 25 ? 70.881 : 72]);
    const f = driverCardFact(input, chart, "7");
    expect(f?.text ?? "").not.toMatch(/drivers|co-driver|Jamie|Chris/);
  });

  it("names laps led while the driver was at the wheel, overall first", () => {
    // Jamie led overall on laps 11-20; Alex led overall on 21-23 and the class on 24-26.
    const chart = chartWith((l) => (l >= 11 && l <= 20 ? [1, 1, 72] : l >= 21 && l <= 23 ? [1, 1, 72] : l <= 26 && l >= 24 ? [2, 1, 72] : [2, 2, 72]));
    expect(driverCardFact(input, chart, "7")).toEqual({ text: "Led the race overall for 3 laps", tone: "good" });
    const classOnly = chartWith((l) => (l >= 24 && l <= 26 ? [2, 1, 72] : [2, 2, 72]));
    expect(driverCardFact(input, classOnly, "7")).toEqual({ text: "Led GTP for 3 laps", tone: "good" });
  });

  it("gives the driver's best lap a class rank only when it is the car's best and in the top three", () => {
    const chart = chartWith((l) => [2, 2, l === 25 ? 70.881 : 72]);
    expect(driverCardFact(input, chart, "7")).toEqual({ text: "Best lap 1:10.881, 2nd quickest in GTP", tone: "good" });
    // Jamie's lap 15 was quicker: the car's best is not Alex's, so no class rank for Alex.
    const notMine = chartWith((l) => [2, 2, l === 15 ? 70.1 : l === 25 ? 70.881 : 72]);
    expect(driverCardFact(input, notMine, "7")).toEqual({ text: "Brought #7 home P1 in GTP", tone: "good" });
  });

  it("without the chart, says the driver brought the car home when they drove the last stint", () => {
    expect(driverCardFact(input)).toEqual({ text: "Brought #7 home P1 in GTP", tone: "good" });
    const middle = { ...input.drive, stints: [...input.drive.stints, { start: 31, end: 40, driver: "JAMIE COLE", mine: false }] };
    expect(driverCardFact({ ...input, drive: middle })).toBeUndefined();
  });

  it("never says a car that retired was brought home, even when the results classify it", () => {
    const retired = { ...input, facts: { ...input.facts!, finished: false } };
    expect(driverCardFact(retired)?.text ?? "").not.toMatch(/home/);
  });

  it("a single-driver car shows the drive without a stint count or share", () => {
    const solo = { ...input, car: { ...input.car, coDrivers: [] }, drive: { ...input.drive, stints: input.drive.stints.map((x) => ({ ...x, driver: "ALEX MORGAN", mine: true })) } };
    const lines = driverCardLines(solo);
    expect(lines[1]).not.toMatch(/stint|%/);
    expect(lines[1]).toMatch(/^Alex: /);
  });

  it("colours each lap by who drove it", () => {
    const own = lapOwners(input.drive);
    expect([own(5), own(15), own(25), own(40)]).toEqual([true, false, true, null]);
    expect(lapOwners({ ...input.drive, known: false })(5)).toBeNull();
  });

  it("finds the chart car by its published number", () => {
    const chart = { cars: { "7": { label: undefined }, "1007": { label: "007" } } } as unknown as Parameters<typeof chartCarKey>[0];
    expect(chartCarKey(chart, "007")).toBe("1007");
    expect(chartCarKey(chart, "7")).toBe("7");
    expect(chartCarKey(chart, "8")).toBeNull();
  });

  it("links the shared text to the race page", () => {
    expect(driverShareUrl(input)).toMatch(/\/chart\?race=plm&car=7&from=share$/);
  });
});

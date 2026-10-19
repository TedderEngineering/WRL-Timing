import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { FirstStepsChecklist, MyCarCard, finishLine, pitCycleLine, type MyCarResponse } from "../MyCarCard";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> }).localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const text = (node: React.ReactNode) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const facts: NonNullable<MyCarResponse["facts"]> = {
  number: "68", team: "RAFA Racing Team", cls: "Silver", vehicle: "Toyota GR Supra GT4", finishClass: 2, finishOverall: 5, classSize: 14,
  status: "classified", laps: 34, raceLaps: 34, bestLap: { sec: 88.107, lap: 12 }, bestLapClassRank: 2,
  pitCycles: [{ cycle: 1, lap: 15, before: 5, after: 2, net: 3 }, { cycle: 2, lap: 28, before: 2, after: 3, net: -1 }],
};
const base: MyCarResponse = {
  carCount: 1,
  car: { id: "c1", label: null, number: "68", series: "sro", teamName: "RAFA Racing Team" },
  race: { id: "r1", name: "GT4 America Race 1 — Indianapolis Motor Speedway", date: "2026-10-10", track: "Indianapolis Motor Speedway", series: "SRO", resultsStatus: "official", locked: false, lockReason: null },
  facts,
  story: null,
  viewed: false,
};

describe("your car's latest race", () => {
  it("states the finish, laps, best lap, stops and each pit cycle as facts", () => {
    const t = text(<MyCarCard data={base} />);
    expect(t).toContain("#68 RAFA Racing Team · Silver");
    expect(t).toContain("Finished P2 in Silver of 14 · P5 overall · 34 of 34 laps");
    expect(t).toContain("#68's race");
    expect(t).toContain("1:28.107 best lap, lap 12 · 2nd fastest in Silver");
    // Net over the cycles: +3 then −1.
    expect(t).toContain("+2 places in Silver over 2 pit cycles");
    expect(t).toContain("Pit cycles in Silver");
    expect(t).toContain("P5 → P2 Gained 3");
    expect(t).toContain("P2 → P3 Lost 1");
    // An older server (no stop laps, no drive): the count from the cycles, never "no pit stops".
    expect(t).toContain("2 stops in the pit lane");
    expect(t).toContain("Position Trace →");
    // No chart key from this server: no share.
    expect(t).not.toContain("Share");
  });

  it("names who drove when, with each stint's average, and marks a quick stop on its cycle", () => {
    const data: MyCarResponse = {
      ...base,
      facts: {
        ...facts,
        carKey: "68",
        pitCycles: [{ cycle: 1, lap: 15, before: 5, after: 2, net: 3, stopLap: 13, quickest: { rank: 1, of: 7 } }, { cycle: 2, lap: 28, before: 2, after: 3, net: -1, stopLap: 26, caution: true }],
      },
      drivers: ["Alex Rivera", "Jamie Cole"],
      drive: {
        known: true,
        carTimeS: 3000,
        stints: [
          { start: 1, end: 13, driver: "Alex Rivera", avgLapS: 89.5, avgLaps: 11 },
          { start: 14, end: 26, driver: "JAMIE COLE", avgLapS: 89.9, avgLaps: 11 },
          { start: 27, end: 34, driver: "Alex Rivera", avgLapS: null, avgLaps: 0 },
        ],
        drivers: [
          { name: "Alex Rivera", stints: 2, laps: 21, driveTimeS: 1860, bestLap: null },
          { name: "JAMIE COLE", stints: 1, laps: 13, driveTimeS: 1140, bestLap: null },
        ],
      },
    };
    const t = text(<MyCarCard data={data} />);
    expect(t).toContain("Alex Rivera and Jamie Cole");
    expect(t).toContain("2 stops laps 13, 26");
    expect(t).toContain("Alex Rivera 31 min · 62%");
    expect(t).toContain("Jamie Cole 19 min · 38%");
    expect(t).toContain("laps 1–13 Alex Rivera 1:29.500");
    expect(t).toContain("laps 14–26 Jamie Cole 1:29.900");
    expect(t).toContain("1 · lap 13 P5 → P2 Gained 3 Quickest stop of 7");
    expect(t).toContain("2 · lap 26 · caution");
    // Support is off in tests (no ask), so the share card shows.
    expect(t).toMatch(/(Share|Copy) #68's race card/);
  });

  it("lists the car's top three highlights, best first", () => {
    const highlights = [
      { kind: "result", text: "Won Silver and the race overall", score: 100 },
      { kind: "fewest_stops", text: "1 pit stop, fewest in Silver", score: 55 },
      { kind: "race_pace", text: "2nd-best race pace in Silver", score: 40 },
      { kind: "consistency", text: "Most consistent laps in Silver", score: 12 },
    ];
    const t = text(<MyCarCard data={{ ...base, facts: { ...facts, highlights } }} />);
    expect(t).toContain("✓ Won Silver and the race overall ✓ 1 pit stop, fewest in Silver ✓ 2nd-best race pace in Silver");
    expect(t).not.toContain("Most consistent laps");
  });

  it("lets the car's races be picked, and an earlier one goes back to the latest", () => {
    const recent = ["r1", "r0"].map((id, i) => ({
      raceId: id, raceName: `Race ${i}`, date: "2026-10-0" + (9 - i), track: "T", series: "SRO", subSeries: null, carNumber: "68", carClass: "Silver", finishPos: 5, finishPosClass: 2,
    }));
    const pick = () => undefined;
    const html = renderToStaticMarkup(<MemoryRouter><MyCarCard data={{ ...base, recent, totalRaces: 2 }} onPickRace={pick} /></MemoryRouter>);
    expect(html).toContain("#68&#x27;s races");
    expect(html.match(/<button[^>]*aria-current="true"[^>]*>(?:(?!<\/button>).)*Race 0/s)).not.toBeNull();
    expect(html.match(/<button[^>]*>(?:(?!<\/button>).)*Race 1/s)).not.toBeNull();
    expect(text(<MyCarCard data={{ ...base, recent, isLatest: false }} onPickRace={pick} />)).toContain("← Latest race");
  });

  it("says when the timing doesn't name who drove", () => {
    const t = text(<MyCarCard data={{ ...base, drive: { known: false, stints: [], drivers: [], carTimeS: 0 } }} />);
    expect(t).toContain("This race's timing doesn't say who drove when.");
  });

  it("leads with the package's car story when there is one", () => {
    const t = text(<MyCarCard data={{ ...base, story: { headline: { text: "{car:68} finished second in {class:Silver}.", refs: [] }, paragraphs: [], cars: { "68": { team: "RAFA Racing Team" } }, classes: { Silver: "Silver" } } }} />);
    expect(t).toContain("#68 finished second in Silver.");
  });

  it("says when the car has no race yet, and locks a race the plan does not open", () => {
    expect(text(<MyCarCard data={{ ...base, race: null, facts: null }} />)).toContain("No race for this car on RaceTrace yet.");
    const locked = text(<MyCarCard data={{ ...base, race: { ...base.race!, locked: true, lockReason: "pro_required" }, facts: null }} />);
    expect(locked).toContain("Upgrade to Pro to read this race.");
    expect(locked).not.toContain("Finished");
  });

  it("names a car with no position plainly", () => {
    expect(finishLine({ ...facts, finishClass: null, finishOverall: null, status: "dsq" })).toBe("Disqualified");
    expect(finishLine({ ...facts, finishClass: null, finishOverall: null, status: "dnf" })).toBe("Did not finish");
    expect(finishLine({ ...facts, laps: 16, finished: false })).toBe("Retired after lap 16 · classified P2 in Silver of 14");
    expect(pitCycleLine({ cycle: 1, lap: 9, before: 4, after: 4, net: 0 }, "GS")).toBe("Pit cycle 1 (settled lap 9): P4 → P4 in GS, held position");
    expect(pitCycleLine({ cycle: 2, lap: 30, before: 3, after: 1, net: 2, stopLap: 27 }, "GS")).toBe("Pit cycle 2 (stop on lap 27): P3 → P1 in GS, gained 2");
  });
});

describe("first steps", () => {
  it("shows the next step until each is done", () => {
    const none = text(<FirstStepsChecklist data={{ carCount: 0, car: null, race: null }} />);
    expect(none).toContain("1 of 4 done");
    // No email switch before there is a car to be emailed about.
    expect(none).not.toContain("Turn on");
    expect(none).toContain("Follow your car or a driver");
    // Three ways: find a race and press Follow, add a car by number, find a driver.
    expect(none).toContain("Find a race → Add a car → Find a driver →");
    const followed = text(<FirstStepsChecklist data={base} />);
    expect(followed).toContain("2 of 4 done");
    expect(followed).toContain("Get an email when your car's race is up Turn on");
    expect(text(<FirstStepsChecklist data={{ ...base, viewed: true }} />)).toContain("3 of 4 done");
    expect(text(<FirstStepsChecklist data={{ ...base, viewed: true, alerts: true }} />)).toBe("");
  });

  it("counts a followed driver, and points at the driver's race when there is no car", () => {
    const driver = { driverCount: 1, race: { id: "plm" }, car: { number: "7" }, viewed: false };
    const t = text(<FirstStepsChecklist data={{ carCount: 0, car: null, race: null }} driver={driver} />);
    expect(t).toContain("2 of 4 done");
    expect(t).toContain("Open your driver's latest race");
    expect(t).toContain("Turn on");
    expect(text(<FirstStepsChecklist data={{ carCount: 0, car: null, race: null }} driver={{ ...driver, viewed: true }} />)).toContain("3 of 4 done");
  });

  it("stays hidden once hidden", () => {
    store.set("racetrace.ui.v1", JSON.stringify({ checklistHidden: true }));
    expect(text(<FirstStepsChecklist data={{ carCount: 0, car: null, race: null }} />)).toBe("");
  });
});

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
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

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
  it("states the finish, laps, best lap and each pit cycle as facts", () => {
    const t = text(<MyCarCard data={base} />);
    expect(t).toContain("#68 · RAFA Racing Team");
    expect(t).toContain("Finished P2 in Silver of 14 · P5 overall");
    expect(t).toContain("34 of 34 laps · best lap 1:28.107 on lap 12, 2nd fastest in Silver");
    expect(t).toContain("Pit cycle 1 (settled lap 15): P5 → P2 in Silver, gained 3");
    expect(t).toContain("Pit cycle 2 (settled lap 28): P2 → P3 in Silver, lost 1");
    expect(t).toContain("Position Trace →");
    // No share at the peak moment: it carries the coffee ask (shared Finding Grip rule).
    expect(t).not.toContain("Share");
  });

  it("shows the class benchmarks the server stated", () => {
    const t = text(<MyCarCard data={{ ...base, facts: { ...facts, benchmarks: ["Pit loss 2nd of 14 in Silver's 1st stops", "Fastest lap 2nd of 14 in Silver"] } }} />);
    expect(t).toContain("Pit loss 2nd of 14 in Silver&#x27;s 1st stops");
    expect(t).toContain("Fastest lap 2nd of 14 in Silver");
    // The rank then lives in the benchmark, not repeated on the laps line.
    expect(t).toContain("best lap 1:28.107 on lap 12 ");
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
    expect(pitCycleLine({ cycle: 1, lap: 9, before: 4, after: 4, net: 0 }, "GS")).toBe("Pit cycle 1 (settled lap 9): P4 → P4 in GS, held position");
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
    expect(followed).toContain("Get an email when your car&#x27;s race is up Turn on");
    expect(text(<FirstStepsChecklist data={{ ...base, viewed: true }} />)).toContain("3 of 4 done");
    expect(text(<FirstStepsChecklist data={{ ...base, viewed: true, alerts: true }} />)).toBe("");
  });

  it("counts a followed driver, and points at the driver's race when there is no car", () => {
    const driver = { driverCount: 1, race: { id: "plm" }, car: { number: "7" }, viewed: false };
    const t = text(<FirstStepsChecklist data={{ carCount: 0, car: null, race: null }} driver={driver} />);
    expect(t).toContain("2 of 4 done");
    expect(t).toContain("Open your driver&#x27;s latest race");
    expect(t).toContain("Turn on");
    expect(text(<FirstStepsChecklist data={{ carCount: 0, car: null, race: null }} driver={{ ...driver, viewed: true }} />)).toContain("3 of 4 done");
  });

  it("stays hidden once hidden", () => {
    store.set("racetrace.ui.v1", JSON.stringify({ checklistHidden: true }));
    expect(text(<FirstStepsChecklist data={{ carCount: 0, car: null, race: null }} />)).toBe("");
  });
});

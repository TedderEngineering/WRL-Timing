import { describe, expect, it } from "vitest";
import { candidateSessions, carOverlap, planReimport, raceFamily, type SessionPrint, type SiteRace } from "../reimport.js";
import type { RaceSession } from "../types.js";

const cars = (n: number, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));
function session(sourceKey: string, site: RaceSession["site"], date: string, sessionName: string, seriesId = "x"): RaceSession {
  return { sourceKey, site, seriesId, seriesLabel: "", championship: "", season: Number(date.slice(0, 4)), event: "Event", track: "Track", sessionName, sessionType: "race", startTime: date, raceDate: date, files: [], resultsStatus: "official", version: "v", legacyFormat: "sro", factFormat: "alkamel-sro" };
}
function race(raceId: string, series: string, date: string, name: string, c: string[], maxLap: number, status = "PUBLISHED"): SiteRace {
  return { raceId, name, date, track: "Track", series, season: Number(date.slice(0, 4)), status, maxLap, cars: c };
}

describe("series families", () => {
  it("reads the spellings on the site", () => {
    expect(raceFamily("GR_CUP")).toBe("sro");
    expect(raceFamily("GR CUP")).toBe("sro");
    expect(raceFamily("GTWC")).toBe("sro");
    expect(raceFamily("SRO")).toBe("sro");
    expect(raceFamily("Porsche Carrera Cup North America")).toBe("imsa");
    expect(raceFamily("Mustang Challenge North America")).toBe("imsa");
    expect(raceFamily("Lamborghini Super Trofeo")).toBe("imsa");
    expect(raceFamily("IMSA")).toBe("imsa");
    expect(raceFamily("WRL")).toBe("wrl");
    expect(raceFamily("Formula Something")).toBeNull();
  });
  it("car overlap treats 007 and 7 as one car and scores against the larger field", () => {
    expect(carOverlap(["007", "5"], ["7", "5"])).toBe(1);
    expect(carOverlap(["1", "2"], ["1", "2", "3", "4"])).toBe(0.5);
  });
});

describe("re-import plan", () => {
  const sessions = [
    session("sro:gt4-r1", "sro", "2025-10-18", "Race 1"),
    session("sro:gt4-r2", "sro", "2025-10-19", "Race 2"),
    session("sro:gr-r1", "sro", "2025-10-18", "Race 1"),
    session("imsa:vprc-r1", "imsa", "2026-01-17", "Race 1"),
    session("imsa:vprc-r2", "imsa", "2026-01-18", "Race 2"),
    session("imsa:mpc", "imsa", "2026-01-23", "Race"),
    session("redmist:event:1/session:2", "redmist", "2026-02-28", "Saturday 8 Hour"),
  ];
  const prints = new Map<string, SessionPrint>([
    ["sro:gt4-r1", { cars: cars(30), maxLap: 34 }],
    ["sro:gt4-r2", { cars: cars(30), maxLap: 33 }],
    ["sro:gr-r1", { cars: cars(40, 100), maxLap: 20 }],
    ["imsa:vprc-r1", { cars: cars(25, 200), maxLap: 30 }],
    ["imsa:vprc-r2", { cars: cars(25, 200), maxLap: 30 }],
    ["imsa:mpc", { cars: cars(35, 300), maxLap: 110 }],
    ["redmist:event:1/session:2", { cars: cars(42, 400), maxLap: 270 }],
  ]);
  const races = [
    race("gt4r1", "SRO", "2025-10-18", "Pirelli GT4 Race 1 — Indianapolis", cars(30), 34),
    race("gt4r2", "SRO", "2025-10-19", "Pirelli GT4 Race 2 — Indianapolis", cars(30), 33),
    race("grA", "GR_CUP", "2025-10-18", "GR Cup Race 1 — Indianapolis", cars(40, 100), 20),
    race("grB", "GR CUP", "2025-10-18", "GR Cup Race 1", cars(40, 100), 20, "DRAFT"),
    // VPRC Race 1 and Race 2 have the same cars and laps: the race number decides.
    race("vprc1", "IMSA", "2026-01-17", "IMSA VPRC Race 1 — ROAR Before the 24", cars(25, 200), 30),
    race("vprc2", "IMSA", "2026-01-18", "IMSA VPRC Race 2 — ROAR Before the 24", cars(25, 200), 30),
    race("mpc", "IMSA", "2026-01-23", "IMSA MPC — BMW M Endurance Challenge", cars(30, 300), 109),
    // older WRL uploads are dated on the event's first day
    race("barber", "WRL", "2026-02-26", "Saturday 8-Hour", cars(42, 400), 270),
    race("ghost", "SRO", "2025-05-01", "Pirelli GT4 Race 1 — Nowhere", cars(30), 34),
    race("odd", "Formula Something", "2025-05-01", "Race", cars(10), 10),
  ];
  const plan = planReimport(races, sessions, prints);
  const by = Object.fromEntries(plan.map((r) => [r.raceId, r]));

  it("pairs races by their cars, laps and race number", () => {
    expect(by.gt4r1).toMatchObject({ state: "exact", sourceKey: "sro:gt4-r1" });
    expect(by.gt4r2).toMatchObject({ state: "exact", sourceKey: "sro:gt4-r2" });
    expect(by.vprc1).toMatchObject({ state: "exact", sourceKey: "imsa:vprc-r1" });
    expect(by.vprc2).toMatchObject({ state: "exact", sourceKey: "imsa:vprc-r2" });
    expect(by.barber).toMatchObject({ state: "exact", sourceKey: "redmist:event:1/session:2" });
  });

  it("a near match (a few cars or a lap different) is unsure, not exact", () => {
    expect(by.mpc).toMatchObject({ state: "unsure", sourceKey: "imsa:mpc" });
    expect(by.mpc.note).toMatch(/cars in common/);
  });

  it("two site races on one session: the published one keeps it, the other is a duplicate", () => {
    expect(by.grA.state).toBe("exact");
    expect(by.grB).toMatchObject({ state: "duplicate", sourceKey: "sro:gr-r1" });
    expect(by.grB.note).toMatch(/grA/);
  });

  it("no session that weekend, or an unknown series: not found", () => {
    expect(by.ghost.state).toBe("not-found");
    expect(by.odd).toMatchObject({ state: "not-found" });
    expect(by.odd.note).toMatch(/Unknown series/);
  });

  it("orders exact first and fetches only sessions that could be one of the races", () => {
    expect(plan[0].state).toBe("exact");
    expect(candidateSessions([races[0]], sessions).map((s) => s.sourceKey).sort()).toEqual(["sro:gr-r1", "sro:gt4-r1", "sro:gt4-r2"]);
  });
});

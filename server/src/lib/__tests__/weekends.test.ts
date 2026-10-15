import { describe, expect, it } from "vitest";
import { canonicalTrack, championshipFromSourceKey, groupWeekends, raceLabel, raceFamilyLabel, type WeekendRaceIn } from "../weekends.js";

const race = (id: string, name: string, date: string, track: string, series: string, extra: Partial<WeekendRaceIn> = {}): WeekendRaceIn => ({
  id, name, date, track, series, status: "PUBLISHED", totalCars: 30, maxLap: 40, resultsStatus: "official", hasStory: false, eventId: `e-${track}`, eventName: `${track} ${date.slice(0, 4)}`, ...extra,
});

describe("track names", () => {
  it("brings every spelling of a track to one name", () => {
    for (const t of ["COTA", "Circuit of the Americas", "Circuit of the Americas COTA", "Circuit of the Americas MC", "Circuit of the Americas VPRC"]) expect(canonicalTrack(t)).toBe("Circuit of the Americas");
    expect(canonicalTrack("SONOMA")).toBe(canonicalTrack("Sonoma Raceway"));
    expect(canonicalTrack("VIRginia International Raceway")).toBe(canonicalTrack("Virginia International Raceway"));
    expect(canonicalTrack("Eagle's Canyon")).toBe(canonicalTrack("Eagles Canyon"));
    expect(canonicalTrack("Daytona International")).toBe("Daytona International Speedway");
    expect(canonicalTrack("Thunderhill Raceway Park Thunderhill Raceway")).toBe("Thunderhill Raceway Park");
    expect(canonicalTrack("St- Petersburg Street Course")).toBe("St. Petersburg Street Course");
    expect(canonicalTrack("Indianapolis Motor Speedway RC")).toBe("Indianapolis Motor Speedway");
    expect(canonicalTrack("Some New Track")).toBe("Some New Track");
  });
});

describe("race labels", () => {
  it("splits championship, race and event name", () => {
    expect(raceLabel("IMSA VPRC Race 1 — Michelin GT Challenge at VIR", "IMSA")).toEqual({ championship: "VP Racing Challenge", title: "Race 1", eventName: "Michelin GT Challenge at VIR" });
    expect(raceLabel("IMSA MPC — Fox Factory 120", "IMSA")).toMatchObject({ championship: "Pilot Challenge", title: "Fox Factory 120" });
    expect(raceLabel("Lamborghini Super Trofeo — Sebring", "Lamborghini Super Trofeo")).toMatchObject({ championship: "Super Trofeo", title: "Race", eventName: null });
    expect(raceLabel("GR Cup Race 1 — COTA", "GR_CUP")).toMatchObject({ championship: "GR Cup", title: "Race 1", eventName: null });
    expect(raceLabel("Saturday 8-Hour", "WRL")).toEqual({ championship: null, title: "Saturday 8 Hour", eventName: null });
    expect(raceLabel("GP Arlington Race1", "GR_CUP", null, "Grand Prix of Arlington")).toMatchObject({ championship: "GR Cup", title: "Race 1" });
    // Another track's name is kept: the CTMP make-up race was run at VIR.
    expect(raceLabel("IMSA VPRC CTMP Race 2 Makeup — Michelin GT Challenge at VIR", "IMSA", null, "VIRginia International Raceway").title).toBe("CTMP Race 2 Makeup");
  });

  it("takes the championship from the timing-site folder, not the sponsor in the track name", () => {
    expect(championshipFromSourceKey("imsa:26_2026/07_WeatherTech Raceway Laguna Seca/02_IMSA Michelin Pilot Challenge/202605021540_Race")).toBe("Pilot Challenge");
    expect(championshipFromSourceKey("imsa:26_2026/07_WeatherTech Raceway Laguna Seca/01_IMSA WeatherTech SportsCar Championship/202605031230_Race")).toBe("WeatherTech");
    expect(championshipFromSourceKey("sro:06_SRO/26_2026/03_Sonoma/03_Pirelli GT4 America/01_Race 1")).toBe("GT4 America");
    expect(championshipFromSourceKey("redmist:event:297/session:64")).toBeNull();
    expect(raceLabel("Fox Factory 120", "IMSA", "imsa:26_2026/10_Road Atlanta/02_IMSA Michelin Pilot Challenge/202610021340_Race")).toMatchObject({ championship: "Pilot Challenge", title: "Fox Factory 120" });
  });

  it("puts each race in a filter group", () => {
    expect(raceFamilyLabel("GR_CUP", "GR Cup Race 1")).toBe("GR Cup");
    expect(raceFamilyLabel("SRO", "Pirelli GT4 Race 1")).toBe("SRO");
    expect(raceFamilyLabel("Porsche Carrera Cup North America", "x")).toBe("IMSA");
    expect(raceFamilyLabel("WRL", "Sunday 7 Hour")).toBe("WRL");
  });
});

describe("weekends", () => {
  it("groups races at one track within a few days, across duplicate events and spellings", () => {
    const weekends = groupWeekends([
      race("a", "GR Cup — Sonoma Raceway", "2025-03-29", "Sonoma Raceway", "GR_CUP"),
      race("b", "Pirelli GT4 — Sonoma Raceway", "2025-03-29", "SONOMA", "SRO"),
      race("c", "Pirelli GT4 — Sonoma Raceway", "2025-03-30", "SONOMA", "SRO"),
      race("d", "IMSA VPRC Race 1 — ROAR Before the 24", "2026-01-17", "ROAR Before the 24", "IMSA", { eventName: "ROAR Before the 24 2026" }),
      race("e", "IMSA WeatherTech — Rolex 24 at Daytona", "2026-01-24", "Daytona International Speedway", "IMSA"),
    ]);
    expect(weekends.map((w) => [w.track, w.startDate, w.endDate, w.races.map((r) => r.id).join("")])).toEqual([
      ["Daytona International Speedway", "2026-01-24", "2026-01-24", "e"],
      ["Daytona International Speedway", "2026-01-17", "2026-01-17", "d"],
      ["Sonoma Raceway", "2025-03-29", "2025-03-30", "bac"],
    ]);
    const sonoma = weekends[2];
    expect(sonoma.families).toEqual(["SRO", "GR Cup"]);
    // Two unnumbered GT4 races are numbered by date.
    expect(sonoma.races.filter((r) => r.championship === "GT4 America").map((r) => r.title)).toEqual(["Race 1", "Race 2"]);
    expect(weekends[1].title).toBe("ROAR Before the 24");
    expect(weekends[0].title).toBe("Rolex 24 at Daytona");
  });
});

describe("admin race search", () => {
  it("matches every word anywhere, with R1 read as Race 1", async () => {
    const { adminSearchWords } = await import("../race-search.js");
    const w = adminSearchWords("GR CUP R1 Barber");
    expect(w).toHaveLength(4);
    expect(JSON.stringify(w[2])).toContain('"Race 1"');
  });
});

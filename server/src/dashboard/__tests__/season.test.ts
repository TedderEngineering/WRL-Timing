import { describe, expect, it } from "vitest";
import { buildSeason, calendarFor, locateRace, raceInSeries, type SeasonRace } from "../season.js";
import { groupIntoWeekends, sessionLabel, type LatestRaceRow } from "../latest.js";

// The published 2026 races on racetrace.tedderengineering.com on 2026-10-13 (date|series|track|name).
const LIVE_2026 = `2026-08-22|IMSA|Virginia International Raceway|Virgina is For Racing Lovers Grand Prix
2026-07-24|WRL|Road Atlanta|Saturday 8-Hour
2026-07-24|WRL|Road Atlanta|Sunday 7-Hour
2026-06-07|IMSA|Mid-Ohio Sports Car Course|O'Reilly Auto Parts 4 Hours of Mid-Ohio
2026-06-05|WRL|Daytona International Speedway|Saturday 14-Hour
2026-05-03|IMSA|Weathertech Raceway Laguna Seca|StubHub Monterey SportsCar Championship
2026-05-02|IMSA|Weathertech Raceway Laguna Seca|WeatherTech Raceway Laguna Seca 120
2026-04-25|GR CUP|COTA|GR Cup Race 1
2026-04-23|WRL|Road America|Saturday 8-Hour
2026-04-23|WRL|Road America|Sunday 7-Hour
2026-04-03|WRL|Thunderhill Raceway Park|Sunday 7-Hour
2026-04-03|WRL|Thunderhill Raceway Park|Saturday 8-Hour
2026-03-29|GTWC|Sonoma Raceway|GTWC — Sonoma Raceway
2026-03-29|GR_CUP|Sonoma Raceway|GR Cup Race 2 — Sonoma Raceway
2026-03-28|SRO|Sonoma Raceway|Pirelli GT4 Race 2 — Sonoma Raceway
2026-03-28|GR_CUP|Sonoma Raceway|GR Cup Race 1 — Sonoma Raceway
2026-03-27|SRO|Sonoma Raceway|Pirelli GT4 Race 1 — Sonoma Raceway
2026-03-21|IMSA|Sebring International Raceway|74th Annual Mobil 1 Twelve Hours of Sebring
2026-03-20|IMSA|Sebring International Raceway|Alan Jay Automotive Network 120
2026-03-19|Mustang Challenge North America|Sebring International Raceway|Mustang Challenge — Sebring
2026-03-19|Lamborghini Super Trofeo|Sebring International Raceway|Lamborghini Super Trofeo — Sebring
2026-03-19|Porsche Carrera Cup North America|Sebring International Raceway|Porsche Carrera Cup — Sebring
2026-03-08|IMSA|Sebring International Raceway|IMSA Airbnb Endurance Challenge — Sebring International Raceway
2026-03-01|IMSA|St. Petersburg Street Course|MX-5 Cup Race 2 — Grand Prix of St. Petersburg
2026-02-28|IMSA|Circuit of the Americas|IMSA VPRC Race 1 — DuraMAX Grand Prix
2026-02-26|WRL|Barber Motorsports Park|Sunday 7-Hour
2026-02-26|WRL|Barber Motorsports Park|Saturday 8-Hour
2026-02-04|WRL|Eagles Canyon|Sunday 7 Hour
2026-02-04|WRL|Eagles Canyon|Saturday 8 Hour
2026-01-24|IMSA|Daytona International Speedway|IMSA WeatherTech — Rolex 24 at Daytona
2026-01-23|IMSA|Daytona International Speedway|MX-5 Cup Race 2 — Rolex 24 at Daytona
2026-01-23|IMSA|Daytona International Speedway|IMSA MPC — BMW M Endurance Challenge
2026-01-17|IMSA|ROAR Before the 24|IMSA VPRC Race 1 — ROAR Before the 24`
  .split("\n")
  .map((l, i) => {
    const [date, series, track, name] = l.split("|");
    return { id: `r${i}`, date, series, track, name } as SeasonRace;
  });

const cal = calendarFor(2026)!;
const season = buildSeason(cal, LIVE_2026, "2026-10-13");
const byId = Object.fromEntries(season.map((s) => [s.id, s]));
const statuses = (id: string) => byId[id].rounds.map((r) => r.status);

describe("season view against the live 2026 races", () => {
  it("WRL: rounds 1–6 on the site, Watkins Glen and Utah missing, Sebring next", () => {
    expect(statuses("wrl")).toEqual([
      "on_site", "on_site", "on_site", "on_site", "on_site", "on_site", "missing", "missing", "upcoming", "upcoming",
    ]);
    expect(byId.wrl.counts).toEqual({ total: 10, run: 8, onSite: 6 });
    expect(byId.wrl.next?.name).toBe("Sebring");
    expect(byId.wrl.rounds[0].races.map((r) => r.name)).toEqual(["Saturday 8 Hour", "Sunday 7 Hour"]);
    expect(byId.wrl.complete).toBe(false);
  });

  it("IMSA MPC: only the Pilot Challenge races match, never WeatherTech, VPRC, MX-5 or the one-make series", () => {
    expect(statuses("imsa-mpc")).toEqual([
      "on_site", "on_site", "on_site", "on_site", "missing", "missing", "missing", "on_site", "missing", "missing",
    ]);
    const names = byId["imsa-mpc"].rounds.flatMap((r) => r.races.map((x) => x.name));
    expect(names).toEqual([
      "IMSA MPC — BMW M Endurance Challenge",
      "Alan Jay Automotive Network 120",
      "WeatherTech Raceway Laguna Seca 120",
      "O'Reilly Auto Parts 4 Hours of Mid-Ohio",
      "Virgina is For Racing Lovers Grand Prix",
    ]);
    expect(byId["imsa-mpc"].complete).toBe(true);
    expect(byId["imsa-mpc"].next).toBeNull();
  });

  it("GT4 America: Sonoma (both races) is the only round on the site", () => {
    expect(byId["sro-gt4"].counts).toEqual({ total: 7, run: 7, onSite: 1 });
    expect(byId["sro-gt4"].rounds[0].races.map((r) => r.name)).toEqual([
      "Pirelli GT4 Race 1 — Sonoma Raceway",
      "Pirelli GT4 Race 2 — Sonoma Raceway",
    ]);
  });

  it("a race imported by the new intake is matched by its sub-series, whatever its name", () => {
    const r: SeasonRace = { id: "x", name: "Fox Factory 120", date: "2026-10-02", track: "Road Atlanta", series: "IMSA", subSeries: "Pilot Challenge" };
    expect(locateRace(cal, r)).toMatchObject({ seriesId: "imsa-mpc", round: 10, of: 10 });
    expect(raceInSeries({ ...r, subSeries: "WeatherTech" }, cal.series[1])).toBe(false);
  });

  it("a round in progress is live, and before it starts it is upcoming", () => {
    expect(buildSeason(cal, [], "2026-10-17").find((s) => s.id === "wrl")!.rounds[8].status).toBe("live");
    expect(buildSeason(cal, [], "2026-01-01").find((s) => s.id === "wrl")!.rounds.every((r) => r.status === "upcoming")).toBe(true);
  });
});

describe("latest races grouped into weekends", () => {
  const row = (id: string, date: string, name: string, track = "Sonoma Raceway", series = "SRO"): LatestRaceRow => ({
    id, name, date: new Date(`${date}T00:00:00Z`), track, series, subSeries: null, eventId: null,
    premium: false, createdAt: new Date(), maxLap: null, totalCars: null,
  });

  it("puts a weekend's races together, oldest first, and keeps other series apart", () => {
    const g = groupIntoWeekends([
      row("b", "2026-03-28", "Pirelli GT4 Race 2 — Sonoma Raceway"),
      row("c", "2026-03-28", "GR Cup Race 1 — Sonoma Raceway", "Sonoma Raceway", "GR_CUP"),
      row("a", "2026-03-27", "Pirelli GT4 Race 1 — Sonoma Raceway"),
      row("d", "2026-02-26", "Saturday 8-Hour", "Barber Motorsports Park", "WRL"),
    ]);
    expect(g.map((x) => x.races.map((r) => r.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("labels each race by its session", () => {
    expect(sessionLabel({ name: "Pirelli GT4 Race 1 — Sonoma Raceway" })).toBe("Pirelli GT4 Race 1");
    expect(sessionLabel({ name: "anything" }, "Race 2")).toBe("Race 2");
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { SeasonRecapCard, recapStats, type SeasonRecap } from "../SeasonRecapCard";

const recap: SeasonRecap = {
  key: "c1:2026:imsa-mpc", number: "67", team: "Blackdog Racing", season: 2026, seriesId: "imsa-mpc", seriesLabel: "IMSA Michelin Pilot Challenge",
  finale: { name: "Road Atlanta", end: "2026-10-03" }, races: 10, laps: 1234,
  best: { finishClass: 1, cls: "GS", raceId: "ra", raceName: "Pilot Challenge — Road Atlanta", date: "2026-10-02" },
  classWins: 1, podiums: 4, pitCycles: { count: 22, gained: 14 }, topThreePitStops: 6, topThreeFastestLaps: 0,
  raceList: [
    { id: "seb", name: "Pilot Challenge — Sebring", date: "2026-03-20", finishClass: 5, cls: "GS" },
    { id: "ra", name: "Pilot Challenge — Road Atlanta", date: "2026-10-02", finishClass: 1, cls: "GS" },
  ],
};
const text = (n: React.ReactNode) =>
  renderToStaticMarkup(<MemoryRouter>{n}</MemoryRouter>).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("Your 2026", () => {
  it("states the season's facts and leaves out zeros", () => {
    expect(recapStats(recap).map((s) => `${s.label}: ${s.value}`)).toEqual([
      "Races: 10",
      "Laps: 1,234",
      "Best result: P1 in GS",
      "Class wins: 1",
      "Class podiums: 4",
      "Gained in 22 pit cycles: 14 places",
      "Top-three pit stops: 6",
    ]);
    expect(recapStats({ ...recap, best: null, classWins: 0, podiums: 0, pitCycles: { count: 5, gained: null }, topThreePitStops: 0 }).map((s) => s.label)).toEqual(["Races", "Laps"]);
  });

  it("names the car, the series and every race's finish, each linking to the race on that car", () => {
    const html = renderToStaticMarkup(<MemoryRouter><SeasonRecapCard recap={recap} /></MemoryRouter>);
    const t = text(<SeasonRecapCard recap={recap} />);
    expect(t).toContain("Your 2026 · IMSA Michelin Pilot Challenge");
    expect(t).toContain("#67 Blackdog Racing");
    expect(t).toContain("P5 Sebring");
    expect(html).toContain('href="/chart?race=ra&amp;car=67"');
    expect(t).toContain("Share your season");
  });
});

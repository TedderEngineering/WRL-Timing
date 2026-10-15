import { describe, expect, it } from "vitest";
import { calendarFor } from "../season.js";
import { buildRecap, recapSeriesFor, seasonOver } from "../season-recap.js";

const cal = calendarFor(2026)!;
const lap = (l: number, p: number, cp: number, ltSec = 100, pit = 0) => ({ l, p, cp, ltSec, pit, flag: "GF", lt: "" });
const chart = (cp: number, laps = 3) => ({
  maxLap: laps,
  classCarCounts: { GS: 2 },
  cars: {
    "67": { num: 67, team: "Blackdog Racing", cls: "GS", finishPos: cp, finishPosClass: cp, laps: Array.from({ length: laps }, (_, i) => lap(i + 1, cp, cp)) },
    "8": { num: 8, team: "X", cls: "GS", finishPos: 3 - cp, finishPosClass: 3 - cp, laps: Array.from({ length: laps }, (_, i) => lap(i + 1, 3 - cp, 3 - cp, 101)) },
  },
});
const race = (id: string, date: string, track: string, cp: number, extra = {}) => ({
  id, name: `Pilot Challenge — ${track}`, date: new Date(`${date}T00:00:00Z`), track, series: "IMSA", subSeries: "Pilot Challenge",
  carNumber: "67", chartData: chart(cp), annotationData: {}, ...extra,
});

describe("season recap timing, series by series", () => {
  it("places a race in its calendar series, or its family's", () => {
    expect(recapSeriesFor(cal, race("a", "2026-10-03", "Road Atlanta", 1))).toBe("imsa-mpc");
    // A WeatherTech race has no calendar of its own: IMSA's family calendar decides.
    expect(recapSeriesFor(cal, { name: "WeatherTech — Petit Le Mans", date: new Date("2026-10-03"), track: "Road Atlanta", series: "IMSA", subSeries: "WeatherTech" })).toBe("imsa-mpc");
    expect(recapSeriesFor(cal, { name: "WRL Saturday 8 Hour — Sebring", date: new Date("2026-10-17"), track: "Sebring", series: "WRL", subSeries: null })).toBe("wrl");
  });

  it("opens IMSA's once its finale is on the site, WRL's not before December", () => {
    const finale = { id: "f", name: "Pilot Challenge — Road Atlanta", date: new Date("2026-10-02T00:00:00Z"), track: "Michelin Raceway Road Atlanta", series: "IMSA", subSeries: "Pilot Challenge" };
    expect(seasonOver(cal, "imsa-mpc", [finale], new Date("2026-10-05"))).toBe(true);
    expect(seasonOver(cal, "imsa-mpc", [], new Date("2026-10-05"))).toBe(false); // finale not on the site, within the week
    expect(seasonOver(cal, "imsa-mpc", [], new Date("2026-10-11"))).toBe(true); // a week after it ended
    expect(seasonOver(cal, "wrl", [], new Date("2026-10-15"))).toBe(false);
  });
});

describe("the recap", () => {
  it("adds up the car's season as facts", () => {
    const r = buildRecap(cal, { id: "c1", number: "67" }, 2026, "imsa-mpc", [
      race("r1", "2026-03-20", "Sebring", 2),
      race("r2", "2026-05-02", "Laguna Seca", 1),
      race("r3", "2026-10-03", "Road Atlanta", 1),
    ])!;
    expect(r).toMatchObject({
      key: "c1:2026:imsa-mpc", number: "67", team: "Blackdog Racing", seriesLabel: "IMSA Michelin Pilot Challenge",
      races: 3, laps: 9, classWins: 2, podiums: 3,
      best: { finishClass: 1, cls: "GS", raceId: "r2" },
    });
    expect(r.raceList.map((x) => x.finishClass)).toEqual([2, 1, 1]);
    // No pit cycles, so no gain is claimed.
    expect(r.pitCycles).toEqual({ count: 0, gained: null });
  });

  it("is nothing without races", () => {
    expect(buildRecap(cal, { id: "c1", number: "67" }, 2026, "imsa-mpc", [])).toBeNull();
  });
});

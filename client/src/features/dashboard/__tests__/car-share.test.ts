import { describe, expect, it } from "vitest";
import { cardHighlights, carCardResult, carCardStats, carCardText, lapColor, CARD_DRIVER_COLORS } from "../carShare";

const facts: any = {
  carKey: "120", number: "120", team: "AE Victory Racing", cls: "GTO", vehicle: null, finishClass: 1, finishOverall: 1, classSize: 16, status: null, finished: true,
  laps: 175, raceLaps: 175, bestLap: { sec: 137.732, lap: 127 }, bestLapClassRank: 1,
  pitCycles: [{ cycle: 1, lap: 14, before: 6, after: 3, net: 3 }, { cycle: 2, lap: 121, before: 2, after: 3, net: -1 }],
};
const drive: any = {
  known: true, carTimeS: 1000,
  stints: [{ start: 1, end: 60, driver: "Alana Carter" }, { start: 61, end: 120, driver: "MICHELE Abbate" }, { start: 121, end: 175, driver: "Hannah Grisham" }],
  drivers: [{ name: "Alana Carter" }, { name: "Michele Abbate" }, { name: "Hannah Grisham" }],
};

describe("the car's share card", () => {
  it("states the result, best lap, stops and places over the pit cycles", () => {
    expect(carCardResult(facts)).toBe("Finished P1 in GTO of 16 · P1 overall · 175 laps");
    expect(carCardResult({ ...facts, finished: false, laps: 112 })).toBe("Retired after lap 112 · classified P1 in GTO of 16");
    expect(carCardStats(facts, drive)).toEqual([
      { value: "2:17.732", sub: "best lap · fastest in GTO" },
      { value: "2", sub: "pit stops" },
      { value: "+2", sub: "places in GTO over 2 pit cycles", tone: "good" },
    ]);
  });

  it("colours each lap by its driver, matching names however spelled", () => {
    const c = lapColor(drive);
    expect(c(10)).toBe(CARD_DRIVER_COLORS[0]);
    expect(c(90)).toBe(CARD_DRIVER_COLORS[1]);
    expect(c(175)).toBe(CARD_DRIVER_COLORS[2]);
    expect(lapColor({ ...drive, known: false })(10)).toBeNull();
  });

  it("is titled by the car and team, the race and date under it", () => {
    expect(carCardText({ race: { id: "r", name: "WRL Sunday 7 Hour — Sebring International Raceway", date: "2026-10-18", track: "Sebring" }, number: "120", team: "AE Victory Racing", cls: "GTO", drivers: [], facts, drive })).toEqual({
      title: "#120 AE Victory Racing",
      subtitle: "WRL Sunday 7 Hour — Sebring International Raceway · Oct 18, 2026",
    });
  });

  it("takes the result as the banner and up to two other highlights, or fewer", () => {
    const h = (kind: string, text: string) => ({ kind, text, score: 1 });
    const won = h("result", "Won GTO and the race overall");
    expect(cardHighlights({ ...facts, highlights: [won, h("fewest_stops", "6 pit stops, fewest in GTO"), h("race_pace", "2nd-best race pace in GTO"), h("passes", "x")] })).toEqual({
      banner: "Won GTO and the race overall",
      pills: ["6 pit stops, fewest in GTO", "2nd-best race pace in GTO"],
    });
    expect(cardHighlights({ ...facts, highlights: [won], benchmarks: ["Quickest stop of 6 in GTO, lap 61"] })).toEqual({ banner: "Won GTO and the race overall", pills: [] });
    expect(cardHighlights({ ...facts, highlights: [h("race_pace", "2nd-best race pace in GTO")] })).toEqual({ banner: null, pills: ["2nd-best race pace in GTO"] });
    // Older responses without highlights: the benchmarks stand in.
    expect(cardHighlights({ ...facts, benchmarks: ["Quickest stop of 6 in GTO, lap 61"] })).toEqual({ banner: null, pills: ["Quickest stop of 6 in GTO, lap 61"] });
  });
});

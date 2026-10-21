import { describe, expect, it } from "vitest";
import type { CarData, LapData, RaceChartData } from "@shared/types";
import { computeStrategyMetrics } from "../strategy-engine";
import { setStrategyView, sortStrategy, strategySortNote } from "../strategy-view";
import { tabPdf } from "../pdf";

const lap = (l: number, ltSec: number, pit = 0): LapData => ({ l, p: 1, cp: 1, lt: "", ltSec, flag: "GF", pit });
// Car 1 wins GTO with two stops; car 2 is second with one; car 3 runs alone in GTU.
const car = (num: number, cls: string, pos: number, pits: number[], pace: number): CarData => ({
  num,
  team: `Team ${num}`,
  cls,
  finishPos: pos,
  finishPosClass: cls === "GTO" ? pos : 1,
  laps: Array.from({ length: 30 }, (_, i) => lap(i + 1, pits.includes(i + 1) ? pace + 60 : pace, pits.includes(i + 1) ? 1 : 0)),
});
const data: RaceChartData = {
  maxLap: 30,
  totalCars: 3,
  greenPaceCutoff: 999,
  cars: { "1": car(1, "GTO", 1, [10, 20], 100), "2": car(2, "GTO", 2, [15], 101), "3": car(3, "GTU", 3, [15], 105) },
  fcy: [],
  classGroups: { GTO: [1, 2], GTU: [3] },
  classCarCounts: { GTO: 2, GTU: 1 },
};
const annotations = {} as never;
const meta = { raceName: "Test Race", track: "Test Track", date: "2026-10-10", preparedFor: null, uncompressed: true };

describe("Strategy PDF follows the table", () => {
  it("sorts as the table does, and says so when not in class order", () => {
    const gto = computeStrategyMetrics(data, annotations).filter((m) => m.cls === "GTO");
    expect(sortStrategy(gto, { key: "classPos", dir: "asc" }).map((m) => m.carNum)).toEqual([1, 2]);
    expect(sortStrategy(gto, { key: "stops", dir: "asc" }).map((m) => m.carNum)).toEqual([2, 1]);
    expect(strategySortNote({ key: "classPos", dir: "asc" })).toBeNull();
    expect(strategySortNote({ key: "stops", dir: "asc" })).toBe("Sorted by stops, lowest first");
  });

  it("prints the class on screen in the table's order", async () => {
    setStrategyView(data, { cls: "GTO", sort: { key: "stops", dir: "asc" } });
    const { blob } = await tabPdf("strategy", { raceId: "r", data, annotations, focusNum: 1, meta });
    const text = await blob.text();
    expect([...text.matchAll(/\(#(\d)\)/g)].map((m) => m[1])).toEqual(["2", "1"]);
    expect(text).toContain("CLASS GTO");
    expect(text).not.toContain("CLASS GTU");
    expect(text).toContain("Sorted by stops, lowest first");
  });
});

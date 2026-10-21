import { describe, expect, it } from "vitest";
import type { CarData, LapData, RaceChartData } from "@shared/types";
import { driverPerformance } from "../driver-performance";
import { setDriverReportView, sortDriverRows } from "../driver-report-view";
import { tabPdf } from "../pdf";

const lap = (l: number, ltSec: number): LapData => ({ l, p: 1, cp: 1, lt: "", ltSec, flag: "GF", pit: 0 });
// Car 1: quick and uneven; car 2: slower and steady; car 3 in another class.
const car = (num: number, cls: string, times: number[]): CarData => ({
  num,
  team: `Team ${num}`,
  cls,
  finishPos: num,
  finishPosClass: 1,
  laps: times.map((t, i) => lap(i + 1, t)),
});
const data: RaceChartData = {
  maxLap: 8,
  totalCars: 3,
  greenPaceCutoff: 999,
  cars: {
    "1": car(1, "GTO", [110, 100, 101, 102, 103, 100.5, 101.5, 102.5]),
    "2": car(2, "GTO", [110, 102, 102.05, 102, 102.05, 102, 102.05, 102]),
    "3": car(3, "GTU", [110, 105, 105, 105, 105, 105, 105, 105]),
  },
  fcy: [],
  classGroups: {},
  classCarCounts: {},
};
const annotations = {} as never;
const meta = { raceName: "Test Race", track: "Test Track", date: "2026-10-10", preparedFor: null, uncompressed: true };

/** The driver rows' car numbers in the order the PDF draws them. */
async function pdfOrder(): Promise<{ text: string; order: string[] }> {
  const { blob } = await tabPdf("drivers", { raceId: "r", data, annotations, focusNum: 1, meta });
  const text = await blob.text();
  const order = [...text.matchAll(/#(\d) Team/g)].map((m) => m[1]);
  return { text, order };
}

describe("Driver Report PDF follows the table", () => {
  it("sorts rows as the table does", () => {
    const [gto] = driverPerformance(data, annotations);
    expect(sortDriverRows(gto.rows, { key: "avgLap", dir: "asc" }).map((r) => r.carLabel)).toEqual(["1", "2"]);
    expect(sortDriverRows(gto.rows, { key: "stdDev", dir: "asc" }).map((r) => r.carLabel)).toEqual(["2", "1"]);
  });

  it("prints the class on screen, in the table's order, and says how it is sorted", async () => {
    setDriverReportView(data, { cls: "GTO", sort: { key: "stdDev", dir: "asc" } });
    const { text, order } = await pdfOrder();
    expect(order).toEqual(["2", "1"]);
    expect(text).not.toContain("CLASS GTU");
    expect(text).toContain("Sorted by consistency, lowest first");
    // The method note says the same, not that drivers are ranked on average lap.
    expect(text).toContain("Sorted by consistency, lowest first. The average lap is the average");
    expect(text).not.toContain("Drivers are ranked");
  });

  it("ranked on average lap: no sort note", async () => {
    setDriverReportView(data, { cls: "GTO", sort: { key: "avgLap", dir: "asc" } });
    const { text, order } = await pdfOrder();
    expect(order).toEqual(["1", "2"]);
    expect(text).not.toContain("Sorted by");
    expect(text).toContain("Drivers are ranked on the average of their fastest laps");
  });
});

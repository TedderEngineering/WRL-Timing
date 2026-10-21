import { describe, expect, it } from "vitest";
import type { CarData, LapData, RaceChartData } from "@shared/types";
import type { PitAnalysisResponse, PitStop } from "../PitAnalysisTab";
import { pitRow, pitSortNote, setPitView, sortPits, stopTone } from "../pit-view";
import { tabPdf } from "../pdf";
import { api } from "../../../lib/api";

const stop = (pitLap: number, lane: number, lost: number, extra: Partial<PitStop> = {}): PitStop => ({
  stopNumber: 1,
  pitLap,
  condition: "Full green",
  localRef_s: null,
  refSource: "Green pace",
  serviceTime_s: null,
  pitRoadTime_s: lane,
  timeLost_s: lost,
  delta_s: null,
  kind: "stop",
  ...extra,
});

describe("pit rows", () => {
  it("sum service stops, and time lost over green-flag stops only", () => {
    const r = pitRow("7", "7", "Team (GTO)", "GTO", 1, [
      stop(40, 60, 70),
      stop(10, 62, 90),
      stop(25, 50, 30, { condition: "Caution" }),
      stop(30, 400, 420, { kind: "garage" }),
    ]);
    expect(r.team).toBe("Team");
    expect(r.stops.map((s) => s.pitLap)).toEqual([10, 25, 30, 40]);
    expect(r.serviceStops).toBe(3);
    expect(r.avgLane).toBeCloseTo((60 + 62 + 50) / 3);
    expect([r.avgLost, r.best, r.worst]).toEqual([80, 70, 90]);
  });
  it("colour a stop against its cycle: 2 s either way", () => {
    expect(stopTone(stop(1, 1, 1, { delta_s: -2.5 }))).toBe("quick");
    expect(stopTone(stop(1, 1, 1, { delta_s: 1.9 }))).toBe("even");
    expect(stopTone(stop(1, 1, 1, { delta_s: 3 }))).toBe("slow");
    expect(stopTone(stop(1, 1, 1, { kind: "garage" }))).toBe("other");
  });
  it("sort as the table does and say so", () => {
    const a = pitRow("1", "1", "A", "GTO", 1, [stop(10, 60, 90)]);
    const b = pitRow("2", "2", "B", "GTO", 2, [stop(10, 60, 70)]);
    expect(sortPits([a, b], { key: "avgLost", dir: "asc" }).map((r) => r.key)).toEqual(["2", "1"]);
    expect(pitSortNote({ key: "classPos", dir: "asc" })).toBeNull();
    expect(pitSortNote({ key: "avgLost", dir: "asc" })).toBe("Sorted by average time lost, lowest first");
  });
});

describe("Pit Stops PDF follows the table", () => {
  const lap = (l: number): LapData => ({ l, p: 1, cp: 1, lt: "", ltSec: 100, flag: "GF", pit: 0 });
  const car = (num: number, cls: string, pos: number): CarData => ({ num, team: `Team ${num}`, cls, finishPos: pos, finishPosClass: cls === "GTO" ? pos : 1, laps: [lap(1), lap(2)] });
  const data: RaceChartData = {
    maxLap: 2,
    totalCars: 3,
    greenPaceCutoff: 999,
    cars: { "1": car(1, "GTO", 1), "2": car(2, "GTO", 2), "3": car(3, "GTU", 3) },
    fcy: [],
    classGroups: { GTO: [1, 2], GTU: [3] },
    classCarCounts: { GTO: 2, GTU: 1 },
  };
  const pits: PitAnalysisResponse = {
    source: "facts",
    raceId: "r",
    track: "",
    trackConfig: null,
    cars: {
      "1": { carNumber: "1", teamName: "Team 1", carClass: "GTO", carColor: null, finishPos: 1, stops: [stop(10, 60, 90)] },
      "2": { carNumber: "2", teamName: "Team 2", carClass: "GTO", carColor: null, finishPos: 2, stops: [stop(10, 60, 70)] },
      "3": { carNumber: "3", teamName: "Team 3", carClass: "GTU", carColor: null, finishPos: 3, stops: [stop(11, 60, 80)] },
    },
    summary: { totalStops: 3, totalCars: 3, avgServiceTime_s: null, avgTimeLost_s: 80 },
  } as unknown as PitAnalysisResponse;

  it("prints the class on screen in the table's order", async () => {
    (api as unknown as { get: () => Promise<PitAnalysisResponse> }).get = async () => pits;
    setPitView(data, { cls: "GTO", sort: { key: "avgLost", dir: "asc" } });
    const meta = { raceName: "Test Race", track: "Test Track", date: "2026-10-10", preparedFor: null, uncompressed: true };
    const { blob } = await tabPdf("pitanalysis", { raceId: "r", data, annotations: {} as never, focusNum: 1, meta });
    const text = await blob.text();
    expect([...text.matchAll(/\(#(\d)\)/g)].map((m) => m[1])).toEqual(["2", "1"]);
    expect(text).toContain("CLASS GTO");
    expect(text).not.toContain("CLASS GTU");
    expect(text).toContain("Sorted by average time lost, lowest first");
  });
});

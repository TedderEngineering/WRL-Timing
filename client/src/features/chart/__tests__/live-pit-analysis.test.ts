import { describe, expect, it } from "vitest";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { pitAnalysisFromChart } from "../live-pit-analysis";

const lap = (l: number, flag = "GREEN", pit = 0) => ({ l, p: 1, cp: 1, lt: "", ltSec: 140, flag, pit });
const car = (num: number, cls: string, flags: Record<number, string> = {}, pits: number[] = []) => ({
  num, team: `Team ${num}`, cls, finishPos: num, finishPosClass: num,
  laps: Array.from({ length: 30 }, (_, i) => lap(i + 1, flags[i + 1] ?? "GREEN", pits.includes(i + 1) ? 1 : 0)),
});
const timing = (loss: number, extra: Record<string, unknown> = {}) => ({
  pitInTime: null, pitRoadTime: loss - 20, pitOutTime: null, isDriveThrough: false, totalPitLoss: loss, inLapTime: null, outLapTime: null,
  avgGreenLapTime: 140, splitReliable: true, decompositionLevel: "total_only", ...extra,
});
const pit = (l: number, t: ReturnType<typeof timing>, more: Record<string, unknown> = {}) => ({ l, lb: "Pit", c: "#fff", yo: 0, da: 0, pitTiming: t, ...more });

const data = {
  maxLap: 30, totalCars: 2, greenPaceCutoff: 200, fcy: [[20, 22]],
  cars: { "119": car(119, "GTO", {}, [10, 21]), "282": car(282, "GTO", {}, [12, 25]) },
  classGroups: { GTO: [119, 282] }, classCarCounts: { GTO: 2 },
} as unknown as RaceChartData;
const ann = {
  "119": { reasons: {}, settles: [], pits: [pit(10, timing(152.3, { cycleComparison: { cycleId: 1, deltaTotalLoss: -29.4 } })), pit(21, timing(60))] },
  "282": { reasons: {}, settles: [], pits: [pit(12, timing(170)), pit(25, timing(6041), { isGarage: true })] },
} as unknown as AnnotationData;

describe("pitAnalysisFromChart", () => {
  const a = pitAnalysisFromChart(data, ann, "Sebring");

  it("lists every car's stops with the live chart's timing", () => {
    expect(a.summary.totalStops).toBe(4);
    expect(a.summary.totalCars).toBe(2);
    expect(a.cars["119"].stops[0]).toMatchObject({ stopNumber: 1, pitLap: 10, kind: "stop", condition: "Full green", pitRoadTime_s: 132.3, timeLost_s: 152.3, delta_s: -29.4, cycle: 1, localRef_s: 140, serviceTime_s: null });
  });
  it("says a stop under the caution was one, and a garage visit is a garage visit", () => {
    expect(a.cars["119"].stops[1].condition).toBe("Caution");
    expect(a.cars["282"].stops[1].kind).toBe("garage");
  });
  it("averages time lost over green-flag stops only (no caution stops, no garage)", () => {
    expect(a.summary.avgTimeLost_s).toBeCloseTo((152.3 + 170) / 2, 6);
  });
  it("counts a 5-minute stop as a garage visit and a pit-lane pass as a drive-through", () => {
    const d2 = { ...data, cars: { ...data.cars, "2": car(2, "GTO", {}, [5, 8]) } } as unknown as RaceChartData;
    const a2 = pitAnalysisFromChart(d2, { ...ann, "2": { reasons: {}, settles: [], pits: [pit(5, timing(10)), pit(8, timing(820))] } } as unknown as AnnotationData);
    expect(a2.cars["2"].stops.map((s) => s.kind)).toEqual(["drive_through", "garage"]);
    expect(a2.summary.avgTimeLost_s).toBeCloseTo((152.3 + 170) / 2, 6);
  });
  it("is empty before the first stop", () => {
    expect(pitAnalysisFromChart(data, {}).summary.totalStops).toBe(0);
  });
});

describe("pitAnalysisFromChart pit-lane time", () => {
  it("does not show the time lost as the pit-lane time (the parser's stand-in)", () => {
    const same = { "119": { reasons: {}, settles: [], pits: [pit(10, timing(125.2, { pitRoadTime: 125.2 }))] } } as unknown as AnnotationData;
    const a = pitAnalysisFromChart(data, same);
    expect(a.cars["119"].stops[0]).toMatchObject({ pitRoadTime_s: null, timeLost_s: 125.2 });
  });
});

import { describe, expect, it } from "vitest";
import type { CarData, LapData, RaceChartData } from "@shared/types";
import { driverPerformance, type DriverRow } from "../driver-performance";

const lap = (l: number, ltSec: number, extra: Partial<LapData> = {}): LapData => ({ l, p: 1, cp: 1, lt: "", ltSec, flag: "GF", pit: 0, ...extra });
const car = (num: number, cls: string, times: number[], extra: Partial<CarData> = {}, lapExtra: Record<number, Partial<LapData>> = {}): CarData => ({
  num,
  team: `Team ${num}`,
  cls,
  finishPos: 1,
  finishPosClass: 1,
  laps: times.map((t, i) => lap(i + 1, t, lapExtra[i + 1])),
  ...extra,
});
const chart = (cars: CarData[], fcy: [number, number][] = []): RaceChartData => ({
  maxLap: Math.max(...cars.map((c) => c.laps.length)),
  totalCars: cars.length,
  greenPaceCutoff: 999,
  cars: Object.fromEntries(cars.map((c) => [String(c.num), c])),
  fcy,
  classGroups: {},
  classCarCounts: {},
});

describe("driver performance", () => {
  it("ranks each driver on the fastest half of their racing laps", () => {
    // Lap 1, the pit in-lap (6) and out-lap (7) and the caution lap (10) don't count.
    const times = [110, 100, 101, 102, 103, 130, 125, 100.5, 101.5, 140, 102.5, 104];
    const data = chart([car(7, "GTO", times, {}, { 6: { pit: 1 }, 10: { flag: "FCY" } })], [[10, 10]]);
    const annotations: any = { "7": { reasons: {}, pits: [{ l: 6, lb: "", c: "", yo: 0, da: 0, inDriver: "Alex Rivera", outDriver: "Jamie Cole" }] } };
    const [gto] = driverPerformance(data, annotations);
    const by: Record<string, DriverRow> = Object.fromEntries(gto.rows.map((r) => [r.driver ?? "", r]));

    // Alex: laps 1-6, racing laps 2-5; at most half of 6 laps shown, the fastest 3.
    expect(by["Alex Rivera"].laps).toBe(6);
    expect(by["Alex Rivera"].shown.map((s) => s.l)).toEqual([2, 3, 4]);
    expect(by["Alex Rivera"].avgLap).toBeCloseTo(101, 6);
    expect(by["Alex Rivera"].fastLap).toBe(100);
    // Jamie: laps 7-12, racing laps 8, 9, 11, 12.
    expect(by["Jamie Cole"].shown.map((s) => s.l)).toEqual([8, 9, 11]);
    expect(by["Jamie Cole"].avgLap).toBeCloseTo(101.5, 6);
    expect(by["Jamie Cole"].lapsPct).toBe(50);
    expect(gto.rows.map((r) => r.driver)).toEqual(["Alex Rivera", "Jamie Cole"]);
  });

  it("leaves out laps far off the class's or the driver's own pace", () => {
    // 125 is over 120% of the class's 100; 112 is over 110% of the driver's own 101.
    const fast = car(1, "GTO", [110, 100, 100, 100, 100, 100]);
    const slow = car(2, "GTO", [110, 101, 112, 125, 101, 101, 101, 101]);
    const [gto] = driverPerformance(chart([fast, slow]), {} as any);
    const row = gto.rows.find((r) => r.carKey === "2")!;
    expect(row.shown.every((s) => s.t === 101)).toBe(true);
    expect(row.shown.length).toBe(4);
  });

  it("counts passes and clear air from the line crossings", () => {
    // A crosses at 100, 200, 300.2, 400.3. C's lap 2 (60 → 220) spans A's lap 2 (100 → 200): passed.
    // D crosses 1 s ahead of A at 299: A's lap 4 starts in traffic; lap 2 is in clear air.
    const a = car(1, "GTO", [100, 100, 100.2, 100.1]);
    const c = car(2, "GP1", [60, 160, 160]);
    const d = car(3, "GP1", [149.5, 149.5]);
    const reports = driverPerformance(chart([a, c, d]), {} as any);
    const row = reports.find((r) => r.cls === "GTO")!.rows[0];
    expect(row.overtakes).toBe(1);
    expect(row.shown.map((s) => [s.l, s.clear])).toEqual([
      [2, true],
      [4, false],
    ]);
    expect(row.clearAirPct).toBe(50);
  });
});

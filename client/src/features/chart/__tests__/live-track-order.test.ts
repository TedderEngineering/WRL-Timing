import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import { stintLaps, trackOrder } from "../LiveTrackOrder";

describe("the live running order", () => {
  // A 6000 m lap at 40 m/s (150 s laps). The focus car (65) is 1000 m past the line.
  const places = [
    { key: 65, d: 1000, inPit: false },
    { key: 80, d: 988, inPit: false }, // 12 m behind: +0.3 s
    { key: 36, d: 1136, inPit: false }, // 136 m ahead: −3.4 s
    { key: 40, d: 2204, inPit: false }, // 1204 m ahead: −30.1 s
    { key: 13, d: 5000, inPit: false }, // 2000 m behind (across the line): +50.0 s
    { key: 9, d: 3900, inPit: false }, // 2900 m ahead: −72.5 s (within half a lap)
    { key: 52, d: 300, inPit: true }, // in the pit lane
  ];

  it("lists the cars ahead on the road (−) to behind (+) from the focus car, the pit lane last", () => {
    const rows = trackOrder(places, 65, 6000, 40);
    expect(rows.map((r) => r.key)).toEqual([9, 40, 36, 65, 80, 13, 52]);
    expect(rows.map((r) => (r.gapS === null ? null : Number(r.gapS.toFixed(1))))).toEqual([-72.5, -30.1, -3.4, 0, 0.3, 50, null]);
    expect(rows.find((r) => r.key === 65)?.isRef).toBe(true);
    expect(rows.find((r) => r.key === 52)?.inPit).toBe(true);
  });

  it("folds the lap: a car just past half a lap ahead is behind", () => {
    const rows = trackOrder([{ key: 1, d: 0, inPit: false }, { key: 2, d: 3100, inPit: false }], 1, 6000, 40);
    expect(rows.map((r) => r.key)).toEqual([1, 2]);
    expect(Number(rows[1].gapS!.toFixed(1))).toBe(72.5);
  });

  it("is empty without the focus car on the map", () => {
    expect(trackOrder(places, 999, 6000, 40)).toEqual([]);
  });

  it("counts the stint from the last stop", () => {
    const data = { cars: { "65": { laps: [1, 2, 3, 4, 5].map((l) => ({ l, pit: l === 2 ? 1 : 0 })) } } } as unknown as RaceChartData;
    expect(stintLaps(data, 65)).toBe(3);
  });
});

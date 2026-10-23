import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import { gainPerLap, leaderOrder, leaderRef, stintLaps, trackOrder } from "../LiveTrackOrder";

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

  it("says how much a lap the focus car is gaining (+) or losing (−) to a car, over each one's last green laps", () => {
    const run = (sec: number) => Array.from({ length: 10 }, (_, i) => ({ l: i + 1, p: 1, cp: 1, lt: "", ltSec: i === 0 ? 200 : sec, flag: "GREEN", pit: 0 }));
    const d = {
      maxLap: 10, totalCars: 3, greenPaceCutoff: 180, fcy: [],
      cars: { "1": { laps: run(140) }, "2": { laps: run(140.8) }, "3": { laps: run(139.5) }, "4": { laps: [] } },
    } as unknown as RaceChartData;
    expect(gainPerLap(d, 1, 2)).toBeCloseTo(0.8, 6); // gaining on the slower car
    expect(gainPerLap(d, 1, 3)).toBeCloseTo(-0.5, 6); // losing to the quicker one
    expect(gainPerLap(d, 1, 4)).toBeNull();
  });
});

describe("the live crossing order from the leader", () => {
  // A 6000 m lap at 40 m/s. Running order: 40 leads, then 36, 65, 80, 13; 52 is in the pits.
  const place = (k: number) => ({ 40: 1, 36: 2, 65: 3, 80: 4, 13: 5, 52: 6 })[k] ?? 0;
  const places = [
    { key: 65, d: 1000, inPit: false },
    { key: 80, d: 988, inPit: false },
    { key: 36, d: 1136, inPit: false },
    { key: 40, d: 2200, inPit: false },
    { key: 13, d: 5000, inPit: false },
    { key: 52, d: 0, inPit: true },
  ];

  it("puts the leader on top, then every car behind it on the road over the whole lap, the pit lane last", () => {
    const rows = leaderOrder(places, 40, place, 6000, 40);
    expect(rows.map((r) => r.key)).toEqual([40, 36, 65, 80, 13, 52]);
    // 36 is 1064 m behind (26.6 s); 13 is 3200 m behind, past half a lap (80.0 s).
    expect(rows.map((r) => (r.gapS === null ? null : Number(r.gapS.toFixed(1))))).toEqual([0, 26.6, 30, 30.3, 80, null]);
    expect(rows[0].isRef).toBe(true);
  });

  it("keeps the leader on top in the pits, measured from the best-placed car on track", () => {
    const inPits = places.map((p) => (p.key === 40 ? { ...p, inPit: true } : p));
    expect(leaderRef(inPits, 40, place)).toBe(36);
    const rows = leaderOrder(inPits, 40, place, 6000, 40);
    // From 36 (1136 m): 65 136 m behind, 80 148 m, 13 2136 m; the leader pinned on top, 52 in the pits last.
    expect(rows.map((r) => r.key)).toEqual([40, 36, 65, 80, 13, 52]);
    expect(rows[0]).toMatchObject({ key: 40, inPit: true, gapS: null });
    expect(rows[1]).toMatchObject({ key: 36, isRef: true, gapS: 0 });
  });
});

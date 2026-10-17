import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import { clockText, longStopNotes, longStops, longStopText } from "../long-stops";

/** One car with `n` 141 s laps; `over` replaces lap times (and flags) by lap number. */
function race(n: number, over: Record<number, { ltSec: number; pit?: number; flag?: string }>, fcy: [number, number][] = []): RaceChartData {
  const laps = Array.from({ length: n }, (_, i) => {
    const l = i + 1;
    const o = over[l];
    return { l, p: 1, cp: 1, lt: "", ltSec: o?.ltSec ?? 141, flag: o?.flag ?? "GREEN", pit: o?.pit ?? 0, spd: 0 };
  });
  return {
    maxLap: n,
    totalCars: 1,
    greenPaceCutoff: 204,
    cars: { "282": { num: 282, team: "T", cls: "GTO", finishPos: 1, finishPosClass: 1, laps } },
    fcy,
    classGroups: {},
    classCarCounts: {},
  } as unknown as RaceChartData;
}

describe("longStops", () => {
  it("finds a garage lap the timing did not mark as a pit lap", () => {
    // #282 at Sebring: lap 66 the pit lap (4:12), lap 67 1:40:41.355 with no pit mark.
    const d = race(71, { 66: { ltSec: 252.044, pit: 1 }, 67: { ltSec: 6041.355 }, 68: { ltSec: 169.868 } });
    const s = longStops(d, 282);
    expect(s.map((x) => x.lap)).toEqual([67]);
    expect(longStopText(s[0])).toBe("Lap 67: 1:40:41, about 42 laps lost");
  });
  it("leaves out an ordinary pit stop", () => {
    expect(longStops(race(20, { 10: { ltSec: 252, pit: 1 } }), 282)).toEqual([]);
  });
  it("leaves out laps under a caution or a red flag", () => {
    expect(longStops(race(20, { 8: { ltSec: 1500 } }, [[8, 8]]), 282)).toEqual([]);
    expect(longStops(race(20, { 9: { ltSec: 1500, flag: "RED" } }), 282)).toEqual([]);
  });
  it("counts a long pit lap too", () => {
    const s = longStops(race(20, { 10: { ltSec: 141 + 600, pit: 1 } }), 282);
    expect(s.map((x) => longStopText(x))).toEqual(["Lap 10: 12:21, about 4 laps lost"]);
  });
});

describe("clockText", () => {
  it("writes hours only when there are some", () => {
    expect(clockText(6041.355)).toBe("1:40:41");
    expect(clockText(450.3)).toBe("7:30");
  });
});

describe("longStopNotes", () => {
  it("keeps the three longest stops in lap order and sums the rest", () => {
    const d = race(60, { 5: { ltSec: 141 + 600 }, 10: { ltSec: 141 + 3000 }, 20: { ltSec: 141 + 900 }, 30: { ltSec: 141 + 1500 }, 40: { ltSec: 141 + 423 } });
    expect(longStopNotes(longStops(d, 282))).toEqual([
      "Lap 10: 52:21, about 21 laps lost",
      "Lap 20: 17:21, about 6 laps lost",
      "Lap 30: 27:21, about 11 laps lost",
      "+2 more stops, about 7 laps lost",
    ]);
  });
});

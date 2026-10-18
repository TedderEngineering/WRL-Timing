import { describe, expect, it } from "vitest";
import type { CarData, RaceChartData } from "@shared/types";
import { LONG_STAY_MS, pitRows } from "../PitList";
import { spanText } from "../RunningOrder";
import { pitVisitsNow } from "../TrackMap";

describe("the cars in the pits, with running timers", () => {
  const now = 10_000_000;
  const visit = (msIn: number | null) => ({ since: msIn === null ? null : now - msIn, afterLap: 100 });

  it("lists cars making a stop first (shortest in first), then long stays, then those with no known entry", () => {
    const pits = new Map([
      [97, visit(2 * 3600_000)], // in the garage for two hours
      [48, visit(42_000)],
      [127, visit(null)],
      [282, visit(95_000)],
    ]);
    expect(pitRows(pits, now).map((r) => [r.key, r.ms, r.long])).toEqual([
      [48, 42_000, false],
      [282, 95_000, false],
      [97, 2 * 3600_000, true],
      [127, null, false],
    ]);
    expect(LONG_STAY_MS).toBe(600_000);
  });

  it("writes times in the pits as M:SS, and H:MM:SS from an hour", () => {
    expect(spanText(42_000)).toBe("0:42");
    expect(spanText(12 * 60_000 + 5_000)).toBe("12:05");
    expect(spanText(2 * 3600_000 + 3 * 60_000 + 9_000)).toBe("2:03:09");
  });

  it("takes the server's pit timer over what the page saw (it watched every car go in)", () => {
    const car: CarData = { num: 48, team: "T", cls: "GP1", finishPos: 13, finishPosClass: 4, laps: [{ l: 130, p: 13, cp: 4, lt: "", ltSec: 150, flag: "GF", pit: 0 }] };
    const data = { maxLap: 130, totalCars: 1, greenPaceCutoff: 0, cars: { "48": car }, fcy: [], classGroups: {}, classCarCounts: {} } as RaceChartData;
    // Already in when the page opened: unknown to the page, known to the server.
    expect(pitVisitsNow(new Map(), ["48"], data, null).get(48)?.since).toBeNull();
    expect(pitVisitsNow(new Map(), ["48"], data, null, () => 5_000).get(48)).toEqual({ since: 5_000, afterLap: 130 });
  });
});

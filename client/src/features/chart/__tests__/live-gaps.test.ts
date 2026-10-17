import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import { gapBehind, gapClock, gapRows, latestCrossing, leaderGaps, nextEvent, paceOf } from "../live-gaps";

/** A car with `n` laps of `lt` seconds (lap 1 offset by `start`), in position `pos`. */
function car(num: number, n: number, lt: number, pos: number, opts: { start?: number; pitLap?: number; cls?: string } = {}) {
  return {
    num,
    team: `Team ${num}`,
    cls: opts.cls ?? "GTO",
    finishPos: pos,
    finishPosClass: pos,
    laps: Array.from({ length: n }, (_, i) => {
      const l = i + 1;
      const t = (l === 1 ? (opts.start ?? 0) : 0) + lt + (l === opts.pitLap ? 120 : 0);
      return { l, p: pos, cp: pos, lt: "", ltSec: t, flag: "GREEN", pit: l === opts.pitLap ? 1 : 0, spd: 0 };
    }),
  };
}

function race(cars: ReturnType<typeof car>[]): RaceChartData {
  return {
    maxLap: Math.max(...cars.map((c) => c.laps.length)),
    totalCars: cars.length,
    greenPaceCutoff: 200,
    cars: Object.fromEntries(cars.map((c) => [String(c.num), c])),
    fcy: [],
    classGroups: {},
    classCarCounts: {},
  } as unknown as RaceChartData;
}

describe("paceOf", () => {
  it("takes the median of the last green laps, leaving out pit laps", () => {
    const d = race([car(1, 10, 100, 1, { pitLap: 9 })]);
    expect(paceOf(d.cars["1"].laps, d)).toBe(100);
  });
  it("needs three green laps", () => {
    const d = race([car(1, 2, 100, 1)]);
    expect(paceOf(d.cars["1"].laps, d)).toBeNull();
  });
});

describe("nextEvent", () => {
  it("names the next whole-lap boundary", () => {
    expect(nextEvent(-0.2, 0.01)).toEqual({ event: "pass", laps: 20, k: 0 });
    expect(nextEvent(0.5, 0.01)?.event).toBe("laps");
    expect(nextEvent(0.2, -0.01)).toEqual({ event: "passed", laps: 20, k: 0 });
    expect(nextEvent(-0.5, -0.01)?.event).toBe("lapped");
    expect(nextEvent(-1.5, 0.01)?.event).toBe("unlap");
    expect(nextEvent(1.5, -0.01)?.event).toBe("unlapped");
  });
  it("leaves out projections too far away", () => {
    expect(nextEvent(-0.5, 0.0001)).toBeNull();
  });
});

describe("gapRows", () => {
  it("projects when a faster focus car catches the car ahead", () => {
    // Focus #2 laps in 99 s and is 10 s behind #1 (100 s laps), both on lap 10.
    const d = race([car(1, 10, 100, 1), car(2, 10, 99, 2, { start: 20 })]);
    const r = gapRows(d, 2, [1]).find((x) => x.num === 1)!;
    expect(r.gapSec).toBeCloseTo(-10, 6); // #1 is 10 s ahead
    expect(r.gainPerLap).toBeCloseTo(1, 6); // the focus car gains 1 s a lap
    expect(r.next?.event).toBe("pass");
    // 10 s closed at 1 s a lap: 10 laps.
    expect(r.next?.laps).toBeCloseTo(10, 6);
  });

  it("projects the focus car going a lap down to a faster car", () => {
    // Leader #1 laps in 95 s, focus #2 in 100 s; both on lap 18, #1 30 s up the road.
    const d = race([car(1, 18, 95, 1, { start: 60 }), car(2, 18, 100, 2)]);
    const r = gapRows(d, 2, [1]).find((x) => x.num === 1)!;
    expect(r.gainPerLap).toBeCloseTo(-5, 6);
    expect(r.next?.event).toBe("lapped");
    expect(r.next?.k).toBe(-1);
    // #1 needs the rest of a lap on the road: (1 − 30/95) laps at 5/95 laps a lap ≈ 13 laps.
    expect(r.next?.laps).toBeCloseTo((1 - 30 / 95) / (1 - 100 / 95) * -1, 6);
  });

  it("does not project for a car stopped in the pits", () => {
    // #1's last crossing is 4 laps of pace before the focus car's.
    const d = race([car(1, 6, 100, 1), car(2, 10, 100, 2)]);
    const r = gapRows(d, 2, [1]).find((x) => x.num === 1)!;
    expect(r.stopped).toBe(true);
    expect(r.next).toBeNull();
  });

  it("reports last and best laps without pit laps, sorted by position", () => {
    const d = race([car(3, 10, 101, 3, { pitLap: 5 }), car(1, 10, 100, 1), car(2, 10, 102, 2)]);
    const rows = gapRows(d, 2, [1, 3]);
    expect(rows.map((x) => x.num)).toEqual([1, 2, 3]);
    expect(rows[2].best).toBe(101);
    expect(rows[1].isFocus).toBe(true);
  });

  it("calls a tiny pace difference steady", () => {
    const d = race([car(1, 10, 100, 1), car(2, 10, 100.01, 2, { start: 5 })]);
    expect(gapRows(d, 2, [1]).find((x) => x.num === 1)!.next).toBeNull();
  });
});

describe("leaderGaps", () => {
  it("gives laps and seconds behind the overall and class leaders", () => {
    // Leader #1 laps in 100 s; focus #3 (GTU) in 104 s: after 20 laps #1 is 80 s and ~0.8 lap up the road.
    const d = race([car(1, 20, 100, 1), car(2, 20, 102, 2, { cls: "GTU" }), car(3, 20, 104, 3, { cls: "GTU" })]);
    d.cars["2"].finishPosClass = 1;
    d.cars["3"].finishPosClass = 2;
    const g = leaderGaps(d, 3);
    // At #3's last crossing (2080 s), #1 is 80 s into lap 21: 0.8 laps on, so 0.8 laps ahead.
    expect(g.overall?.laps).toBeCloseTo(0.8, 6);
    expect(g.overall?.sec).toBeCloseTo(0.8 * 104, 6);
    expect(g.cls?.leader).toBe(2);
    expect(g.cls?.laps).toBeCloseTo(40 / 102, 6);
    expect(g.clsName).toBe("GTU");
  });
  it("counts laps and the part of a lap when the leader is laps ahead", () => {
    // Leader: 22 laps of 100 s (2200 s). Focus: 20 laps of 105 s (2100 s), 100 s into lap 21.
    const d = race([car(1, 22, 100, 1), car(2, 20, 105, 2)]);
    expect(leaderGaps(d, 2).overall?.laps).toBeCloseTo(22 - (20 + 100 / 105), 6);
  });
  it("holds a car in the pits where it stopped, so the leader's gap grows", () => {
    // Focus #2's last crossing was 4 laps of pace before the leader's: it is stopped.
    const d = race([car(1, 10, 100, 1), car(2, 6, 100, 2)]);
    expect(leaderGaps(d, 2).overall?.laps).toBeCloseTo(10 - 6.999, 6);
  });
  it("is empty for the leader itself", () => {
    const d = race([car(1, 20, 100, 1), car(2, 20, 101, 2)]);
    expect(leaderGaps(d, 1).overall).toBeNull();
  });
  it("formats seconds", () => {
    expect(gapClock(56.24)).toBe("56.2 s");
    expect(gapClock(211)).toBe("3:31");
    expect(gapClock(3725)).toBe("1:02:05");
  });
});

describe("between updates (extrapolation)", () => {
  // Focus #2 laps in 99 s, 10 s behind #1 (100 s laps), both just completed lap 10.
  const d = race([car(1, 10, 100, 1), car(2, 10, 99, 2, { start: 20 })]);
  const at0 = latestCrossing(d); // 1010: #2's crossing

  it("is the last crossings' gap with no time passed", () => {
    expect(gapRows(d, 2, [1], at0).find((r) => r.num === 1)!.gapSec).toBeCloseTo(-10, 6);
  });

  it("closes the gap by the pace difference as time passes", () => {
    // 49.5 s later (half a focus lap): 0.5 s closed.
    const r = gapRows(d, 2, [1], at0 + 49.5).find((x) => x.num === 1)!;
    expect(r.gapSec).toBeCloseTo(-9.5, 6);
    expect(r.next?.laps).toBeLessThan(gapRows(d, 2, [1]).find((x) => x.num === 1)!.next!.laps);
  });

  it("moves the gap to the leader on too", () => {
    const before = gapBehind(d, 2, 1, at0)!.laps;
    const after = gapBehind(d, 2, 1, at0 + 49.5)!.laps;
    expect(after).toBeLessThan(before);
  });

  it("finds the moment the data describes", () => {
    expect(latestCrossing(d)).toBeCloseTo(20 + 990, 6);
  });
});

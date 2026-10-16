import { describe, expect, it } from "vitest";
import type { CarData, LapData, RaceChartData } from "@shared/types";
import {
  crossingTimes,
  gapRate,
  gapSeries,
  niceTicks,
  relativeTo,
  resolveTarget,
  stintStart,
  windowStart,
} from "../gap-math";
import { compare } from "../HeadToHeadPanel";

interface Spec {
  num: number;
  cls?: string;
  /** Lap times in seconds, lap 1 first. */
  times: number[];
  pits?: number[];
  /** Positions per lap: [overall, class]. */
  pos?: [number, number][];
  /** Start clock (seconds from midnight) to also give crossing times. */
  clock?: number;
}

function race(specs: Spec[], fcy: [number, number][] = []): RaceChartData {
  const cars: Record<string, CarData> = {};
  for (const s of specs) {
    let t = s.clock ?? 0;
    const laps: LapData[] = s.times.map((lt, i) => {
      t += lt;
      const l = i + 1;
      const caution = fcy.some(([a, b]) => l >= a && l <= b);
      return {
        l,
        p: s.pos?.[i]?.[0] ?? 0,
        cp: s.pos?.[i]?.[1] ?? 0,
        lt: "",
        ltSec: lt,
        flag: caution ? "FCY" : "GF",
        pit: s.pits?.includes(l) ? 1 : 0,
        ...(s.clock !== undefined ? { hr: t % 86400 } : {}),
      };
    });
    cars[String(s.num)] = { num: s.num, team: `Team ${s.num}`, cls: s.cls ?? "GS", finishPos: 0, finishPosClass: 0, laps };
  }
  const classGroups: Record<string, number[]> = {};
  for (const s of specs) (classGroups[s.cls ?? "GS"] ??= []).push(s.num);
  return {
    maxLap: Math.max(...specs.map((s) => s.times.length)),
    totalCars: specs.length,
    greenPaceCutoff: 200,
    cars,
    fcy,
    classGroups,
    classCarCounts: Object.fromEntries(Object.entries(classGroups).map(([k, v]) => [k, v.length])),
  };
}

const rep = (n: number, v: number) => Array.from({ length: n }, () => v);

describe("crossingTimes", () => {
  it("adds up lap times when the source has no clock", () => {
    const d = race([{ num: 1, times: [100, 90, 91] }]);
    expect([...crossingTimes(d, 1).values()]).toEqual([100, 190, 281]);
  });

  it("uses crossing clock times and carries over midnight", () => {
    const d = race([{ num: 1, times: [100, 100, 100], clock: 86400 - 150 }]);
    // 23:59:10 → crossings at 86350, 50 (+1 day), 150 (+1 day)
    expect([...crossingTimes(d, 1).values()]).toEqual([86350, 86450, 86550]);
  });
});

describe("gapSeries", () => {
  it("is the difference in crossing times, and leaves stops and cautions out of the rate", () => {
    // #2 laps 0.3 s quicker every lap; #1 pits on lap 5 (in-lap) so lap 6 is its out-lap.
    const d = race(
      [
        { num: 1, times: [90, 90, 90, 90, 150, 110, 90, 90, 90, 90] , pits: [5] },
        { num: 2, times: rep(10, 89.7) },
      ],
      [[8, 8]],
    );
    const rows = gapSeries(d, 1, [2], 1, 10);
    expect(rows[0].gap).toBeCloseTo(0.3);
    expect(rows[9].gap).toBeCloseTo(3 + 60 + 20);
    expect(rows.filter((r) => r.clean).map((r) => r.lap)).toEqual([1, 2, 3, 4, 7, 9, 10]);
    expect(rows[7].caution).toBe(true);
    expect(gapRate(rows, 5)!.rate).toBeCloseTo(0.3);
  });

  it("against a group, keeps moving smoothly when a car in it stops running", () => {
    const d = race([
      { num: 1, times: rep(6, 90) },
      { num: 2, times: rep(6, 91) },
      { num: 3, times: rep(3, 89) }, // retires after lap 3
    ]);
    const rows = gapSeries(d, 1, [2, 3], 1, 6);
    expect(rows.map((r) => Number(r.gap!.toFixed(2)))).toEqual([0, 0, 0, -1, -2, -3]);
  });
});

describe("resolveTarget", () => {
  const d = race([
    { num: 10, times: rep(3, 90), pos: rep(3, 0).map(() => [1, 1] as [number, number]) },
    { num: 20, times: rep(3, 91), pos: rep(3, 0).map(() => [2, 2] as [number, number]) },
    { num: 30, times: rep(3, 92), pos: rep(3, 0).map(() => [3, 3] as [number, number]) },
    { num: 40, cls: "TCR", times: rep(3, 95), pos: rep(3, 0).map(() => [4, 1] as [number, number]) },
  ]);

  it("finds the cars around the focus car in its class at the lap", () => {
    expect(resolveTarget(d, 20, "ahead", 3)?.cars).toEqual([10]);
    expect(resolveTarget(d, 20, "behind", 3)?.cars).toEqual([30]);
    expect(resolveTarget(d, 30, "classLeader", 3)?.cars).toEqual([10]);
    expect(resolveTarget(d, 40, "leader", 3)?.cars).toEqual([10]);
  });

  it("has no car ahead for the class leader, and averages leave the focus car out", () => {
    expect(resolveTarget(d, 10, "ahead", 3)).toBeNull();
    expect(resolveTarget(d, 10, "classAvg", 3)?.cars).toEqual([20, 30]);
    expect(resolveTarget(d, 10, "classAvg", 3)?.name).toBe("GS class average");
    expect(resolveTarget(d, 10, "chartAvg", 3, { compSet: new Set([10, 40]) })?.cars).toEqual([40]);
  });
});

describe("relativeTo", () => {
  it("gives seconds on the same lap and whole laps otherwise", () => {
    const d = race([
      { num: 1, times: rep(10, 100) },
      { num: 2, times: rep(10, 98) },
      { num: 3, times: rep(10, 120) },
    ]);
    expect(relativeTo(d, 1, 2, 5)).toEqual({ laps: 0, sec: -10 });
    // After 10 laps #3 is 200 s back: more than a lap of its own.
    expect(relativeTo(d, 1, 3, 10)).toEqual({ laps: 1, sec: null });
    // From #3's side, #1 is a lap ahead.
    expect(relativeTo(d, 3, 1, 9).laps).toBe(-1);
  });
});

describe("windows", () => {
  const d = race([{ num: 1, times: rep(30, 90), pits: [12, 25] }]);
  it("starts the stint after the last stop", () => {
    expect(stintStart(d, 1, 20)).toBe(13);
    expect(windowStart(d, 1, 20, "stint", 10)).toBe(13);
    expect(windowStart(d, 1, 20, "recent", 10)).toBe(11);
    expect(windowStart(d, 1, 20, "race", 10)).toBe(1);
    // Right after a stop the stint is too short: show the recent laps.
    expect(windowStart(d, 1, 26, "stint", 10)).toBe(17);
  });
});

describe("compare (head-to-head)", () => {
  it("counts only laps both cars ran clean", () => {
    const d = race([
      { num: 1, times: [90, 90.2, 90, 150, 95, 90.1], pits: [4] },
      { num: 2, times: [90.1, 90, 90, 90, 90, 90] },
    ]);
    const c = compare(d, 1, 2, 1, 6);
    expect(c.compared).toBe(4); // laps 1, 2, 3, 6
    expect(c.rivalQuicker).toBe(2); // laps 2 and 6
    expect(c.bestMine).toBe(90);
    expect(c.avgDelta).toBeCloseTo((-0.1 + 0.2 + 0 + 0.1) / 4);
  });
});

describe("niceTicks", () => {
  it("covers the range in round steps", () => {
    expect(niceTicks(0, 14.2, 3)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(-3, 2, 3)).toEqual([-4, -2, 0, 2]);
  });
});

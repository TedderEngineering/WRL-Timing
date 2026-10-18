import { describe, expect, it } from "vitest";
import type { CarData, PitMarker, RaceChartData } from "@shared/types";
import { classBestStat, classBests, classColor, lapStat, lapText, lapTimes, nextLapStat, pitDetail, runningOrder, spanText } from "../RunningOrder";
import { overallLeader, pitVisitsNow } from "../TrackMap";
import { CLASS_COLORS } from "../constants";

const car = (num: number, cls: string, finishPos: number, finishPosClass: number, label?: string): CarData => ({
  num,
  label,
  team: `Team ${num}`,
  cls,
  finishPos,
  finishPosClass,
  laps: [],
});

const chart = (cars: CarData[]): RaceChartData => ({
  maxLap: 10,
  totalCars: cars.length,
  greenPaceCutoff: 0,
  cars: Object.fromEntries(cars.map((c) => [String(c.num), c])),
  fcy: [],
  classGroups: {},
  classCarCounts: {},
});

describe("runningOrder", () => {
  it("lists cars by their position now, with class position and class", () => {
    const rows = runningOrder(chart([car(282, "GTO", 3, 2), car(119, "GP1", 1, 1), car(5, "GTO", 2, 1)]));
    expect(rows.map((r) => [r.pos, r.key, r.cls, r.posClass])).toEqual([
      [1, 119, "GP1", 1],
      [2, 5, "GTO", 1],
      [3, 282, "GTO", 2],
    ]);
  });

  it("puts cars without a position yet last, by car number, with no positions shown", () => {
    const rows = runningOrder(chart([car(51, "GTU", 0, 0), car(9, "GP2", 0, 0), car(2, "GP1", 1, 1)]));
    expect(rows.map((r) => r.key)).toEqual([2, 9, 51]);
    expect(rows[1]).toMatchObject({ pos: null, posClass: null });
  });

  it("orders unplaced cars by the published number", () => {
    const rows = runningOrder(chart([car(1007, "GTO", 0, 0, "007"), car(8, "GTO", 0, 0)]));
    expect(rows.map((r) => r.key)).toEqual([1007, 8]);
  });
});

describe("classColor", () => {
  it("uses each class's own colour, grey for any other", () => {
    expect(classColor("GTO")).toBe(CLASS_COLORS.GTO);
    expect(classColor("XYZ")).toBe("#9a9ab4");
  });
});

const lap = (l: number, ltSec: number, pit = 0) => ({ l, p: 1, cp: 1, lt: "", ltSec, flag: "GF", pit });
const marker = (l: number): PitMarker => ({ l, lb: "", c: "", yo: 0, da: 0 });

describe("lap times", () => {
  it("gives the last completed lap and the best", () => {
    const c = car(5, "GTO", 1, 1);
    c.laps = [lap(1, 130.2), lap(2, 121.5), lap(3, 124.75)];
    expect(lapTimes(c)).toEqual({ last: 124.75, best: 121.5 });
    expect(lapTimes(car(6, "GTO", 2, 2))).toEqual({ last: null, best: null });
  });

  it("finds each class's best lap", () => {
    const a = car(1, "GTO", 1, 1);
    a.laps = [lap(1, 122)];
    const b = car(2, "GTO", 2, 2);
    b.laps = [lap(1, 121.4)];
    const d = car(3, "GP1", 3, 1);
    d.laps = [lap(1, 118)];
    expect(Object.fromEntries(classBests(chart([a, b, d])))).toEqual({ GTO: 121.4, GP1: 118 });
  });

  it("writes lap times as M:SS.mmm and spans as M:SS", () => {
    expect(lapText(121.5)).toBe("2:01.500");
    expect(lapText(59.04)).toBe("0:59.040");
    expect(lapText(null)).toBe("–");
    expect(spanText(83_400)).toBe("1:23");
  });
});

describe("pitDetail", () => {
  const now = 1_000_000;
  it("calls it the next stop when the timing has not recorded it yet", () => {
    expect(pitDetail([marker(20), marker(44)], { since: now - 48_000, afterLap: 70 }, now)).toBe(
      "Stop 3 · 0:48 in the lane · in after lap 70 · 26-lap stint"
    );
  });

  it("uses the stop the in-lap already recorded", () => {
    expect(pitDetail([marker(20), marker(70)], { since: null, afterLap: 70 }, now)).toBe("Stop 2 · in after lap 70 · 50-lap stint");
  });

  it("counts the first stint from the start", () => {
    expect(pitDetail(undefined, { since: now, afterLap: 31 }, now)).toBe("Stop 1 · 0:00 in the lane · in after lap 31 · 31-lap stint");
  });
});

describe("pitVisitsNow", () => {
  const c = car(282, "GTO", 4, 3);
  c.laps = [lap(1, 125), lap(2, 124)];
  const data = chart([c, car(5, "GTO", 1, 1)]);

  it("times a car from when it goes in, and keeps that while it stays", () => {
    const first = pitVisitsNow(new Map(), ["282"], data, 5_000);
    expect(first.get(282)).toEqual({ since: 5_000, afterLap: 2 });
    expect(pitVisitsNow(first, ["282"], data, 10_000).get(282)).toEqual({ since: 5_000, afterLap: 2 });
  });

  it("does not time a car already in the pits at the first reading, and drops a car once out", () => {
    const first = pitVisitsNow(new Map(), ["282", "999"], data, null);
    expect([...first.keys()]).toEqual([282]);
    expect(first.get(282)?.since).toBeNull();
    expect(pitVisitsNow(first, [], data, 10_000).size).toBe(0);
  });
});

describe("overallLeader", () => {
  it("is the car the timing has first now", () => {
    expect(overallLeader(chart([car(282, "GTO", 2, 1), car(776, "GTO", 1, 1)]))).toBe(776);
  });
  it("is none before the timing gives positions", () => {
    expect(overallLeader(chart([car(282, "GTO", 0, 0)]))).toBeNull();
  });
});

describe("Best column cycle: best, 10-lap, stint and race averages", () => {
  it("cycles best → 10-lap avg → stint avg → race avg → best", () => {
    expect(nextLapStat("best")).toBe("avg10");
    expect(nextLapStat("avg10")).toBe("stint");
    expect(nextLapStat("stint")).toBe("race");
    expect(nextLapStat("race")).toBe("best");
  });

  // Laps 1-12 green; lap 13 a pit lap, 14 the out-lap, 15-16 green; lap 17 under caution.
  const c = car(5, "GTO", 1, 1);
  c.laps = [
    ...Array.from({ length: 12 }, (_, i) => lap(i + 1, 120 + i)),
    lap(13, 200, 1),
    lap(14, 150),
    lap(15, 118),
    lap(16, 122),
    { ...lap(17, 170), flag: "FCY" },
  ];
  const data = chart([c]);

  it("averages green laps only: no pit lap, out-lap or caution lap", () => {
    // The last 10 green laps are laps 5-12 and 15-16.
    const last10 = [124, 125, 126, 127, 128, 129, 130, 131, 118, 122];
    expect(lapStat(data, c, "avg10")).toBeCloseTo(last10.reduce((a, b) => a + b) / 10, 6);
    expect(lapStat(data, c, "stint")).toBeCloseTo(120, 6);
    const all = [...Array.from({ length: 12 }, (_, i) => 120 + i), 118, 122];
    expect(lapStat(data, c, "race")).toBeCloseTo(all.reduce((a, b) => a + b) / all.length, 6);
    expect(lapStat(data, c, "best")).toBe(118);
  });

  it("has no stint average before a green lap after the stop, and nothing before any lap", () => {
    const d = car(6, "GTO", 2, 2);
    d.laps = [lap(1, 121), lap(2, 200, 1), lap(3, 150)];
    expect(lapStat(chart([d]), d, "stint")).toBeNull();
    expect(lapStat(chart([d]), d, "avg10")).toBe(121);
    expect(lapStat(chart([car(7, "GTO", 3, 3)]), undefined, "race")).toBeNull();
  });

  it("marks each class's quickest value of the column", () => {
    const a = car(1, "GTO", 1, 1);
    a.laps = [lap(1, 121), lap(2, 125)];
    const b = car(2, "GTO", 2, 2);
    b.laps = [lap(1, 120), lap(2, 130)];
    const both = chart([a, b]);
    expect(classBestStat(both, "best").get("GTO")).toBe(120);
    expect(classBestStat(both, "race").get("GTO")).toBe(123);
  });
});

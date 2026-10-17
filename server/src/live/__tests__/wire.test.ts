/**
 * RaceTrace Live wire format and 5-second updates: compact rows, deltas,
 * state laps merged between full reloads. Synthetic data; no network.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { annDiff, encodeDelta, encodeFull, LAP_TIME_CASES, lapPrefixes, lapTimeText, rowEncoding, summarize } from "../wire.js";
import { mergeStateLaps } from "../poller.js";
import { lapRowFromState } from "../build.js";
import type { RaceDataJson } from "../../utils/race-validators.js";
import type { FeedLap } from "../feed.js";

type Lap = RaceDataJson["cars"][string]["laps"][number];

const lap = (l: number, ltSec: number, extra: Partial<Lap> = {}): Lap =>
  ({ l, p: 1, cp: 1, lt: lapTimeText(ltSec), ltSec, flag: "GREEN", pit: 0, spd: 0, ...extra }) as Lap;

function chart(lapsBy: Record<string, Lap[]>): RaceDataJson {
  const cars: RaceDataJson["cars"] = {};
  let pos = 1;
  for (const [n, laps] of Object.entries(lapsBy)) cars[n] = { num: Number(n), team: `Team ${n}`, cls: "GTO", finishPos: pos, finishPosClass: pos++, laps } as RaceDataJson["cars"][string];
  return { maxLap: Math.max(...Object.values(lapsBy).map((l) => l.length)), totalCars: Object.keys(cars).length, greenPaceCutoff: 200, cars, fcy: [], classGroups: { GTO: Object.keys(cars).map(Number) }, classCarCounts: { GTO: Object.keys(cars).length } };
}

describe("lapTimeText", () => {
  it("matches the shared cases (the phone has the same function)", () => {
    for (const [sec, text] of LAP_TIME_CASES) expect(lapTimeText(sec)).toBe(text);
  });
});

describe("row encoding", () => {
  it("drops lap-time text the phone can rebuild, sends constant columns once, and indexes flag words", () => {
    const laps = [lap(1, 139.637), lap(2, 140.1, { flag: "FCY" }), lap(3, 139.9)];
    const enc = rowEncoding(laps);
    expect(enc.derived).toEqual(["lt"]);
    expect(enc.consts).toMatchObject({ spd: 0, pit: 0 });
    expect(enc.dict.flag).toEqual(["GREEN", "FCY"]);
    expect(enc.cols).not.toContain("lt");
    expect(enc.cols).not.toContain("spd");
  });

  it("keeps lap-time text when any row's differs from the rebuild", () => {
    const enc = rowEncoding([lap(1, 100), { ...lap(2, 100.5), lt: "1:40.50" }]);
    expect(enc.derived).toEqual([]);
    expect(enc.cols).toContain("lt");
  });

  it("is much smaller than the chart JSON", () => {
    const laps = Array.from({ length: 200 }, (_, i) => lap(i + 1, 120 + (i % 7) * 0.137, { p: 1 + (i % 9), cp: 1 + (i % 4), pit: i % 40 === 39 ? 1 : 0 }));
    const d = chart({ "1": laps, "2": laps, "3": laps });
    const full = JSON.stringify(encodeFull(1, d, {}));
    expect(full.length).toBeLessThan(JSON.stringify(d).length * 0.45);
  });
});

describe("deltas", () => {
  const base = chart({ "7": [lap(1, 120), lap(2, 119)], "11": [lap(1, 121)] });
  const baseSummary = summarize(base, { "7": { stops: [] } });

  it("carries only the new laps when earlier laps are unchanged", () => {
    const next = chart({ "7": [lap(1, 120), lap(2, 119), lap(3, 118.5)], "11": [lap(1, 121), lap(2, 120.2)] });
    const d = encodeDelta(1, baseSummary, 2, next, { "7": { stops: [] } });
    expect(d.cars["7"].from).toBe(2);
    expect(d.cars["7"].L).toHaveLength(1);
    expect(d.cars["11"].from).toBe(1);
    expect(d.cars["7"].h).toBeUndefined(); // details unchanged
    expect(d.ann).toEqual({});
    expect(d.total).toBe(5);
  });

  it("resends a car whose earlier lap was corrected, and changed details or markers", () => {
    const next = chart({ "7": [lap(1, 120), lap(2, 119.4), lap(3, 118.5)], "11": [lap(1, 121)] });
    next.cars["11"].finishPos = 1;
    const d = encodeDelta(1, baseSummary, 2, next, { "7": { stops: [1] }, "11": { stops: [] } });
    expect(d.cars["7"].from).toBe(0);
    expect(d.cars["7"].L).toHaveLength(3);
    expect(d.cars["11"].h?.finishPos).toBe(1);
    expect(d.cars["11"].L).toHaveLength(0);
    expect(Object.keys(d.ann).sort()).toEqual(["11", "7"]);
  });

  it("resends a long car from the last matching checkpoint, not lap 1", () => {
    const long = Array.from({ length: 34 }, (_, i) => lap(i + 1, 120 + i * 0.01));
    const b = chart({ "7": long });
    const changed = long.map((l) => (l.l === 33 ? { ...l, pit: 1 } : l));
    const d = encodeDelta(1, summarize(b, {}), 2, chart({ "7": [...changed, lap(35, 121)] }), {});
    expect(d.cars["7"].from).toBe(30);
    expect(d.cars["7"].L).toHaveLength(5);
  });

  it("lists cars and markers that are gone", () => {
    const next = chart({ "7": [lap(1, 120), lap(2, 119)] });
    const d = encodeDelta(1, baseSummary, 2, next, {});
    expect(d.removed).toEqual(["11"]);
    expect(d.annRemoved).toEqual(["7"]);
  });

  it("matches the phone's fixture (client/src/features/chart/__tests__/fixtures/live-wire.json)", () => {
    const next = chart({ "7": [lap(1, 120), lap(2, 119), lap(3, 118.5, { flag: "FCY", pit: 1 })], "11": [lap(1, 121), lap(2, 3723.456)] });
    // #11's pit marker: a cycle average moves (patched); #7's marker set grows (sent whole).
    const pitMarker = (avg: number, delta: number) => ({
      pits: [{ lap: 1, pitTiming: { totalPitLoss: 160.2, cycleComparison: { compAvgTotalPitLoss: avg, deltaTotalLoss: delta, note: "a long note the patch does not repeat. ".repeat(6) } } }],
      reasons: { "1": "Pit stop" },
    });
    const baseAnnotations = { "7": { stops: [] }, "11": pitMarker(157.59, -36.24) };
    const nextAnnotations = { "7": { stops: [3] }, "11": pitMarker(161.5, -40.16) };
    const baseSummary2 = summarize(base, baseAnnotations);
    const fixture = {
      lapTimeCases: LAP_TIME_CASES,
      base,
      baseAnnotations,
      full: encodeFull(1, base, baseAnnotations),
      delta: encodeDelta(1, baseSummary2, 2, next, nextAnnotations, lapPrefixes(next), baseAnnotations),
      next,
      nextAnnotations,
    };
    expect(fixture.delta.annPatch?.["11"]).toHaveLength(2);
    expect(fixture.delta.ann["7"]).toEqual({ stops: [3] });
    const path = new URL("../../../../client/src/features/chart/__tests__/fixtures/live-wire.json", import.meta.url);
    const text = JSON.stringify(fixture, null, 1) + "\n";
    if (process.env.UPDATE_LIVE_WIRE_FIXTURE) writeFileSync(path, text);
    expect(readFileSync(path, "utf-8")).toBe(text);
  });
});

describe("pit-marker patches", () => {
  it("lists only the leaves that changed", () => {
    const a = { pits: [{ t: { avg: 157.5, d: -36.2, n: "same" } }], reasons: { "4": "Pit" }, gone: 1 };
    const b = { pits: [{ t: { avg: 161.5, d: -40.1, n: "same" } }], reasons: { "4": "Pit", "9": "Pass" } };
    expect(annDiff(a, b)).toEqual([
      [["gone"]],
      [["pits", 0, "t", "avg"], 161.5],
      [["pits", 0, "t", "d"], -40.1],
      [["reasons", "9"], "Pass"],
    ]);
  });
  it("replaces an array that changed length", () => {
    expect(annDiff({ s: [1] }, { s: [1, 2] })).toEqual([[["s"], [1, 2]]]);
  });
  it("sends patches instead of the whole marker set when smaller", () => {
    const big = (avg: number) => ({ pits: Array.from({ length: 6 }, (_, i) => ({ lap: i * 30, note: "x".repeat(80), avg })) });
    const b = chart({ "7": [lap(1, 120)] });
    const d = encodeDelta(1, summarize(b, { "7": big(157) }), 2, b, { "7": big(161) }, lapPrefixes(b), { "7": big(157) });
    expect(d.ann).toEqual({});
    expect(d.annPatch?.["7"]).toHaveLength(6);
  });
});

describe("state laps between full reloads", () => {
  const feedLap = (n: string, llp: number): FeedLap => ({ n, llp, ltm: "00:02:00.000", ttm: "00:10:00.000", ovp: 1, clp: 1 });

  it("adds each car's next lap", () => {
    const m = mergeStateLaps([feedLap("7", 1), feedLap("7", 2), feedLap("11", 1)], [feedLap("7", 3), feedLap("11", 1)]);
    expect(m.added).toBe(1);
    expect(m.gap).toBe(false);
    expect(m.laps).toHaveLength(4);
  });

  it("flags a missed lap instead of adding past it", () => {
    const m = mergeStateLaps([feedLap("7", 1)], [feedLap("7", 3)]);
    expect(m.added).toBe(0);
    expect(m.gap).toBe(true);
  });

  it("adds a car's first lap", () => {
    expect(mergeStateLaps([], [feedLap("99", 1)]).added).toBe(1);
  });

  it("reads a lap row from a msgpack car position", () => {
    const x: unknown[] = new Array(60).fill(null);
    x[2] = "7";
    x[4] = "GTO";
    x[13] = "01:10:00.000";
    x[14] = "00:02:01.500";
    x[15] = 34;
    x[20] = 3;
    x[21] = 2;
    x[35] = false;
    x[44] = "Alex Synth";
    expect(lapRowFromState(x)).toEqual({ n: "7", class: "GTO", ttm: "01:10:00.000", ltm: "00:02:01.500", llp: 34, ovp: 3, clp: 2, lip: false, dn: "Alex Synth" });
    x[15] = 0;
    expect(lapRowFromState(x)).toBeNull();
  });
});

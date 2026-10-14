import { describe, expect, it } from "vitest";
import type { LapData, PitMarker, SettleMarker } from "@shared/types";
import { drawPitTags, drawSettleLeaders, settleLabels, surname } from "../pit-band";

const lap = (l: number, p: number, pit = 0, cp = p): LapData => ({ l, p, cp, lt: "1:40.000", ltSec: 100, flag: "GF", pit });
const marker = (l: number, extra: Partial<PitMarker>): PitMarker => ({ l, lb: `Pit ${l} · NAME`, c: "#fff", yo: 0, da: 0, ...extra });

function fakeCtx() {
  const texts: { text: string; x: number; y: number }[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, fillRect() {}, closePath() {}, arc() {}, roundRect() {},
    measureText: (t: string) => ({ width: t.length * 6 }),
    fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

describe("pit tags", () => {
  const pits = [
    marker(1, { lb: "Start · ESTEP", stintNumber: 1 }),
    marker(3, { stintNumber: 2 }),
    marker(6, { stintNumber: 3 }),
    marker(9, { stintNumber: 4 }),
  ];

  it("draws each tag above the plot, the name only, in two lanes so neighbours never overlap", () => {
    const { ctx, texts } = fakeCtx();
    const run = (perLap: number) => {
      texts.length = 0;
      drawPitTags(ctx, {
        markers: pits, x: (l) => 40 + l * perLap, lapStart: 1, lapEnd: 11,
        plotLeft: 40, plotRight: 40 + 11 * perLap, plotTop: 40, plotBottom: 300, band: { tagY: 3, laneH: 15, lanes: 2 }, activeLap: null, background: "#000",
      });
      return texts.map((t) => t.text);
    };
    expect(run(80)).toEqual(["Start · ESTEP", "Pit 3 · NAME", "Pit 6 · NAME", "Pit 9 · NAME"]);
    expect(texts.every((t) => t.y < 40)).toBe(true);
    // Crowded: the second lane is used, then the driver's name gives way before anything overlaps.
    const crowded = run(10);
    expect(new Set(texts.map((t) => t.y)).size).toBe(2);
    expect(crowded.some((t) => t === "Pit 6" || t === "Pit 9")).toBe(true);
  });

  it("keeps surnames short", () => {
    expect(surname("  jane q. estep ")).toBe("ESTEP");
  });
});

describe("pit-cycle leaders", () => {
  // Overall P5 before the cycle (class P2), stop on lap 4, settled overall P12 (class P6) on lap 7.
  const laps = [lap(1, 6, 0, 3), lap(2, 5, 0, 2), lap(3, 5, 0, 2), lap(4, 9, 1, 4), lap(5, 14, 0, 7), lap(6, 13, 0, 6), lap(7, 12, 0, 6), lap(8, 12, 0, 6)];
  const settles: SettleMarker[] = [{ l: 7, p: 12, lb: "Settled P12", su: "Was P5 · Lost 7", c: "#f87171" }];

  it("use the import's pit-cycle result: before the cycle against where it settled", () => {
    expect(settleLabels(settles, laps, "")).toEqual([{ lap: 7, pos: 12, title: "Settled P12", sub: "Was P5 · Lost 7", color: "#f87171" }]);
  });

  it("give the same cycle in class positions in a class view", () => {
    expect(settleLabels(settles, laps, "GS")).toEqual([{ lap: 7, pos: 6, title: "Settled P6 in GS", sub: "Was P2 · Lost 4", color: "#f87171" }]);
  });

  it("draw a leader to the settle lap with the result, stacked so labels never cover each other", () => {
    const { ctx, texts } = fakeCtx();
    const labels = [
      { lap: 7, pos: 12, title: "Settled P12", sub: "Was P5 · Lost 7", color: "#f87171" },
      { lap: 8, pos: 12, title: "Settled P12", sub: "Was P9 · Gained 3", color: "#4ade80" },
    ];
    drawSettleLeaders(ctx, { labels, x: (l) => l * 10, y: (p) => p * 20, lapStart: 1, lapEnd: 10, plotTop: 0, plotBottom: 400, plotLeft: 0, plotRight: 200, background: "#000" });
    expect(texts.map((t) => t.text)).toEqual(["Settled P12", "Was P5 · Lost 7", "Settled P12", "Was P9 · Gained 3"]);
    expect(texts[2].y).toBeLessThan(texts[0].y - 25);
  });
});

describe("pit cycle panel", () => {
  it("compares the focus car's stop with the same stop of every car in its class, and keeps the out-lap", async () => {
    const { classStopCycle } = await import("../pit-stops");
    const t = (out: number | null) => ({ pitInTime: null, pitRoadTime: 55, pitOutTime: null, isDriveThrough: false, totalPitLoss: 56, inLapTime: 168, outLapTime: out, avgGreenLapTime: 117, splitReliable: out !== null, decompositionLevel: "total_only" as const });
    const car = (num: number, cls: string, pitLaps: number[]) => ({ num, team: `T${num}`, cls, finishPos: 1, finishPosClass: 1, laps: Array.from({ length: 60 }, (_, i) => lap(i + 1, 1, pitLaps.includes(i + 1) ? 1 : 0)) });
    const data = {
      cars: { "67": car(67, "GS", [26, 51]), "3": car(3, "GS", [20, 36]), "4": car(4, "GS", [22]), "93": car(93, "TCR", [30, 50]) },
      classGroups: { GS: [67, 3, 4], TCR: [93] },
    } as never;
    const pm = (l: number, out: number | null = 100) => ({ l, lb: "Pit", c: "#fff", yo: 0, da: 0, pitTiming: t(out) });
    const ann = { "67": { reasons: {}, settles: [], pits: [pm(26), pm(51, null)] }, "3": { reasons: {}, settles: [], pits: [pm(20), pm(36)] }, "4": { reasons: {}, settles: [], pits: [pm(22)] }, "93": { reasons: {}, settles: [], pits: [pm(30), pm(50)] } } as never;
    const c = classStopCycle(data, ann, 67, 51)!;
    expect(c.stopNumber).toBe(2);
    expect(c.rows.map((r) => [r.carNum, r.pitLap])).toEqual([[67, 51], [3, 36]]);
    expect([c.firstLap, c.lastLap]).toEqual([36, 51]);
    // No split from the import: the whole out-lap (lap 52, 100 s) is shown.
    expect(c.rows[0]).toMatchObject({ outLap: 100, outLapWhole: true });
  });
});

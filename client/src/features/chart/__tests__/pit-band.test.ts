import { describe, expect, it } from "vitest";
import type { LapData, PitMarker } from "@shared/types";
import { deltaText, drawPitTags, pitDeltas, surname } from "../pit-band";

const lap = (l: number, p: number, pit = 0): LapData => ({ l, p, cp: p, lt: "1:40.000", ltSec: 100, flag: "GF", pit });
const marker = (l: number, extra: Partial<PitMarker>): PitMarker => ({ l, lb: `Pit ${l} · NAME`, c: "#fff", yo: 0, da: 0, ...extra });

describe("pit tags", () => {
  const laps = [lap(1, 5), lap(2, 5), lap(3, 9, 1), lap(4, 12), lap(5, 11), lap(6, 11, 1), lap(7, 13), lap(8, 10), lap(9, 10, 1), lap(10, 15), lap(11, 14)];
  const pits = [
    marker(1, { lb: "Start · ESTEP", outDriver: "Jane Estep", stintNumber: 1 }),
    marker(3, { inDriver: "Jane Estep", outDriver: "Sam Ruiz", stintNumber: 2 }),
    marker(6, { inDriver: "Sam Ruiz", outDriver: "Sam Ruiz", stintNumber: 3 }),
    marker(9, { inDriver: "Sam Ruiz", outDriver: "Ola Berg", stintNumber: 4 }),
  ];

  it("draws each tag above the plot with its gain or loss, in two lanes so neighbours never overlap", () => {
    const texts: { text: string; x: number; y: number }[] = [];
    const ctx = {
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {},
      measureText: (t: string) => ({ width: t.length * 6 }),
      fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
    } as unknown as CanvasRenderingContext2D;
    const run = (perLap: number) => {
      texts.length = 0;
      drawPitTags(ctx, {
        markers: pits, laps, pk: "p", fcy: [], x: (l) => 40 + l * perLap, lapStart: 1, lapEnd: 11,
        plotLeft: 40, plotRight: 40 + 11 * perLap, plotTop: 40, plotBottom: 300, band: { tagY: 3, laneH: 15, lanes: 2 }, activeLap: null, background: "#000",
      });
      return texts.map((t) => t.text);
    };
    // Room for every tag: full labels, each stop with its gain or loss.
    expect(run(80)).toEqual(["Start · ESTEP", "Pit 3 · NAME", " ▼7", "Pit 6 · NAME", " ▼2", "Pit 9 · NAME", " ▼5"]);
    // Every label sits in the margin above the plot.
    expect(texts.every((t) => t.y < 40)).toBe(true);
    // Crowded: the second lane is used, then the driver's name gives way before anything overlaps.
    const crowded = run(10);
    expect(new Set(texts.map((t) => t.y)).size).toBe(2);
    expect(crowded).toContain(" ▼7");
    expect(crowded.some((t) => t === "Pit 6" || t === "Pit 9")).toBe(true);
  });

  it("gives places gained or lost at each stop: the lap before against the first green lap after", () => {
    expect(pitDeltas(laps, "p")).toEqual([
      { lap: 3, before: 5, after: 12, delta: -7 },
      { lap: 6, before: 11, after: 13, delta: -2 },
      { lap: 9, before: 10, after: 15, delta: -5 },
    ]);
    // A stop under yellow is measured once the race is green again.
    expect(pitDeltas(laps, "p", [[4, 7]])[0]).toEqual({ lap: 3, before: 5, after: 10, delta: -5 });
  });

  it("formats gains, losses and holds", () => {
    expect([deltaText(3), deltaText(-13), deltaText(0)]).toEqual(["▲3", "▼13", "±0"]);
    expect(surname("  jane q. estep ")).toBe("ESTEP");
  });
});

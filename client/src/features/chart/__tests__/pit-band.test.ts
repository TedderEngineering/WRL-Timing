import { describe, expect, it } from "vitest";
import type { LapData, PitMarker } from "@shared/types";
import { deltaText, driverStints, pitDeltas, surname } from "../pit-band";

const lap = (l: number, p: number, pit = 0): LapData => ({ l, p, cp: p, lt: "1:40.000", ltSec: 100, flag: "GF", pit });
const marker = (l: number, extra: Partial<PitMarker>): PitMarker => ({ l, lb: `Pit · ${l}`, c: "#fff", yo: 0, da: 0, ...extra });

describe("driver band", () => {
  const laps = [lap(1, 5), lap(2, 5), lap(3, 9, 1), lap(4, 12), lap(5, 11), lap(6, 11, 1), lap(7, 13), lap(8, 10), lap(9, 10, 1), lap(10, 15), lap(11, 14)];
  const pits = [
    marker(1, { lb: "Start · ESTEP", outDriver: "Jane Estep", stintNumber: 1 }),
    marker(3, { inDriver: "Jane Estep", outDriver: "Sam Ruiz", stintNumber: 2 }),
    marker(6, { inDriver: "Sam Ruiz", outDriver: "Sam Ruiz", stintNumber: 3 }),
    marker(9, { inDriver: "Sam Ruiz", outDriver: "Ola Berg", stintNumber: 4 }),
  ];

  it("names each driver's spell once, merging stops without a driver change", () => {
    expect(driverStints(laps, pits)).toEqual([
      { from: 1, to: 3, driver: "ESTEP" },
      { from: 4, to: 9, driver: "RUIZ" },
      { from: 10, to: 11, driver: "BERG" },
    ]);
  });

  it("falls back to the in-driver of the stop that ends a spell", () => {
    const st = driverStints(laps, pits.slice(1));
    expect(st[0]).toEqual({ from: 1, to: 3, driver: "ESTEP" });
  });

  it("leaves a spell unnamed when nothing says who drove", () => {
    expect(driverStints(laps, [])).toEqual([{ from: 1, to: 3, driver: undefined }, { from: 4, to: 6, driver: undefined }, { from: 7, to: 9, driver: undefined }, { from: 10, to: 11, driver: undefined }]);
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

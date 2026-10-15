import { describe, expect, it } from "vitest";
import { finishInfo } from "../finish";

const lap = (l: number, p: number) => ({ l, p, cp: p, lt: "2:28.000", ltSec: 148, flag: "GREEN", pit: 0 });
const car = (num: number, finishPos: number, lastP: number, laps = 19, extra = {}) => ({
  num, team: `T${num}`, cls: "Am", finishPos, finishPosClass: finishPos, laps: Array.from({ length: laps }, (_, i) => lap(i + 1, i + 1 === laps ? lastP : lastP)), ...extra,
});
// GR Cup COTA 2026 Race 2: #22 took the flag first and was classified P3.
const data = {
  maxLap: 19,
  cars: { "22": car(22, 3, 1), "15": car(15, 1, 2), "98": car(98, 2, 3), "23": car(23, 99, 4, 19, { status: "dsq" }), "7": car(7, 30, 5) },
} as never;

describe("official result next to the crossing order", () => {
  it("says when the official result differs from where the car crossed the line", () => {
    expect(finishInfo(data, 22)).toMatchObject({ official: "P3", crossed: { pos: 1, lap: 19 }, changed: true });
    expect(finishInfo(data, 15)).toMatchObject({ official: "P1", crossed: { pos: 2 }, changed: true });
  });

  it("shows DSQ or not classified instead of a placeholder position", () => {
    expect(finishInfo(data, 23)).toMatchObject({ official: "DSQ", pos: null });
    // P30 in a five-car entry is a placeholder, not a place.
    expect(finishInfo(data, 7)).toMatchObject({ official: "Not classified", pos: null });
  });
});

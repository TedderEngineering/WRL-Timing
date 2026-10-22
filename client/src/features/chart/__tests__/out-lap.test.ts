import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import { onOutLap } from "../TrackMap";

const race = (pits: number[]) =>
  ({ cars: { "81": { cls: "GTO", laps: pits.map((pit, i) => ({ l: i + 1, ltSec: 140, pit })) } } }) as unknown as RaceChartData;

describe("a car on its out-lap", () => {
  it("is out of the pit lane with its in-lap the last lap it completed", () => {
    expect(onOutLap(race([0, 0, 1]), 81, new Map())).toBe(true);
  });
  it("is not while it is still in the pit lane", () => {
    expect(onOutLap(race([0, 0, 1]), 81, new Map([[81, { afterLap: 3 }]]))).toBe(false);
  });
  it("is not once it completes the out-lap", () => {
    expect(onOutLap(race([0, 0, 1, 0]), 81, new Map())).toBe(false);
  });
});

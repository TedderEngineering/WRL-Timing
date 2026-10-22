import { describe, expect, it } from "vitest";
import type { AnnotationData, CarData, PitMarker, RaceChartData } from "@shared/types";
import { driversInCars } from "../DriverReportTab";

const laps = (n: number, sec = 140) => Array.from({ length: n }, (_, i) => ({ l: i + 1, p: 1, cp: 1, lt: "", ltSec: sec, flag: "GF", pit: 0 }));
const car = (num: number, n: number, drivers: string[]): CarData => ({ num, team: "T", cls: "GTO", finishPos: num, finishPosClass: num, laps: laps(n), drivers });
const stop = (l: number, inDriver: string, outDriver: string): PitMarker => ({ l, lb: "", c: "", yo: 0, da: 0, inDriver, outDriver });
const chart = (cars: CarData[]): RaceChartData => ({
  maxLap: 0,
  totalCars: cars.length,
  greenPaceCutoff: 0,
  cars: Object.fromEntries(cars.map((c) => [String(c.num), c])),
  fcy: [],
  classGroups: {},
  classCarCounts: {},
});

describe("the driver in each running car now (Driver Report IN CAR, RaceTrace Live)", () => {
  it("is the driver of the car's latest stint, from its stops' driver out", () => {
    const data = chart([car(119, 70, ["Ashley Freiberg", "Brenna Schubert"]), car(120, 70, ["Alana Carter"])]);
    const ann = { "119": { reasons: {}, pits: [stop(33, "Ashley Freiberg", "Ashley Freiberg"), stop(60, "Ashley Freiberg", "Brenna Schubert")], settles: [] } } as AnnotationData;
    const now = driversInCars(data, ann);
    expect(now.get("119")).toBe("Brenna Schubert");
    expect(now.get("120")).toBe("Alana Carter"); // a car with one driver
  });

  it("is nobody for a car not running (OUT), or one whose stops name nobody", () => {
    const data = chart([car(119, 160, ["A", "B"]), car(282, 100, ["C", "D"]), car(5, 160, ["E", "F"])]);
    const ann = { "282": { reasons: {}, pits: [stop(90, "C", "D")], settles: [] } } as AnnotationData;
    const now = driversInCars(data, ann);
    expect(now.has("282")).toBe(false); // last lap 60 laps before the leader's: OUT
    expect(now.has("5")).toBe(false); // two drivers, no stop naming either
  });
});

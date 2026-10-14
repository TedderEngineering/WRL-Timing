import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RaceChartData } from "@shared/types";
import { LapDetailsPanel } from "../LapDetailsPanel";
import { TraceControls } from "../TraceControls";
import { buildLapInfo, getCompColor } from "../chart-renderer";
import { COMPARE_PALETTE } from "../constants";

const lap = (l: number, p: number, cp: number, pit = 0, flag = "GREEN") => ({ l, p, cp, lt: "1:40.000", ltSec: 100 + (pit ? 60 : 0), flag, pit });
const data = {
  maxLap: 3,
  totalCars: 3,
  greenPaceCutoff: 120,
  fcy: [[2, 2]],
  cars: {
    "11": { num: 11, team: "Synthetic Racing", cls: "Am", make: "Ford", finishPos: 2, finishPosClass: 1, laps: [lap(1, 1, 1), lap(2, 2, 1, 1, "FCY"), lap(3, 2, 1)] },
    "5": { num: 5, team: "Example Motorsport", cls: "Pro", finishPos: 1, finishPosClass: 1, laps: [lap(1, 2, 1), lap(2, 1, 1), lap(3, 1, 1)] },
    "7": { num: 7, team: "Third Team", cls: "Am", finishPos: 3, finishPosClass: 2, laps: [lap(1, 3, 2), lap(2, 3, 2), lap(3, 3, 2)] },
  },
  classGroups: { Am: [11, 7], Pro: [5] },
  classCarCounts: { Am: 2, Pro: 1 },
} as unknown as RaceChartData;
const annotations = {
  "11": { reasons: { "2": "Pitted under the FCY" }, pits: [{ l: 2, lb: "Pit 1", c: "#fff", yo: 0, da: 0, pitTiming: { pitInTime: null, pitRoadTime: 55.5, pitOutTime: null, isDriveThrough: false, totalPitLoss: 61.25, inLapTime: 130, outLapTime: 120, avgGreenLapTime: 100, splitReliable: true, decompositionLevel: "full_segments" } }], settles: [] },
} as never;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("Position Trace v2", () => {
  it("compare colours follow the order cars were added", () => {
    const set = new Set([7, 5]);
    expect(getCompColor(set, 11, 7)).toBe(COMPARE_PALETTE[0]);
    expect(getCompColor(set, 11, 5)).toBe(COMPARE_PALETTE[1]);
  });

  it("lap details show the lap, the position in class and overall, and the pit stop", () => {
    const info = buildLapInfo(data, annotations, { focusNum: 11, compSet: new Set([5, 7]), activeLap: 2, classView: "Am", xAxisMode: "laps", lapStart: 1, lapEnd: 3 }, 2);
    const t = text(renderToStaticMarkup(<LapDetailsPanel data={data} info={info} focusNum={11} classView="Am" onOpen={() => {}} />));
    expect(t).toContain("Synthetic Racing · Am");
    expect(t).toContain("Finished P1 in Am · P2 overall · 3 laps");
    expect(t).toContain("Lap 2");
    expect(t).toContain("Full Course Yellow");
    expect(t).toContain("P1 in Am");
    expect(t).toContain("P2 overall");
    expect(t).toContain("pit lap");
    expect(t).toContain("Pit-lane time 55.500");
    expect(t).toContain("Time lost 1:01.250");
    expect(t).toContain("Pitted under the FCY");
  });

  it("without a lap it says how to pick one", () => {
    const t = text(renderToStaticMarkup(<LapDetailsPanel data={data} info={null} focusNum={11} classView="" onOpen={() => {}} />));
    expect(t).toContain("Pick a lap");
  });

  it("the control bar shows focus, class counts and the compare cars", () => {
    const t = text(
      renderToStaticMarkup(
        <TraceControls data={data} focusNum={11} onFocus={() => {}} classView="" setClassView={() => {}} compSet={new Set([5])} toggleComp={() => {}} clearComp={() => {}} makeFilter={[]} setMakeFilter={() => {}} xAxisMode="laps" setXAxisMode={() => {}} />
      )
    );
    expect(t).toContain("#11 Synthetic Racing");
    expect(t).toContain("All 3");
    expect(t).toContain("Am 2");
    expect(t).toContain("#5 ×");
  });
});

describe("makes", () => {
  it("reads the make from the vehicle when the import has no make groups", async () => {
    const { makeGroupsOf, makeOf } = await import("../makes");
    expect(makeOf("McLaren Artura GT4")).toBe("McLaren");
    expect(makeOf("Mercedes-AMG GT4")).toBe("Mercedes-AMG");
    expect(makeOf("Toyota Gazoo Racing GR Supra GT4 EVO2")).toBe("Toyota");
    expect(makeOf("")).toBeNull();
    const d = { cars: { "1": { num: 1, vehicle: "BMW M4 GT4" }, "2": { num: 2, vehicle: "BMW M4 GT4" }, "3": { num: 3, vehicle: "Ford Mustang GT4" }, "4": { num: 4 } } } as unknown as RaceChartData;
    expect(makeGroupsOf(d)).toEqual({ BMW: [1, 2], Ford: [3] });
  });
});

describe("make filter", () => {
  it("several makes can be picked at once", () => {
    const two = { ...data, cars: { ...data.cars, "5": { ...data.cars["5"], make: "Porsche" }, "7": { ...data.cars["7"], make: "BMW" } } } as RaceChartData;
    const html = renderToStaticMarkup(
      <TraceControls data={two} focusNum={11} onFocus={() => {}} classView="" setClassView={() => {}} compSet={new Set()} toggleComp={() => {}} clearComp={() => {}} makeFilter={["Ford", "Porsche"]} setMakeFilter={() => {}} xAxisMode="laps" setXAxisMode={() => {}} />
    );
    const pressed = [...html.matchAll(/aria-pressed="true"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
    expect(pressed).toEqual(expect.arrayContaining(["Ford 1", "Porsche 1"]));
    expect(pressed).not.toContain("All");
  });
});

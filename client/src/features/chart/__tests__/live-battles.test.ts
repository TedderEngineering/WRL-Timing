import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import type { CarStrategy, LiveStrategy } from "../live-strategy";
import { liveBattles, sameTeam } from "../live-battles";
import { battleText } from "../LiveStrategyTab";

/** A car with 20 green laps at `pace`. */
const laps = (pace: number) => Array.from({ length: 20 }, (_, i) => ({ l: i + 1, p: 1, cp: 1, lt: "", ltSec: pace, flag: "GF", pit: 0 }));
const data = (paces: Record<string, number>) =>
  ({ fcy: [], greenPaceCutoff: 300, cars: Object.fromEntries(Object.entries(paces).map(([k, p]) => [k, { laps: laps(p) }])) }) as unknown as RaceChartData;

const car = (num: number, team: string, gapS: number, over: Partial<CarStrategy> = {}): CarStrategy =>
  ({ num, team, cls: "GTO", gapS, laps: 150, stopped: false, stopsToGo: 0, stintCap: 28, lastStopLap: 143, netGapS: gapS, ...over }) as CarStrategy;

const strategy = (cars: CarStrategy[], focus: number, over: Partial<LiveStrategy> = {}): LiveStrategy =>
  ({ cls: "GTO", cars, timeToGoS: 3000, caution: false, focus: { car: cars.find((c) => c.num === focus)!, window: null, pitNow: null }, ...over }) as LiveStrategy;

describe("battles with the cars around the focus car", () => {
  // #120 3 s ahead at 140.6 s; #119 (focus) at 140.0 s; #678 4 s behind at 139.2 s. 3000 s to go: 21 laps.
  const d = data({ "120": 140.6, "119": 140, "678": 139.2 });
  const cars = [car(120, "AE Victory Racing", 0), car(119, "AE Victory Racing (Montgomery / Schubert)", 3), car(678, "STAK Racing", 7)];

  it("pushes on the car it is catching, and defends against the one catching it", () => {
    const [ahead, behind] = liveBattles(strategy(cars, 119), d);
    expect(ahead).toMatchObject({ kind: "push", rival: 120, side: "ahead", teammate: true, inLaps: 4, onLap: 154, horizon: 21, until: "the flag" });
    expect(ahead.closingS).toBeCloseTo(0.6, 6);
    expect(behind).toMatchObject({ kind: "defend", rival: 678, side: "behind", teammate: false, inLaps: 3, onLap: 153 });
    // To stay clear to the flag: 139.2 + 3 s over 21 laps.
    expect(behind.targetS).toBeCloseTo(139.2 + 3 / 21, 6);
    expect(battleText(behind, "#678").note).toBe("#678 is 4.0 s behind and closing at 0.8 s/lap: on your tail in 3 laps. Run 2:19.3 or faster to stay clear until the flag (21 laps).");
  });

  it("knows a car ahead with a stop more to make passes in the pits, and a car behind with a stop fewer is the net rival", () => {
    const c = [car(120, "A", 0, { stopsToGo: 1, netGapS: 110 }), car(119, "B", 3, { stopsToGo: 1, netGapS: 103 }), car(678, "C", 7, { stopsToGo: 0, netGapS: 7 })];
    // Focus owes 1, #120 owes 1: no; make #120 owe 2.
    c[0].stopsToGo = 2;
    c[0].netGapS = 203;
    const [ahead, behind] = liveBattles(strategy(c, 119), d);
    expect(ahead).toMatchObject({ kind: "passes_in_pits", netS: 100 });
    expect(behind).toMatchObject({ kind: "net_rival", netS: -96 });
    // Beat #678 by the flag: gain 96 s (+1) over 3000/140 laps.
    expect(behind.targetS).toBeCloseTo(139.2 - 97 / (3000 / 140), 6);
  });

  it("says out of reach when even its best recent pace does not get there before its stop", () => {
    const far = [car(120, "A", 0), car(119, "B", 30, { stopsToGo: 1, lastStopLap: 140 })];
    const [ahead] = liveBattles(strategy(far, 119, { timeToGoS: 6000 }), data({ "120": 140, "119": 140 }));
    // Its stint has 28 × 1.15 = 32 laps from lap 140: 22 left; 29 s in 22 laps needs 138.7, it has run 140.
    expect(ahead).toMatchObject({ kind: "out_of_reach", until: "your stop", horizon: 22 });
  });

  it("is a single caution card under a caution", () => {
    const b = liveBattles(strategy(cars, 119, { caution: true }), d);
    expect(b.every((x) => x.kind === "caution")).toBe(true);
  });

  it("tells teammates by team name", () => {
    expect(sameTeam("AE Victory Racing", "AE Victory Racing (Smith / Jones)")).toBe(true);
    expect(sameTeam("TCB Racing", "STAK Racing")).toBe(false);
  });
});

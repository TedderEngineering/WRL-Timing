import { describe, expect, it } from "vitest";
import type { RaceChartData } from "@shared/types";
import { lapsDown } from "../laps-down";

/** A car of `cls` with laps of these times (s). */
const car = (cls: string, times: number[], posClass = 0) => ({ cls, finishPosClass: posClass, laps: times.map((ltSec, i) => ({ l: i + 1, ltSec })) });
const race = (cars: Record<string, ReturnType<typeof car>>) => ({ cars }) as unknown as RaceChartData;

describe("laps down to the class leader", () => {
  it("does not count a car on the lead lap that has not crossed yet", () => {
    // Leader: 100 s laps, 3 done (t = 300). Car 2: 9 s behind, 2 done (t = 209), lap 3 under way.
    const ld = lapsDown(race({ "1": car("GTO", [100, 100, 100], 1), "2": car("GTO", [104.5, 104.5]) }));
    expect(ld.get(1)).toBe(0);
    expect(ld.get(2)).toBe(0);
  });

  it("counts a car the leader had lapped when it last crossed", () => {
    // Car 3: 2 laps at t = 305; the leader had done 3 by then.
    const ld = lapsDown(race({ "1": car("GTO", [100, 100, 100, 100], 1), "3": car("GTO", [152, 153]) }));
    expect(ld.get(3)).toBe(1);
  });

  it("counts against the leader's laps now once a car stops crossing", () => {
    // Car 4 last crossed at t = 100 (lap 1); the leader is on lap 6 at t = 600.
    const ld = lapsDown(race({ "1": car("GTO", [100, 100, 100, 100, 100, 100], 1), "4": car("GTO", [100]) }));
    expect(ld.get(4)).toBe(5);
  });

  it("measures each class against its own leader", () => {
    const ld = lapsDown(race({ "1": car("GP1", [90, 90, 90, 90], 1), "2": car("GTU", [130, 130, 130], 1), "3": car("GTU", [131, 131, 131]) }));
    expect(ld.get(2)).toBe(0);
    expect(ld.get(3)).toBe(0);
  });

  it("finds the leader by laps and time when no class position is set", () => {
    const ld = lapsDown(race({ "1": car("GTO", [100, 100, 100]), "2": car("GTO", [210, 210]) }));
    expect(ld.get(1)).toBe(0);
    expect(ld.get(2)).toBe(1);
  });
});

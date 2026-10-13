/**
 * Synthetic scenario races shared by the unit tests (catalogue scenarios from ACCURACY_ALKAMEL.md §4
 * and ACCURACY_WRL.md §4).
 */
import type { BuildOptions } from "../types.js";
import type { SynthCar, SynthRace } from "./synth.js";

export const OPTS: BuildOptions = {
  series: "Synthetic Series",
  event: "Synthetic Event",
  session: "Race",
  track: { id: "synthetic-park", name: "Synthetic Park", timezone: "America/New_York" },
  rulebook: { pitCycleModel: "rounds", scheduledDurationS: 7200 },
  raceDate: "2026-10-02",
  packageId: "synthetic-race",
  generatedAt: "2026-10-13T00:00:00Z",
};

const car = (car: string, cls: string, i: number, extra: Partial<SynthCar> = {}): SynthCar => ({
  car,
  cls,
  base: 100 + i * 0.3,
  grid: i * 0.6,
  laps: 22,
  ...extra,
});

/**
 * Green race, two classes stopping at the same time (cross-class cycle separation), with:
 * #7/#07/#007 leading-zero cars; #11 drive-through after an RC penalty; #12 stop-and-go; #10 garage;
 * #24 retirement in the pits; #25 pit-lane start; #23 stop with no time card (B flag only);
 * #22 lap down in a long stop; #21 post-race 39 s penalty in the official results.
 */
export function greenRace(): SynthRace {
  return {
    mark: "Provisional",
    cars: [
      car("7", "GS", 0, { stops: [{ lap: 10, pitLane: 62, inDriver: 1, outDriver: 2 }] }),
      car("07", "GS", 1, { stops: [{ lap: 10, pitLane: 63 }] }),
      car("007", "GS", 2, { stops: [{ lap: 11, pitLane: 61 }], make: "Aston Martin", vehicle: "Aston Martin Vantage AMR GT4" }),
      car("10", "GS", 3, { stops: [{ lap: 10, pitLane: 64 }, { lap: 15, pitLane: 700 }], laps: 21 }),
      car("11", "GS", 4, { stops: [{ lap: 6, pitLane: 35 }, { lap: 10, pitLane: 60 }] }),
      car("12", "GS", 5, { stops: [{ lap: 7, pitLane: 50 }, { lap: 11, pitLane: 65 }] }),
      car("20", "TCR", 6, { base: 104, stops: [{ lap: 10, pitLane: 70 }], make: "Hyundai" }),
      car("21", "TCR", 7, { base: 104.2, stops: [{ lap: 10, pitLane: 71 }], make: "Hyundai", resultsPenalty: 39 }),
      car("22", "TCR", 8, { base: 104.4, stops: [{ lap: 5, pitLane: 260 }], laps: 20, make: "Honda" }),
      car("23", "TCR", 9, { base: 104.6, stops: [{ lap: 10, pitLane: 72 }, { lap: 16, pitLane: 60, noCard: true }], make: "Honda" }),
      car("24", "TCR", 10, { base: 104.8, stops: [{ lap: 10, pitLane: 69 }, { lap: 15, pitLane: 0, retire: true }], laps: 15, make: "Audi" }),
      car("25", "TCR", 11, { base: 105, stops: [{ pitLaneStart: true, lap: 1, pitLane: 30 }, { lap: 11, pitLane: 68 }], make: "Cupra" }),
    ],
    rc: [
      [450, "Car 11: Penalty - Speeding in pit lane - Drive Through"],
      [500, "Car 12: Penalty - Unsafe release - Stop and Go"],
      [2100, "Car 21: Penalty - Pass under yellow - Drive Through"],
      [1300, "PITS OPEN ALL CARS"],
    ],
    postRace: ["Car #21 - 39 second time penalty for unserved drive-through"],
    driveTime: true,
  };
}

/** One FCY period (race seconds 800–1120) under which most of class GS pits. */
export function fcyRace(): SynthRace {
  const cars: SynthCar[] = [];
  for (let i = 0; i < 8; i++) {
    const stopLap = i < 4 ? 8 : 15;
    cars.push(car(String(30 + i), "GS", i, { stops: [{ lap: stopLap, pitLane: 65 }], extra: { 8: 25, 9: 25, 10: 25, 11: 25 } }));
  }
  return { cars, fcy: [[800, 1120]] };
}

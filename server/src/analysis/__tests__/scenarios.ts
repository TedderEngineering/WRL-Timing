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

/**
 * A red flag (race seconds 960–1800) inside a caution (900–2000). #40–#42 are called into the pit lane
 * on lap 10 and held there until the restart; #41 also makes ordinary stops on laps 5 and 15. #43
 * retired in the pits on lap 5, so its Drive Time PIT row runs through the red flag and is split by it.
 * #44 serves a drive-through on lap 4 (it sets the pit-lane transit) and stops on lap 16.
 */
export function redFlagRace(): SynthRace {
  return {
    cars: [
      car("40", "GS", 0, { stops: [{ lap: 10, pitLane: 830 }] }),
      car("41", "GS", 1, { stops: [{ lap: 5, pitLane: 65 }, { lap: 10, pitLane: 830 }, { lap: 15, pitLane: 66 }] }),
      car("42", "GS", 2, { stops: [{ lap: 10, pitLane: 830 }] }),
      car("43", "GS", 3, { stops: [{ lap: 5, pitLane: 0, retire: true }], laps: 5 }),
      car("44", "GS", 4, { stops: [{ lap: 4, pitLane: 34 }, { lap: 16, pitLane: 64 }] }),
    ],
    rc: [[350, "Car 44: Penalty - Speeding in pit lane - Drive Through"]],
    fcy: [[900, 2000]],
    red: [960, 1800],
    driveTime: true,
  };
}

/**
 * One green round of stops in class GS (laps 10–11), where #52 stops on lap 10 and again on lap 12
 * (a short second visit inside the same round): the cycle must count #52 once.
 */
export function doubleStopRace(): SynthRace {
  return {
    cars: [
      car("50", "GS", 0, { stops: [{ lap: 10, pitLane: 62 }] }),
      car("51", "GS", 1, { stops: [{ lap: 10, pitLane: 63 }] }),
      car("52", "GS", 2, { stops: [{ lap: 10, pitLane: 61 }, { lap: 12, pitLane: 90 }] }),
      car("53", "GS", 3, { stops: [{ lap: 11, pitLane: 64 }] }),
      car("54", "GS", 4, { stops: [{ lap: 11, pitLane: 65 }] }),
    ],
  };
}

/**
 * Penalty linking (D-PENALTY), 50 laps of about 100 s, serve window 300 s of green running:
 * #60 drive-through announced at 250 s, served on lap 9 after a caution (400–800 s): 650 s later, but
 * only 250 s of green. #61 serves a drive-through on lap 20 and the message comes 50 s later.
 * #62 has a time penalty for its next stop, which comes about an hour later (lap 45).
 * #63's penalty message is sent twice.
 */
export function penaltyRace(dt61Message: number): SynthRace {
  const lap = (c: string, i: number, stops: SynthCar["stops"]) => car(c, "GS", i, { laps: 50, stops });
  return {
    cars: [
      lap("60", 0, [{ lap: 9, pitLane: 34 }, { lap: 25, pitLane: 65 }]),
      lap("61", 1, [{ lap: 20, pitLane: 34 }, { lap: 25, pitLane: 65 }]),
      lap("62", 2, [{ lap: 3, pitLane: 65 }, { lap: 45, pitLane: 70 }]),
      lap("63", 3, [{ lap: 25, pitLane: 65 }]),
      lap("64", 4, [{ lap: 25, pitLane: 66 }]),
    ],
    fcy: [[400, 800]],
    rc: [
      [250, "Car 60: Penalty - Speeding in pit lane - Drive Through"],
      [dt61Message, "Car 61: Penalty - Incident Responsibility with 64 - Drive Through"],
      [360, "Car 62: Penalty - Short Pit Stop Time - 5 sec Time Penalty to be served at next eligible stop"],
      [900, "Car 63: Penalty - Pass Under Yellow - Drive Through"],
      [905, "Car 63: Penalty - Pass Under Yellow - Drive Through"],
    ],
    driveTime: true,
  };
}

/**
 * A sprint with no time cards for its pit-lane passes: #70 is given a drive-through on lap 5 and
 * passes through the pit lane on lap 7 (B flag only). #71 gets a post-race time penalty announced by
 * race control and printed again in the results.
 */
export function noCardPenaltyRace(): SynthRace {
  return {
    mark: "Official",
    cars: [
      car("70", "GS", 0, { stops: [{ lap: 7, pitLane: 34, noCard: true }] }),
      car("71", "GS", 1, { resultsPenalty: 10 }),
      car("72", "GS", 2),
      car("73", "GS", 3, { stops: [{ lap: 10, pitLane: 65 }], resultsPenalty: 5 }),
      car("76", "GS", 4),
      car("77", "GS", 5),
      car("78", "GS", 6),
    ],
    rc: [
      [520, "Car 70: Penalty - Incident Responsibility - Drive Through"],
      [300, "Car 71: Penalty - False Start - +10 Seconds Post-Race"],
      [400, "Cars 76, 77 & 78: Penalty - Unserved Mandatory Pit Stop - +95 seconds Post-Race"],
    ],
    postRace: [
      "Car #71 - 10 second time penalty for False Start",
      "Car #72 - Moved to the back of the field as per Penalty #TP 26-18, as posted on the notice board",
      "Car #73 - 5 second post race time penalty for incident responsibility",
      "Car #72 - 28 second post race drive-through penalty for incident responsibility",
    ],
  };
}

/**
 * Serve windows (window 600 s): #80 is given a drive-through at 250 s, spends laps 4–8 in the garage
 * (about 900 s), then serves it on lap 6. #81 enters the pit lane for a long stop on lap 15 just
 * before race control announces a Stop + 60 for it.
 */
export function serveWindowRace(stopPlusAt: number): SynthRace {
  const lap = (c: string, i: number, stops: SynthCar["stops"]) => car(c, "GS", i, { laps: 30, stops });
  return {
    cars: [
      lap("80", 0, [{ lap: 4, pitLane: 900 }, { lap: 6, pitLane: 34 }]),
      lap("81", 1, [{ lap: 15, pitLane: 125 }]),
      lap("82", 2, [{ lap: 15, pitLane: 65 }]),
      lap("83", 3, [{ lap: 15, pitLane: 66 }]),
    ],
    rc: [
      [250, "Car 80: Penalty - Improperly attired person(s) over wall - Drive Through"],
      [stopPlusAt, "Car 81: Penalty - More than Emergency Service in closed pit - Stop + 60"],
    ],
    driveTime: true,
  };
}

/**
 * Pit passes and splashes (engine 1.2.12): the served drive-through (#90, lap 5) takes 34 s. #91 drives
 * through at transit speed on lap 8 with a Stop + 60 pending (announced at 600 s), then serves it on
 * lap 12 (VIR 2026 #81). #92 stops 5 s longer than a drive-through on lap 20, near the end (Indianapolis
 * 2026 #59, a splash to finish). #93 and #94 stop normally.
 */
export function pitPassRace(): SynthRace {
  const lap = (c: string, i: number, stops: SynthCar["stops"]) => car(c, "GS", i, { laps: 22, stops });
  return {
    cars: [
      lap("90", 0, [{ lap: 5, pitLane: 34 }, { lap: 11, pitLane: 70 }]),
      lap("91", 1, [{ lap: 8, pitLane: 34.3 }, { lap: 12, pitLane: 130 }]),
      lap("92", 2, [{ lap: 11, pitLane: 68 }, { lap: 20, pitLane: 38.5 }]),
      lap("93", 3, [{ lap: 11, pitLane: 66 }]),
      lap("94", 4, [{ lap: 11, pitLane: 67 }]),
    ],
    rc: [
      [350, "Car 90: Penalty - Pit lane speeding - Drive Through"],
      [600, "Car 91: Penalty - More than Emergency Service in closed pit - Stop + 60"],
    ],
    driveTime: true,
  };
}

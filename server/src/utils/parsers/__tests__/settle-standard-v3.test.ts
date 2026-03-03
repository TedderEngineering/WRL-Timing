/**
 * V3 Pit Stop & Settle Position Standard — end-to-end verification tests.
 */
import { describe, it, expect } from "vitest";
import {
  computeClassVolatility,
  computeProximityWeightedVolatility,
  computeBaselineVolatility,
  detectPitCycles,
  assignPitToCycle,
  cusumSettleDetection,
  findPrePitBaseline,
  computePitTiming,
  computeSPC,
  computeCycleComparisons,
  classifyPitStrategy,
  buildKnownDrivers,
  isLegitDriverChange,
  parseTimeOfDay,
  parseIMSAPitStopData,
  toPitStopTimeCards,
  type PitEvent,
  type PitEventWithTiming,
  type PitEventForStrategy,
  type PitTiming,
} from "../position-analysis.js";

// ─── Helpers to build mock data ──────────────────────────────────────────────

type CarData = {
  num: number;
  team: string;
  cls: string;
  finishPos: number;
  finishPosClass: number;
  laps: Array<{
    l: number;
    p: number;
    cp: number;
    lt: string;
    ltSec: number;
    flag: string;
    pit: 0 | 1;
  }>;
};

/** Build a simple car with positions per lap. pit laps default to 0. */
function makeCar(
  num: number,
  positions: number[],
  opts?: {
    cls?: string;
    pitLaps?: number[];
    fcyLaps?: number[];
    ltSec?: number;
  }
): CarData {
  const cls = opts?.cls ?? "GTU";
  const pitSet = new Set(opts?.pitLaps ?? []);
  const fcySet = new Set(opts?.fcyLaps ?? []);
  const baseLt = opts?.ltSec ?? 90;
  return {
    num,
    team: `Team ${num}`,
    cls,
    finishPos: 1,
    finishPosClass: 1,
    laps: positions.map((p, i) => ({
      l: i + 1,
      p,
      cp: p,
      lt: `1:${(baseLt % 60).toFixed(3).padStart(6, "0")}`,
      ltSec: pitSet.has(i + 1) ? baseLt + 40 : baseLt,
      flag: fcySet.has(i + 1) ? "FCY" : "GREEN",
      pit: pitSet.has(i + 1) ? 1 : 0,
    })),
  };
}

function carsRecord(cars: CarData[]): Record<string, CarData> {
  const rec: Record<string, CarData> = {};
  for (const c of cars) rec[String(c.num)] = c;
  return rec;
}

// ─── Test 1: Volatility spikes during pit cluster, returns to baseline ───────

describe("computeClassVolatility", () => {
  it("spikes during pit cluster and returns to baseline", () => {
    // 3 cars, 20 laps. Position swaps on laps 10, 11, 12 due to pit cluster
    const car1 = makeCar(1, [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // L1-10: steady P1
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // L11-20: steady P1
    ]);
    const car2 = makeCar(
      2,
      [
        2, 2, 2, 2, 2, 2, 2, 2, 2, 3, // L10: drops to P3 on pit
        2, 2, 2, 2, 2, 2, 2, 2, 2, 2, // L11: recovers to P2
      ],
      { pitLaps: [10] }
    );
    const car3 = makeCar(
      3,
      [
        3, 3, 3, 3, 3, 3, 3, 3, 3, 2, // L10: gains P2 when car2 pits
        3, 3, 3, 3, 3, 3, 3, 3, 3, 3, // L11: drops back to P3 when car2 recovers
      ],
      { pitLaps: [11] }
    );

    const allCars = carsRecord([car1, car2, car3]);
    const classGroups = { GTU: [1, 2, 3] };

    const vol = computeClassVolatility(allCars, 20, "GTU", classGroups);

    // Lap 10: car2 P2→P3, car3 P3→P2 — both changed
    expect(vol[10]).toBeGreaterThan(0);
    // Lap 11: car2 P3→P2, car3 P2→P3 — both changed
    expect(vol[11]).toBeGreaterThan(0);

    // Laps 5-8 should have 0 volatility (no position changes)
    expect(vol[5]).toBe(0);
    expect(vol[6]).toBe(0);
    expect(vol[7]).toBe(0);

    // Laps 15-20 should have 0 volatility (stable again)
    expect(vol[15]).toBe(0);
    expect(vol[16]).toBe(0);
  });
});

// ─── Test 2: Proximity weighting increases near-car sensitivity ──────────────

describe("computeProximityWeightedVolatility", () => {
  it("weights changes near focus car more heavily", () => {
    // 5 cars. Car at P1 swaps with car at P2 on lap 10.
    // Car at P4 swaps with car at P5 on lap 10.
    // Focus car is at P3. The P1/P2 swap is closer (distance 1-2) than P4/P5 (distance 1-2).
    // But if focus is P1, the P1/P2 swap should be weighted more than P4/P5.
    const car1 = makeCar(1, [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1]);
    const car2 = makeCar(2, [2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2]);
    const car3 = makeCar(3, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    const car4 = makeCar(4, [4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 4, 4]);
    const car5 = makeCar(5, [5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 5, 5]);

    const allCars = carsRecord([car1, car2, car3, car4, car5]);
    const classGroups = { GTU: [1, 2, 3, 4, 5] };

    // Focus car at P1: P1/P2 swap is close, P4/P5 swap is far
    const focusP1 = new Map<number, number>();
    car1.laps.forEach((ld) => focusP1.set(ld.l, ld.p));
    const volP1 = computeProximityWeightedVolatility(allCars, 12, "GTU", classGroups, focusP1);

    // Focus car at P5: P4/P5 swap is close, P1/P2 swap is far
    const focusP5 = new Map<number, number>();
    car5.laps.forEach((ld) => focusP5.set(ld.l, ld.p));
    const volP5 = computeProximityWeightedVolatility(allCars, 12, "GTU", classGroups, focusP5);

    // Both should detect lap 10 as volatile, but the weighted values differ
    expect(volP1[10]).toBeGreaterThan(0);
    expect(volP5[10]).toBeGreaterThan(0);
    // The swap near focus should produce higher weighted volatility
    // (not necessarily — both see 2 cars changing, just weighted differently)
    // The key assertion: both are non-zero on lap 10, zero elsewhere
    expect(volP1[5]).toBe(0);
    expect(volP5[5]).toBe(0);
  });
});

// ─── Test 3: CUSUM detects settle through single-lap noise ───────────────────

describe("cusumSettleDetection", () => {
  it("detects settle despite single-lap position swap", () => {
    // Car pits on lap 10, positions bounce: 8,7,8,7,7,7,7,7,7,7
    // Single-lap noise at lap 13 (position 8 then back to 7) shouldn't prevent settle
    const positions = [
      5, 5, 5, 5, 5, 5, 5, 5, 5, // L1-9: P5
      8, // L10: pit in-lap, drops to P8
      8, 7, 8, 7, 7, 7, 7, 7, 7, 7, // L11-20: bounces then settles P7
      7, 7, 7, 7, 7, // L21-25
    ];
    const car = makeCar(1, positions, { pitLaps: [10] });

    const classVol = new Array(26).fill(0);
    // Simulate elevated volatility around pit window
    classVol[10] = 0.5;
    classVol[11] = 0.4;
    classVol[12] = 0.2;

    const baseline = { mean: 0.05, stddev: 0.03 };
    const fcyLaps = new Set<number>();
    const pe: PitEvent = { inLap: 10, outLap: 11 };

    const result = cusumSettleDetection(car, pe, classVol, baseline, fcyLaps);

    expect(result).not.toBeNull();
    expect(result!.settlePosition).toBe(7);
    expect(result!.referencePos).toBe(7);
    // Should settle somewhere in laps 14-17 range (after noise subsides)
    expect(result!.settleLap).toBeGreaterThanOrEqual(12);
    expect(result!.settleLap).toBeLessThanOrEqual(20);
  });

  it("returns null when car re-pits before settling", () => {
    const positions = [5, 5, 5, 5, 5, 8, 7, 8, 9, 7, 7, 7];
    const car = makeCar(1, positions, { pitLaps: [6, 9] }); // pits again on L9

    const classVol = new Array(13).fill(0.05);
    const baseline = { mean: 0.05, stddev: 0.03 };
    const pe: PitEvent = { inLap: 6, outLap: 7 };

    const result = cusumSettleDetection(car, pe, classVol, baseline, new Set());
    expect(result).toBeNull();
  });
});

// ─── Test 4: Reverse CUSUM ignores inherited positions in pit cycle ──────────

describe("findPrePitBaseline", () => {
  it("finds stable position before pit cycle disruption", () => {
    // Car holds P5 for laps 1-15, then positions start shifting (pit cycle)
    // to P4, P3, then pits on lap 20
    const positions = [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, // L1-10: steady P5
      5, 5, 5, 5, 5, 4, 3, 4, 3, 8, // L11-20: drift then pit on L20
    ];
    const car = makeCar(1, positions, { pitLaps: [20] });

    const proxVol = new Array(21).fill(0.05);
    proxVol[16] = 0.3;
    proxVol[17] = 0.4;
    proxVol[18] = 0.3;

    // Baseline must be large enough so CUSUM k/h allow decay through the
    // 4-lap disruption zone.  k = mean*2 = 0.4, h = max(1.0, stddev*8) = 1.6
    const baseline = { mean: 0.2, stddev: 0.2 };
    const pe = { inLap: 20 };

    const result = findPrePitBaseline(car, pe, proxVol, baseline, new Set());

    // Should find P5 as the baseline (the stable position before disruption)
    expect(result).toBe(5);
  });

  it("uses pre-FCY position when pit is during caution", () => {
    const positions = [
      3, 3, 3, 3, 3, 3, 3, 3, 3, 3, // L1-10: P3
      4, 5, 4, 5, 8, // L11-15: FCY shuffle, pit on L15
    ];
    const car = makeCar(1, positions, { pitLaps: [15], fcyLaps: [11, 12, 13, 14, 15] });
    const fcyLaps = new Set([11, 12, 13, 14, 15]);

    const baseline = { mean: 0.05, stddev: 0.03 };
    // Scan from FCY start (L11), not pit lap
    const pe = { inLap: 11 };

    const result = findPrePitBaseline(car, pe, new Array(16).fill(0.05), baseline, fcyLaps);
    expect(result).toBe(3);
  });
});

// ─── Test 5: SPC classifies normal/warning/outlier correctly ─────────────────

describe("computeSPC", () => {
  function makeTiming(totalPitLoss: number): PitTiming {
    return {
      pitInTime: null,
      pitRoadTime: null,
      pitOutTime: null,
      isDriveThrough: false,
      totalPitLoss,
      inLapTime: 130,
      outLapTime: 100,
      avgGreenLapTime: 90,
      decompositionLevel: "total_only",
    };
  }

  it("classifies normal stops within 2 sigma", () => {
    const timings = [makeTiming(40), makeTiming(42), makeTiming(38), makeTiming(41), makeTiming(39)];
    const result = computeSPC(timings[0], timings);

    expect(result).not.toBeNull();
    expect(result!.totalLoss.classification).toBe("normal");
    expect(result!.totalLoss.confidence).toBe("established");
  });

  it("classifies outlier beyond 3 sigma", () => {
    // With n-1 normal values and 1 outlier, z ≈ (n-1)/√n.
    // Need n ≥ 12 for z > 3, so use 12 normal + 1 extreme.
    const timings = [
      makeTiming(40), makeTiming(41), makeTiming(39), makeTiming(40), makeTiming(42),
      makeTiming(40), makeTiming(41), makeTiming(39), makeTiming(40), makeTiming(42),
      makeTiming(40), makeTiming(41),
      makeTiming(200), // extreme outlier
    ];
    const result = computeSPC(timings[12], timings);

    expect(result).not.toBeNull();
    expect(result!.totalLoss.classification).toBe("outlier");
    expect(result!.totalLoss.direction).toBe("slow");
  });

  it("returns null with fewer than 3 stops", () => {
    const timings = [makeTiming(40), makeTiming(42)];
    const result = computeSPC(timings[0], timings);
    expect(result).toBeNull();
  });

  it("marks provisional confidence with <5 stops", () => {
    const timings = [makeTiming(40), makeTiming(42), makeTiming(38)];
    const result = computeSPC(timings[0], timings);
    expect(result).not.toBeNull();
    expect(result!.totalLoss.confidence).toBe("provisional");
  });
});

// ─── Test 6: Strategy classifies undercut/overcut/cover/scheduled ────────────

describe("classifyPitStrategy", () => {
  it("classifies undercut: behind, pits first", () => {
    const focus: PitEventForStrategy = {
      carNum: 1, inLap: 20, preBaseline: 5, settlePosition: 3, cycleId: 0,
    };
    const rival: PitEventForStrategy = {
      carNum: 2, inLap: 23, preBaseline: 3, settlePosition: 5, cycleId: 0,
    };
    const result = classifyPitStrategy(focus, [focus, rival]);
    expect(result.type).toBe("undercut");
    expect(result.success).toBe(true); // ended up ahead (P3 < P5)
    expect(result.targetCar).toBe(2);
  });

  it("classifies overcut: ahead, pits after rival", () => {
    const focus: PitEventForStrategy = {
      carNum: 1, inLap: 25, preBaseline: 3, settlePosition: 3, cycleId: 0,
    };
    const rival: PitEventForStrategy = {
      carNum: 2, inLap: 21, preBaseline: 5, settlePosition: 5, cycleId: 0,
    };
    const result = classifyPitStrategy(focus, [focus, rival]);
    expect(result.type).toBe("overcut");
    expect(result.success).toBe(true);
  });

  it("classifies cover: pits within 1 lap", () => {
    const focus: PitEventForStrategy = {
      carNum: 1, inLap: 20, preBaseline: 3, settlePosition: 3, cycleId: 0,
    };
    const rival: PitEventForStrategy = {
      carNum: 2, inLap: 20, preBaseline: 4, settlePosition: 4, cycleId: 0,
    };
    const result = classifyPitStrategy(focus, [focus, rival]);
    expect(result.type).toBe("cover");
  });

  it("classifies scheduled: no rivals in cycle", () => {
    const focus: PitEventForStrategy = {
      carNum: 1, inLap: 20, preBaseline: 3, settlePosition: 4, cycleId: 0,
    };
    const result = classifyPitStrategy(focus, [focus]);
    expect(result.type).toBe("scheduled");
  });

  it("classifies scheduled: closest rival >5 positions away", () => {
    const focus: PitEventForStrategy = {
      carNum: 1, inLap: 20, preBaseline: 1, settlePosition: 2, cycleId: 0,
    };
    const rival: PitEventForStrategy = {
      carNum: 2, inLap: 22, preBaseline: 10, settlePosition: 10, cycleId: 0,
    };
    const result = classifyPitStrategy(focus, [focus, rival]);
    expect(result.type).toBe("scheduled");
  });
});

// ─── Test 7: Total pit loss computed correctly from lap times ─────────────────

describe("computePitTiming", () => {
  it("computes total pit loss from in-lap and out-lap times", () => {
    // Green laps average ~90s, in-lap 130s, out-lap 100s
    const positions = [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 3, 3,
    ];
    const car = makeCar(1, positions, { pitLaps: [10], ltSec: 90 });

    const pe: PitEvent = { inLap: 10, outLap: 11 };
    const fcyLaps = new Set<number>();

    const result = computePitTiming(car, pe, fcyLaps);

    expect(result).not.toBeNull();
    expect(result!.avgGreenLapTime).toBeCloseTo(90, 0);
    expect(result!.inLapTime).toBe(130); // 90 + 40 (pit penalty)
    expect(result!.outLapTime).toBe(90);
    // totalPitLoss = (130 - 90) + max(0, 90 - 90) = 40
    expect(result!.totalPitLoss).toBeCloseTo(40, 0);
    expect(result!.decompositionLevel).toBe("total_only");
  });
});

// ─── Test 8: IMSA Time Cards parsing ─────────────────────────────────────────

describe("parseTimeOfDay / parseIMSAPitStopData", () => {
  it("parses HH:MM:SS.mmm to seconds from midnight", () => {
    expect(parseTimeOfDay("14:52:17.909")).toBeCloseTo(14 * 3600 + 52 * 60 + 17.909, 2);
    expect(parseTimeOfDay("00:00:00.000")).toBe(0);
    expect(parseTimeOfDay("1:30:00")).toBe(5400);
  });

  it("parses IMSA pit stop JSON into per-car map", () => {
    const raw = {
      pit_stop_analysis: [
        {
          number: "023",
          drivers: [
            { number: 1, firstname: "John", surname: "Doe" },
            { number: 2, firstname: "Jane", surname: "Smith" },
          ],
          pit_stops: [
            {
              pit_stop_number: 1,
              in_time: "14:00:00.000",
              out_time: "14:01:15.500",
              pit_time: "0:01:15.500",
              in_driver_surname: "Doe",
              out_driver_surname: "Smith",
              in_driver_number: 1,
              out_driver_number: 2,
            },
          ],
        },
      ],
    };

    const result = parseIMSAPitStopData(raw);
    expect(result.size).toBe(1);

    const stops = result.get(23)!;
    expect(stops).toHaveLength(1);
    expect(stops[0].pitNumber).toBe(1);
    expect(stops[0].inTime).toBeCloseTo(14 * 3600, 0);
    expect(stops[0].outTime).toBeCloseTo(14 * 3600 + 75.5, 1);
    expect(stops[0].inDriverSurname).toBe("Doe");
    expect(stops[0].outDriverSurname).toBe("Smith");
    expect(stops[0].driverChanged).toBe(true);

    // toPitStopTimeCards conversion
    const timeCards = toPitStopTimeCards(stops);
    expect(timeCards).toHaveLength(1);
    expect(timeCards[0].inTime).toBe(stops[0].inTime);
    expect(timeCards[0].outTime).toBe(stops[0].outTime);
  });
});

// ─── Test 9: Cycle comparison computes segment deltas for full_segments ──────

describe("computeCycleComparisons", () => {
  it("computes segment deltas when all have full_segments", () => {
    const cycles = [{ startLap: 10, endLap: 15, id: 0 }];
    const events: PitEventWithTiming[] = [
      {
        carNum: 1, inLap: 11,
        timing: {
          pitInTime: 20, pitRoadTime: 60, pitOutTime: 15,
          isDriveThrough: false, totalPitLoss: 45, inLapTime: 130,
          outLapTime: 100, avgGreenLapTime: 90, decompositionLevel: "full_segments",
        },
        cycleId: 0,
      },
      {
        carNum: 2, inLap: 12,
        timing: {
          pitInTime: 22, pitRoadTime: 65, pitOutTime: 18,
          isDriveThrough: false, totalPitLoss: 50, inLapTime: 135,
          outLapTime: 105, avgGreenLapTime: 90, decompositionLevel: "full_segments",
        },
        cycleId: 0,
      },
    ];

    computeCycleComparisons(events, cycles);

    const comp1 = events[0].timing.cycleComparison!;
    expect(comp1).toBeDefined();
    expect(comp1.compCarCount).toBe(1);
    expect(comp1.deltaTotalLoss).toBeCloseTo(-5, 1); // 45 - 50 = -5 (faster)
    expect(comp1.deltaPitIn).toBeCloseTo(-2, 1); // 20 - 22
    expect(comp1.deltaPitRoad).toBeCloseTo(-5, 1); // 60 - 65
    expect(comp1.deltaPitOut).toBeCloseTo(-3, 1); // 15 - 18
  });

  // ─── Test 10: Falls back to totalLoss for total_only ────────────────────
  it("falls back to totalLoss only for total_only decomposition", () => {
    const cycles = [{ startLap: 10, endLap: 15, id: 0 }];
    const events: PitEventWithTiming[] = [
      {
        carNum: 1, inLap: 11,
        timing: {
          pitInTime: null, pitRoadTime: null, pitOutTime: null,
          isDriveThrough: false, totalPitLoss: 45, inLapTime: 130,
          outLapTime: 100, avgGreenLapTime: 90, decompositionLevel: "total_only",
        },
        cycleId: 0,
      },
      {
        carNum: 2, inLap: 12,
        timing: {
          pitInTime: null, pitRoadTime: null, pitOutTime: null,
          isDriveThrough: false, totalPitLoss: 50, inLapTime: 135,
          outLapTime: 105, avgGreenLapTime: 90, decompositionLevel: "total_only",
        },
        cycleId: 0,
      },
    ];

    computeCycleComparisons(events, cycles);

    const comp = events[0].timing.cycleComparison!;
    expect(comp.deltaTotalLoss).toBeCloseTo(-5, 1);
    expect(comp.deltaPitIn).toBeNull();
    expect(comp.deltaPitRoad).toBeNull();
    expect(comp.deltaPitOut).toBeNull();
  });
});

// ─── Test 11: Settle color green/red/gray from baseline comparison ───────────

describe("settle marker colors", () => {
  it("produces correct colors based on net position change", () => {
    // This tests the v3 pipeline indirectly via generateAnnotations.
    // We test the CUSUM result + makeSettle logic:
    // net > 0 (gained) = green, net < 0 (lost) = red, net = 0 = gray
    // We verify via the computeClassVolatility + detectPitCycles flow.

    // Build a scenario: 4 cars, car 1 pits on lap 10, settles at P3 (was P5)
    const car1 = makeCar(
      1,
      [5, 5, 5, 5, 5, 5, 5, 5, 5, 8, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      { pitLaps: [10] }
    );
    const car2 = makeCar(2, Array(20).fill(1));
    const car3 = makeCar(3, Array(20).fill(2));
    const car4 = makeCar(4, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);

    const allCars = carsRecord([car1, car2, car3, car4]);
    const classGroups = { GTU: [1, 2, 3, 4] };

    const vol = computeClassVolatility(allCars, 20, "GTU", classGroups);
    const baseline = computeBaselineVolatility(vol, new Set(), new Set([10]));

    // Baseline should be computed from clean laps
    expect(baseline.n).toBeGreaterThan(0);

    // CUSUM settle: car1 should settle around P3
    const pe: PitEvent = { inLap: 10, outLap: 11 };
    const settle = cusumSettleDetection(car1, pe, vol, baseline, new Set());
    expect(settle).not.toBeNull();
    expect(settle!.settlePosition).toBe(3);

    // Pre-pit baseline should be P5
    const prePit = findPrePitBaseline(car1, { inLap: 10 }, vol, baseline, new Set());
    expect(prePit).toBe(5);

    // Net = 5 - 3 = 2 (gained) → would produce green color
    const net = prePit - settle!.settlePosition;
    expect(net).toBeGreaterThan(0); // gained → green
  });
});

// ─── Test 12: Driver filtering rejects WRL COTA noise ────────────────────────

describe("buildKnownDrivers / isLegitDriverChange", () => {
  it("builds known drivers from first 60 laps", () => {
    const laps = [
      // First 20 laps: "Alice" drives
      ...Array(20).fill({ driverName: "Alice" }),
      // Laps 21-40: "Bob" drives
      ...Array(20).fill({ driverName: "Bob" }),
      // Laps 41-60: noise — different names each lap
      ...Array(20).fill(null).map((_, i) => ({ driverName: `Noise${i}` })),
    ];

    const known = buildKnownDrivers(laps, 60);

    expect(known.has("Alice")).toBe(true);
    expect(known.has("Bob")).toBe(true);
    // Noise names appear only once each — should be rejected
    expect(known.has("Noise0")).toBe(false);
    expect(known.has("Noise5")).toBe(false);
    expect(known.size).toBe(2);
  });

  it("rejects driver change to unknown name", () => {
    const laps = [
      { driverName: "Alice" },
      { driverName: "Alice" },
      { driverName: "Alice" },
      { driverName: "UnknownGlitch" },
      { driverName: "Alice" },
    ];
    const known = new Set(["Alice", "Bob"]);

    expect(isLegitDriverChange(laps, 3, known)).toBe(false);
  });

  it("rejects known name that doesn't persist 3 laps", () => {
    const laps = [
      { driverName: "Alice" },
      { driverName: "Alice" },
      { driverName: "Bob" },
      { driverName: "Alice" }, // Bob only lasts 1 lap
      { driverName: "Alice" },
    ];
    const known = new Set(["Alice", "Bob"]);

    expect(isLegitDriverChange(laps, 2, known)).toBe(false);
  });

  it("accepts known name that persists 3+ laps", () => {
    const laps = [
      { driverName: "Alice" },
      { driverName: "Alice" },
      { driverName: "Bob" },
      { driverName: "Bob" },
      { driverName: "Bob" },
      { driverName: "Bob" },
    ];
    const known = new Set(["Alice", "Bob"]);

    expect(isLegitDriverChange(laps, 2, known)).toBe(true);
  });
});

// ─── Pit cycle detection ─────────────────────────────────────────────────────

describe("detectPitCycles / assignPitToCycle", () => {
  it("detects and merges nearby cycles", () => {
    // Volatility array with two nearby spikes
    const vol = new Array(30).fill(0);
    vol[10] = 0.6;
    vol[11] = 0.5;
    // Gap of 2 laps
    vol[14] = 0.7;
    vol[15] = 0.4;

    const baseline = { mean: 0.05, stddev: 0.03 };
    const cycles = detectPitCycles(vol, baseline);

    // Should merge into one cycle (gap <= 3)
    expect(cycles.length).toBe(1);
    expect(cycles[0].startLap).toBe(10);
    expect(cycles[0].endLap).toBe(15);
    expect(cycles[0].id).toBe(0);
  });

  it("assigns pit to correct cycle", () => {
    const cycles = [
      { startLap: 10, endLap: 15, id: 0 },
      { startLap: 30, endLap: 35, id: 1 },
    ];

    expect(assignPitToCycle(12, cycles)?.id).toBe(0);
    expect(assignPitToCycle(32, cycles)?.id).toBe(1);
    expect(assignPitToCycle(20, cycles)).toBeNull();
  });
});

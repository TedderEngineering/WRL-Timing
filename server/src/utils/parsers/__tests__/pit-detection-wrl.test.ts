/**
 * Unit tests for WRL pit stop detection via lap-time anomaly.
 */
import { describe, it, expect } from "vitest";
import {
  detectPitStopsWRL,
  medianOf,
  GREEN_PIT_THRESHOLD,
  FCY_PIT_THRESHOLD,
  GARAGE_THRESHOLD_SECONDS,
  PIT_GROUP_GAP,
} from "../csv-utils.js";

// ─── Helper: build lap rows for a car ───────────────────────────────────────

type LapRow = { l: number; ltSec: number; flag: string };

/**
 * Build a minimal fixture modeled on car #120 at Thunderhill 2026.
 * Green median ≈ 115s. Most pit laps are 175–220s (>1.5× median).
 * Lap 200 is a green-flag quick pit at 1.49× (above 1.42× green threshold
 * but below the old 1.5× uniform threshold — this is the case the
 * split-threshold fix catches).
 * Yellow laps stay ≤ 164s (<1.43× median).
 * Red flag laps at 500s should be excluded.
 */
function buildCar120Fixture(): LapRow[] {
  const laps: LapRow[] = [];
  const greenBase = 115; // typical green lap time

  // Pit stop laps and their approximate times
  const pitLapTimes: Record<number, number> = {
    35: 195,  // green-flag pit
    46: 180,  // yellow-flag pit
    84: 210,  // green-flag pit
    89: 175,  // yellow-flag pit (above 1.5× FCY threshold)
    98: 220,  // green-flag pit
    129: 185, // yellow-flag pit
    200: 171.4, // green-flag quick pit: 1.490× median (above 1.42× green threshold)
  };

  // Yellow-flag lap ranges (non-pit yellow laps stay at 1.0–1.43× median)
  const yellowRanges: [number, number][] = [
    [44, 50], [86, 92], [126, 132],
  ];
  const isYellow = (l: number) =>
    yellowRanges.some(([s, e]) => l >= s && l <= e);

  // Red flag lap
  const redLaps = new Set([70]);

  for (let l = 1; l <= 210; l++) {
    if (redLaps.has(l)) {
      laps.push({ l, ltSec: 500, flag: "RED" });
      continue;
    }

    const flag = isYellow(l) ? "FCY" : "GREEN";

    if (pitLapTimes[l] !== undefined) {
      laps.push({ l, ltSec: pitLapTimes[l], flag });
      continue;
    }

    // Normal lap: green ≈ 113–117s, yellow ≈ 120–164s (under 1.43× threshold)
    if (flag === "FCY") {
      // Normal yellow lap — keep well under 1.5× median
      laps.push({ l, ltSec: greenBase * (1.0 + Math.random() * 0.4), flag });
    } else {
      // Normal green lap — slight variation
      laps.push({ l, ltSec: greenBase + (Math.random() - 0.5) * 4, flag });
    }
  }

  return laps;
}

/**
 * Build a fixture for car #119 at Thunderhill 2026.
 * Green median ≈ 115s. Has two extended garage stays:
 *   - Lap 4: 6154s (1.71 hours) — GREEN flag
 *   - Lap 48: 1572s (26 min) — GREEN flag
 * Both are real stops where the car was in the garage.
 * Also has normal pit stops at laps 20, 35, 60.
 */
function buildCar119Fixture(): LapRow[] {
  const laps: LapRow[] = [];
  const greenBase = 115;

  const specialLaps: Record<number, { ltSec: number; flag: string }> = {
    4: { ltSec: 6154, flag: "GREEN" },   // garage stay: 1.71 hours
    20: { ltSec: 200, flag: "GREEN" },    // normal pit
    35: { ltSec: 190, flag: "GREEN" },    // normal pit
    48: { ltSec: 1572, flag: "GREEN" },   // garage stay: 26 min
    60: { ltSec: 210, flag: "GREEN" },    // normal pit
  };

  for (let l = 1; l <= 70; l++) {
    if (specialLaps[l]) {
      laps.push({ l, ...specialLaps[l] });
    } else {
      laps.push({ l, ltSec: greenBase + (Math.random() - 0.5) * 4, flag: "GREEN" });
    }
  }

  return laps;
}

/**
 * Build a fixture for car #55 at Thunderhill 2026.
 * Has one extremely long garage stay at lap 18: 16211s (4.5 hours).
 * Also has normal pits at laps 10, 30.
 */
function buildCar55Fixture(): LapRow[] {
  const laps: LapRow[] = [];
  const greenBase = 115;

  const specialLaps: Record<number, number> = {
    10: 200,      // normal pit
    18: 16211,    // garage stay: 4.5 hours
    30: 195,      // normal pit
  };

  for (let l = 1; l <= 40; l++) {
    if (specialLaps[l]) {
      laps.push({ l, ltSec: specialLaps[l], flag: "GREEN" });
    } else {
      laps.push({ l, ltSec: greenBase + (Math.random() - 0.5) * 4, flag: "GREEN" });
    }
  }

  return laps;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("detectPitStopsWRL", () => {
  it("detects 7 pit stops for car #120 Thunderhill fixture", () => {
    const laps = buildCar120Fixture();
    const { pitLaps, garageLaps } = detectPitStopsWRL(laps);

    // Lap 200 is a green-flag quick pit at 1.49× — caught by GREEN_PIT_THRESHOLD (1.42)
    expect(pitLaps).toEqual(new Set([35, 46, 84, 89, 98, 129, 200]));
    // No garage stays (all pit laps < 900s)
    expect(garageLaps.size).toBe(0);
  });

  it("returns empty result when car has no green-flag laps", () => {
    const laps: LapRow[] = [
      { l: 1, ltSec: 130, flag: "FCY" },
      { l: 2, ltSec: 140, flag: "FCY" },
      { l: 3, ltSec: 200, flag: "FCY" },
    ];
    const { pitLaps } = detectPitStopsWRL(laps);
    expect(pitLaps.size).toBe(0);
  });

  it("excludes RED flag laps even if they exceed threshold", () => {
    const laps: LapRow[] = [];
    for (let l = 1; l <= 20; l++) {
      laps.push({ l, ltSec: 115, flag: "GREEN" });
    }
    // Red flag lap at 500s — should NOT be flagged as pit
    laps.push({ l: 21, ltSec: 500, flag: "RED" });
    // Actual pit at lap 22 under green
    laps.push({ l: 22, ltSec: 200, flag: "GREEN" });

    const { pitLaps } = detectPitStopsWRL(laps);
    expect(pitLaps).toEqual(new Set([22]));
    expect(pitLaps.has(21)).toBe(false);
  });

  it("groups consecutive slow laps within PIT_GROUP_GAP as one stop", () => {
    const laps: LapRow[] = [];
    for (let l = 1; l <= 30; l++) {
      laps.push({ l, ltSec: 115, flag: "GREEN" });
    }
    // Two consecutive slow laps (laps 10, 11) — should be one pit at lap 10
    laps[9].ltSec = 200;
    laps[10].ltSec = 190;

    const { pitLaps } = detectPitStopsWRL(laps);
    expect(pitLaps).toEqual(new Set([10]));
  });

  it("separates pit groups when gap exceeds PIT_GROUP_GAP", () => {
    const laps: LapRow[] = [];
    for (let l = 1; l <= 30; l++) {
      laps.push({ l, ltSec: 115, flag: "GREEN" });
    }
    // Slow at lap 10 and lap 15 — gap of 5 > PIT_GROUP_GAP=2, so two stops
    laps[9].ltSec = 200;
    laps[14].ltSec = 200;

    const { pitLaps } = detectPitStopsWRL(laps);
    expect(pitLaps).toEqual(new Set([10, 15]));
  });

  it("uses lower threshold for green laps than yellow laps", () => {
    const laps: LapRow[] = [];
    for (let l = 1; l <= 20; l++) {
      laps.push({ l, ltSec: 115, flag: "GREEN" });
    }
    // Green lap at 1.45× (163.3s) — above GREEN_PIT_THRESHOLD (1.42) → detected
    laps.push({ l: 21, ltSec: 115 * 1.45, flag: "GREEN" });
    // Yellow lap at 1.45× (163.3s) — below FCY_PIT_THRESHOLD (1.50) → NOT detected
    laps.push({ l: 22, ltSec: 115 * 1.45, flag: "FCY" });

    const { pitLaps } = detectPitStopsWRL(laps);
    expect(pitLaps.has(21)).toBe(true);  // green: caught at 1.42
    expect(pitLaps.has(22)).toBe(false); // yellow: not caught until 1.50
  });

  it("detects pit under yellow flag", () => {
    const laps: LapRow[] = [];
    for (let l = 1; l <= 20; l++) {
      laps.push({ l, ltSec: 115, flag: "GREEN" });
    }
    // Yellow-flag pit at lap 15: 180s = 1.57× green median
    laps[14] = { l: 15, ltSec: 180, flag: "FCY" };

    const { pitLaps } = detectPitStopsWRL(laps);
    expect(pitLaps).toEqual(new Set([15]));
  });

  it("no longer excludes laps > 600s — they are garage stays, not ignored", () => {
    const laps: LapRow[] = [];
    for (let l = 1; l <= 20; l++) {
      laps.push({ l, ltSec: 115, flag: "GREEN" });
    }
    // 700s green-flag lap — previously excluded by 600s cap, now detected as pit
    laps.push({ l: 21, ltSec: 700, flag: "GREEN" });

    const { pitLaps } = detectPitStopsWRL(laps);
    expect(pitLaps.has(21)).toBe(true);
  });
});

describe("garage detection", () => {
  it("car #119: lap 4 (6154s) and lap 48 (1572s) are garage stays", () => {
    const laps = buildCar119Fixture();
    const { pitLaps, garageLaps } = detectPitStopsWRL(laps);

    // Both garage stays and normal pits appear in pitLaps
    expect(pitLaps.has(4)).toBe(true);   // garage: 6154s
    expect(pitLaps.has(48)).toBe(true);  // garage: 1572s
    expect(pitLaps.has(20)).toBe(true);  // normal pit: 200s
    expect(pitLaps.has(35)).toBe(true);  // normal pit: 190s
    expect(pitLaps.has(60)).toBe(true);  // normal pit: 210s

    // Only garage stays appear in garageLaps
    expect(garageLaps).toEqual(new Set([4, 48]));
    expect(garageLaps.has(20)).toBe(false);
    expect(garageLaps.has(35)).toBe(false);
    expect(garageLaps.has(60)).toBe(false);
  });

  it("car #55: lap 18 (16211s) is a garage stay", () => {
    const laps = buildCar55Fixture();
    const { pitLaps, garageLaps } = detectPitStopsWRL(laps);

    expect(pitLaps.has(10)).toBe(true);  // normal pit
    expect(pitLaps.has(18)).toBe(true);  // garage: 16211s
    expect(pitLaps.has(30)).toBe(true);  // normal pit

    expect(garageLaps).toEqual(new Set([18]));
  });

  it("normal pits are never in garageLaps", () => {
    const laps: LapRow[] = [];
    for (let l = 1; l <= 20; l++) {
      laps.push({ l, ltSec: 115, flag: "GREEN" });
    }
    laps.push({ l: 21, ltSec: 200, flag: "GREEN" }); // normal pit: 200s

    const { pitLaps, garageLaps } = detectPitStopsWRL(laps);
    expect(pitLaps.has(21)).toBe(true);
    expect(garageLaps.size).toBe(0);
  });

  it("threshold is exactly 900 seconds", () => {
    const laps: LapRow[] = [];
    for (let l = 1; l <= 30; l++) {
      laps.push({ l, ltSec: 115, flag: "GREEN" });
    }
    // Just under: 899s — pit but not garage (spaced apart to avoid grouping)
    laps[9].ltSec = 899;   // lap 10
    // Just over: 901s — pit AND garage
    laps[19].ltSec = 901;  // lap 20

    const { pitLaps, garageLaps } = detectPitStopsWRL(laps);
    expect(pitLaps.has(10)).toBe(true);
    expect(pitLaps.has(20)).toBe(true);
    expect(garageLaps.has(10)).toBe(false); // 899 ≤ 900
    expect(garageLaps.has(20)).toBe(true);  // 901 > 900
  });
});

describe("medianOf", () => {
  it("returns middle value for odd-length array", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
  });

  it("returns average of two middle values for even-length array", () => {
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
  });

  it("handles single-element array", () => {
    expect(medianOf([42])).toBe(42);
  });
});

describe("constants", () => {
  it("exports expected threshold values", () => {
    expect(GREEN_PIT_THRESHOLD).toBe(1.42);
    expect(FCY_PIT_THRESHOLD).toBe(1.50);
    expect(GARAGE_THRESHOLD_SECONDS).toBe(900);
    expect(PIT_GROUP_GAP).toBe(2);
  });

  it("green threshold is lower than FCY threshold", () => {
    expect(GREEN_PIT_THRESHOLD).toBeLessThan(FCY_PIT_THRESHOLD);
  });
});

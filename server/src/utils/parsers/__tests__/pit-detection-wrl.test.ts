/**
 * Unit tests for WRL pit stop detection — flags-based + legacy fallback.
 */
import { describe, it, expect } from "vitest";
import {
  detectPitStopsWRL,
  detectAllCarPitStops,
  parseFlagsCSV,
  flagAtElapsed,
  yellowP25Pace,
  parseControlLogCSV,
  enrichAnnotationsFromControlLog,
  medianOf,
  GREEN_PIT_THRESHOLD,
  YELLOW_PIT_THRESHOLD,
  GARAGE_THRESHOLD_SECONDS,
  PIT_GROUP_GAP,
  type PitDetectLapRow,
  type FlagPeriod,
} from "../csv-utils.js";

// ─── Helpers ─────��──────────────────────────────��───────────────────────────

function makeLap(l: number, ltSec: number, flag: string, p: number = 10): PitDetectLapRow {
  return { l, ltSec, flag, p };
}

function buildGreenLaps(
  count: number,
  base: number = 115,
  overrides: Record<number, Partial<PitDetectLapRow>> = {}
): PitDetectLapRow[] {
  const laps: PitDetectLapRow[] = [];
  for (let l = 1; l <= count; l++) {
    const ov = overrides[l];
    laps.push({
      l,
      ltSec: ov?.ltSec ?? (base + (Math.random() - 0.5) * 4),
      flag: ov?.flag ?? "GREEN",
      p: ov?.p ?? 10,
    });
  }
  return laps;
}

// ─── Flag period fixture (Thunderhill 2026 simplified) ──────────────────────

const THUNDERHILL_FLAGS: FlagPeriod[] = [
  { flag: "Green",     startSec: 0,     endSec: 5192 },   // 0:00 – 1:26:32
  { flag: "Yellow",    startSec: 5193,  endSec: 6340 },   // 1:26:33 – 1:45:40
  { flag: "Green",     startSec: 6341,  endSec: 10869 },  // 1:45:41 – 3:01:09
  { flag: "Yellow",    startSec: 10870, endSec: 11389 },  // 3:01:10 – 3:09:49
  { flag: "Green",     startSec: 11390, endSec: 12079 },  // 3:09:50 – 3:21:19
  { flag: "Yellow",    startSec: 12080, endSec: 12709 },  // 3:21:20 – 3:31:49
  { flag: "Green",     startSec: 12710, endSec: 16109 },  // 3:31:50 – 4:28:29
  { flag: "Yellow",    startSec: 16110, endSec: 16769 },  // 4:28:30 – 4:39:29
  { flag: "Green",     startSec: 16770, endSec: 20339 },  // 4:39:30 – 5:38:59
  { flag: "Red",       startSec: 20340, endSec: 21069 },  // 5:39:00 – 5:51:09
  { flag: "Yellow",    startSec: 21070, endSec: 21679 },  // 5:51:10 – 6:01:19
  { flag: "Green",     startSec: 21680, endSec: 21799 },  // 6:01:20 – 6:03:19
  { flag: "Yellow",    startSec: 21800, endSec: 22399 },  // 6:03:20 – 6:13:19
  { flag: "Green",     startSec: 22400, endSec: 28699 },  // 6:13:20 – 7:58:19
  { flag: "Checkered", startSec: 28700, endSec: 34299 },
];

// ─── Tests: parseFlagsCSV ──────���────────────────────────────────────────────

describe("parseFlagsCSV", () => {
  it("parses valid flags CSV", () => {
    const csv = [
      "Flag,Start,End,Duration",
      "Green,2026-04-04 09:00:00,2026-04-04 10:00:00,1:00:00",
      "Yellow,2026-04-04 10:00:01,2026-04-04 10:15:00,14:59",
      "Green,2026-04-04 10:15:01,2026-04-04 11:00:00,44:59",
    ].join("\n");
    const { periods } = parseFlagsCSV(csv);
    expect(periods.length).toBe(3);
    expect(periods[0].flag).toBe("Green");
    expect(periods[0].startSec).toBe(0);
    expect(periods[0].endSec).toBe(3600);
    expect(periods[1].flag).toBe("Yellow");
    expect(periods[1].startSec).toBe(3601);
    expect(periods[2].flag).toBe("Green");
  });

  it("discards rows with empty Flag", () => {
    const csv = [
      "Flag,Start,End,Duration",
      "Green,2026-04-04 09:00:00,2026-04-04 10:00:00,1:00:00",
      ",2026-04-04 10:00:01,2026-04-04 10:05:00,4:59",
      "Yellow,2026-04-04 10:05:01,2026-04-04 10:15:00,9:59",
    ].join("\n");
    const { periods } = parseFlagsCSV(csv);
    expect(periods.length).toBe(2);
    expect(periods[0].flag).toBe("Green");
    expect(periods[1].flag).toBe("Yellow");
  });

  it("returns empty for missing headers", () => {
    const csv = "Col1,Col2,Col3\nA,B,C\n";
    expect(parseFlagsCSV(csv).periods.length).toBe(0);
  });

  it("race start from first Green row", () => {
    const csv = [
      "Flag,Start,End,Duration",
      "Yellow,2026-04-04 08:55:00,2026-04-04 08:59:59,4:59",
      "Green,2026-04-04 09:00:00,2026-04-04 10:00:00,1:00:00",
    ].join("\n");
    const { periods, raceStartMs } = parseFlagsCSV(csv);
    expect(periods[0].flag).toBe("Yellow");
    expect(periods[0].startSec).toBe(-300); // 5 min before race start
    expect(periods[1].startSec).toBe(0);     // race start
    expect(raceStartMs).toBeGreaterThan(0);  // race start wall-clock available
  });
});

// ─── Tests: flagAtElapsed ───────────────────────────────────────────────────

describe("flagAtElapsed", () => {
  const periods: FlagPeriod[] = [
    { flag: "Green",  startSec: 0,   endSec: 100 },
    { flag: "Yellow", startSec: 101, endSec: 200 },
    { flag: "Green",  startSec: 201, endSec: 400 },
  ];

  it("returns Green for time in green period", () => {
    expect(flagAtElapsed(50, periods)).toBe("Green");
  });

  it("returns Yellow for time in yellow period", () => {
    expect(flagAtElapsed(150, periods)).toBe("Yellow");
  });

  it("returns closest prior flag for gap between periods", () => {
    // Time 500 is after all periods — closest prior is Green (ended at 400)
    expect(flagAtElapsed(500, periods)).toBe("Green");
  });

  it("returns Unknown for time before all periods", () => {
    expect(flagAtElapsed(-10, periods)).toBe("Unknown");
  });
});

// ─── Tests: yellowP25Pace ───────────────────────────────────────────────────

describe("yellowP25Pace", () => {
  it("returns P25 of laps in the yellow window", () => {
    const yellowPeriod: FlagPeriod = { flag: "Yellow", startSec: 1000, endSec: 2000 };
    // 20 cars, each with 1 lap crossing at 1500s with various times
    const allCarLaps = new Map<string, PitDetectLapRow[]>();
    const cumTimes = new Map<string, Map<number, number>>();
    for (let c = 0; c < 20; c++) {
      const lt = 120 + c * 10; // 120, 130, 140, ..., 310
      allCarLaps.set(String(c), [makeLap(1, lt, "FCY")]);
      cumTimes.set(String(c), new Map([[1, 1500]])); // all cross at 1500s
    }
    const p25 = yellowP25Pace(yellowPeriod, allCarLaps, cumTimes);
    expect(p25).not.toBeNull();
    // P25 of [120,130,...,310] = 20 values, index 5 = 170
    expect(p25).toBe(170);
  });

  it("returns null with fewer than 5 laps", () => {
    const yellowPeriod: FlagPeriod = { flag: "Yellow", startSec: 1000, endSec: 2000 };
    const allCarLaps = new Map<string, PitDetectLapRow[]>();
    const cumTimes = new Map<string, Map<number, number>>();
    for (let c = 0; c < 3; c++) {
      allCarLaps.set(String(c), [makeLap(1, 150, "FCY")]);
      cumTimes.set(String(c), new Map([[1, 1500]]));
    }
    expect(yellowP25Pace(yellowPeriod, allCarLaps, cumTimes)).toBeNull();
  });

  it("excludes laps >= 600s from P25 calculation", () => {
    const yellowPeriod: FlagPeriod = { flag: "Yellow", startSec: 1000, endSec: 2000 };
    const allCarLaps = new Map<string, PitDetectLapRow[]>();
    const cumTimes = new Map<string, Map<number, number>>();
    // 5 normal + 5 garage-speed laps
    for (let c = 0; c < 10; c++) {
      const lt = c < 5 ? 150 : 800;
      allCarLaps.set(String(c), [makeLap(1, lt, "FCY")]);
      cumTimes.set(String(c), new Map([[1, 1500]]));
    }
    const p25 = yellowP25Pace(yellowPeriod, allCarLaps, cumTimes);
    expect(p25).toBe(150); // only the 5 normal laps count
  });
});

// ─── Tests: detectAllCarPitStops with flagPeriods ───────────────────────────

describe("detectAllCarPitStops with flagPeriods", () => {
  it("falls back to threshold-only when no flagPeriods provided", () => {
    const laps = buildGreenLaps(20, 115, { 10: { ltSec: 200 } });
    const allCars = new Map([["120", laps]]);
    const classes = new Map([["120", "GTO"]]);
    const results = detectAllCarPitStops(allCars, classes);
    expect(results.get("120")!.pitLaps.has(10)).toBe(true);
  });

  it("falls back to threshold-only when flagPeriods is empty", () => {
    const laps = buildGreenLaps(20, 115, { 10: { ltSec: 200 } });
    const allCars = new Map([["120", laps]]);
    const classes = new Map([["120", "GTO"]]);
    const results = detectAllCarPitStops(allCars, classes, []);
    expect(results.get("120")!.pitLaps.has(10)).toBe(true);
  });

  it("detects green-period pit stops using GREEN_PIT_THRESHOLD", () => {
    // All laps in a green period
    const flags: FlagPeriod[] = [{ flag: "Green", startSec: 0, endSec: 50000 }];
    const laps = buildGreenLaps(30, 115, { 15: { ltSec: 200 } });
    const allCars = new Map([["1", laps]]);
    const classes = new Map([["1", "GTO"]]);
    const results = detectAllCarPitStops(allCars, classes, flags);
    expect(results.get("1")!.pitLaps.has(15)).toBe(true);
  });

  it("excludes RED period laps from pit detection", () => {
    // Place red period at 1700-2500s so lap 15 (~1725s cumulative) lands in it
    const flags: FlagPeriod[] = [
      { flag: "Green", startSec: 0,    endSec: 1699 },
      { flag: "Red",   startSec: 1700, endSec: 2500 },
      { flag: "Green", startSec: 2501, endSec: 5000 },
    ];
    // Lap 15 cumulative ≈ 15 * 115 = 1725s → in Red period
    // Make it slow (500s) — should NOT be detected as pit because it's Red
    const laps = buildGreenLaps(30, 115, {
      15: { ltSec: 500 },
    });
    const allCars = new Map([["1", laps]]);
    const classes = new Map([["1", "GTO"]]);
    const results = detectAllCarPitStops(allCars, classes, flags);
    expect(results.get("1")!.pitLaps.has(15)).toBe(false);
  });

  it("detects garage stays regardless of flag period", () => {
    const flags: FlagPeriod[] = [{ flag: "Green", startSec: 0, endSec: 50000 }];
    const laps = buildGreenLaps(30, 115, { 10: { ltSec: 1500 } });
    const allCars = new Map([["1", laps]]);
    const classes = new Map([["1", "GTO"]]);
    const results = detectAllCarPitStops(allCars, classes, flags);
    expect(results.get("1")!.pitLaps.has(10)).toBe(true);
    expect(results.get("1")!.garageLaps.has(10)).toBe(true);
  });
});

// ─── Tests: legacy fallback (detectPitStopsWRL) ─────────────────────────────

describe("detectPitStopsWRL (legacy fallback)", () => {
  it("detects green-flag pits", () => {
    const laps = buildGreenLaps(30, 115, {
      10: { ltSec: 200 },
      20: { ltSec: 195 },
    });
    const { pitLaps } = detectPitStopsWRL(laps);
    expect(pitLaps.has(10)).toBe(true);
    expect(pitLaps.has(20)).toBe(true);
  });

  it("returns empty when no green laps", () => {
    const laps: PitDetectLapRow[] = [
      makeLap(1, 130, "FCY"),
      makeLap(2, 140, "FCY"),
      makeLap(3, 200, "FCY"),
    ];
    expect(detectPitStopsWRL(laps).pitLaps.size).toBe(0);
  });

  it("excludes RED flag laps", () => {
    const laps = buildGreenLaps(22, 115, {
      21: { ltSec: 500, flag: "RED" },
      22: { ltSec: 200, flag: "GREEN" },
    });
    const { pitLaps } = detectPitStopsWRL(laps);
    expect(pitLaps.has(21)).toBe(false);
    expect(pitLaps.has(22)).toBe(true);
  });

  it("groups consecutive slow laps", () => {
    const laps = buildGreenLaps(30, 115, {
      10: { ltSec: 200 },
      11: { ltSec: 190 },
    });
    expect(detectPitStopsWRL(laps).pitLaps).toEqual(new Set([10]));
  });

  it("detects garage stays", () => {
    const laps = buildGreenLaps(30, 115, { 20: { ltSec: 1500 } });
    const { pitLaps, garageLaps } = detectPitStopsWRL(laps);
    expect(pitLaps.has(20)).toBe(true);
    expect(garageLaps.has(20)).toBe(true);
  });
});

// ─── Tests: medianOf and constants ──────────────────────────────────────────

describe("medianOf", () => {
  it("odd-length", () => expect(medianOf([3, 1, 2])).toBe(2));
  it("even-length", () => expect(medianOf([4, 1, 3, 2])).toBe(2.5));
  it("single", () => expect(medianOf([42])).toBe(42));
});

describe("constants", () => {
  it("exports expected values", () => {
    expect(GREEN_PIT_THRESHOLD).toBe(1.42);
    expect(YELLOW_PIT_THRESHOLD).toBe(1.40);
    expect(GARAGE_THRESHOLD_SECONDS).toBe(900);
    expect(PIT_GROUP_GAP).toBe(2);
  });
});

// ─── Tests: parseControlLogCSV ──────────────────────────────────────────────

describe("parseControlLogCSV", () => {
  const raceStartMs = new Date("2026-04-05T09:00:00").getTime();

  it("parses penalty events", () => {
    const csv = [
      "Sequence,Timestamp,Corner,Car_1,Car_1_At_Fault,Car_2,Car_2_At_Fault,Description,Action,Status,Notes",
      "10,2026-04-05T10:00:00,5,#59 Team A,Yes,,,Pit Lane Infraction,1 Lap,Final,",
      "11,2026-04-05T10:05:00,,,,,,,No Action Needed,Final,",
    ].join("\n");
    const events = parseControlLogCSV(csv, raceStartMs);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("penalty");
    expect(events[0].carNumbers).toEqual([59]);
    expect(events[0].action).toBe("1 Lap");
    expect(events[0].elapsedSec).toBe(3600);
  });

  it("parses garage context events", () => {
    const csv = [
      "Sequence,Timestamp,Corner,Car_1,Car_1_At_Fault,Car_2,Car_2_At_Fault,Description,Action,Status,Notes",
      "20,2026-04-05T11:00:00,8,#119 AE Victory,,,,Stopped DL.,No Action Needed,Final,",
    ].join("\n");
    const events = parseControlLogCSV(csv, raceStartMs);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("garage_context");
    expect(events[0].carNumbers).toEqual([119]);
    expect(events[0].description).toBe("Stopped DL.");
  });

  it("extracts multiple car numbers", () => {
    const csv = [
      "Sequence,Timestamp,Corner,Car_1,Car_1_At_Fault,Car_2,Car_2_At_Fault,Description,Action,Status,Notes",
      "30,2026-04-05T12:00:00,3,#330 HQ Auto,Yes,#25 Team B,Yes,Contact,1 Lap,Final,",
    ].join("\n");
    const events = parseControlLogCSV(csv, raceStartMs);
    expect(events.length).toBe(1);
    expect(events[0].carNumbers).toEqual([330, 25]);
    expect(events[0].type).toBe("penalty");
  });

  it("skips non-actionable events", () => {
    const csv = [
      "Sequence,Timestamp,Corner,Car_1,Car_1_At_Fault,Car_2,Car_2_At_Fault,Description,Action,Status,Notes",
      "1,2026-04-05T09:00:00,,,,,,Green Flag,,,",
      "5,2026-04-05T09:30:00,11,#290 Team,,,,4OFF,Warning,Final,",
    ].join("\n");
    const events = parseControlLogCSV(csv, raceStartMs);
    expect(events.length).toBe(0);
  });
});

// ─── Tests: enrichAnnotationsFromControlLog ─────────────────────────────────

describe("enrichAnnotationsFromControlLog", () => {
  it("adds penalty text to reasons dict", () => {
    // Car with 10 laps, each 115s. Penalty at elapsed 575s (~lap 5)
    const cars: Record<string, { laps: Array<{ l: number; ltSec: number; pit: number }> }> = {
      "59": { laps: Array.from({ length: 10 }, (_, i) => ({
        l: i + 1,
        ltSec: i === 5 ? 200 : 115, // lap 6 is slow (penalty serving pit)
        pit: i === 5 ? 1 : 0,     // lap 6 is a pit lap
      })) },
    };
    const annotations: Record<string, any> = {
      "59": { reasons: {}, pits: [], settles: [] },
    };
    const events = [{
      sequence: 10,
      timestampMs: 0,
      elapsedSec: 575,  // ~lap 5 — penalty issued, served at next pit lap (6)
      carNumbers: [59],
      description: "Pit Lane Infraction",
      action: "1 Lap",
      status: "Final",
      type: "penalty" as const,
    }];

    enrichAnnotationsFromControlLog(annotations, events, cars);
    // Penalty should appear on the first pit lap at or after the event (lap 6)
    expect(annotations["59"].reasons["6"]).toContain("Penalty: 1 Lap");
  });

  it("enriches garage marker label with reason text", () => {
    const cars: Record<string, any> = {
      "119": { laps: Array.from({ length: 10 }, (_, i) => ({
        l: i + 1, ltSec: 115, pit: 0,
      })) },
    };
    const annotations: Record<string, any> = {
      "119": {
        reasons: {},
        pits: [{ l: 5, lb: "Pit 2 (garage)", c: "#f97316", isGarage: true }],
        settles: [],
      },
    };
    const events = [{
      sequence: 20,
      timestampMs: 0,
      elapsedSec: 500,  // ~lap 4-5
      carNumbers: [119],
      description: "Stopped DL.",
      action: "No Action Needed",
      status: "Final",
      type: "garage_context" as const,
    }];

    enrichAnnotationsFromControlLog(annotations, events, cars);
    expect(annotations["119"].pits[0].lb).toContain("Stopped DL");
  });
});

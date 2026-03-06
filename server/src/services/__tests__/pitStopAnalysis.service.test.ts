import { describe, it, expect } from "vitest";
import {
  normalizeTrackName,
  computeGlobalBaseline,
  computeLocalRef,
  analyzePitStop,
} from "../pitStopAnalysis.service.js";

// ─── normalizeTrackName ─────────────────────────────────────────────────────

describe("normalizeTrackName", () => {
  it("maps known variants to canonical slugs", () => {
    expect(normalizeTrackName("Barber Motorsports Park")).toBe("barber");
    expect(normalizeTrackName("COTA")).toBe("cota");
    expect(normalizeTrackName("Virginia International Raceway")).toBe("vir");
    expect(normalizeTrackName("Road America")).toBe("road-america");
    expect(normalizeTrackName("  Sebring  ")).toBe("sebring");
  });

  it("returns lowercased input for unknown tracks", () => {
    expect(normalizeTrackName("Watkins Glen")).toBe("watkins glen");
  });
});

// ─── computeGlobalBaseline ──────────────────────────────────────────────────

describe("computeGlobalBaseline", () => {
  it("returns median of clean non-pit laps", () => {
    const laps = Array.from({ length: 50 }, (_, i) => ({
      lapTime: 96.4 + (i % 3) * 0.1, // 96.4, 96.5, 96.6 repeating
      inPit: false,
    }));
    const baseline = computeGlobalBaseline(laps);
    expect(baseline).toBeCloseTo(96.5, 1);
  });

  it("filters out caution laps", () => {
    const laps = [
      ...Array.from({ length: 10 }, () => ({ lapTime: 96.4, inPit: false })),
      { lapTime: 230.0, inPit: false }, // caution lap
    ];
    const baseline = computeGlobalBaseline(laps);
    expect(baseline).toBeCloseTo(96.4, 1);
  });

  it("returns 0 for all-pit laps", () => {
    const laps = [{ lapTime: 120.0, inPit: true }];
    expect(computeGlobalBaseline(laps)).toBe(0);
  });
});

// ─── computeLocalRef ────────────────────────────────────────────────────────

describe("computeLocalRef", () => {
  it("normal case: reliable local reference from 5 clean laps", () => {
    const carLaps = Array.from({ length: 59 }, (_, i) => ({
      lapNumber: i + 1,
      lapTime: 96.4,
      inPit: i + 1 === 59, // lap 59 is pit
    }));
    const result = computeLocalRef(carLaps, 59, 96.429);
    expect(result.isReliable).toBe(true);
    expect(result.source).toBe("local (5 laps)");
    expect(result.value).toBeCloseTo(96.4, 1);
  });

  it("sparse case: prior pit reduces clean window", () => {
    // Laps 50-60, pit at 53, out-lap 54 (skipped), clean 55-57, pit at 58
    const carLaps: { lapNumber: number; lapTime: number; inPit: boolean }[] = [];
    for (let n = 50; n <= 60; n++) {
      carLaps.push({
        lapNumber: n,
        lapTime: 96.4,
        inPit: n === 53 || n === 58,
      });
    }
    const result = computeLocalRef(carLaps, 58, 96.429);
    expect(result.isReliable).toBe(true);
    expect(result.source).toBe("local (3 laps)");
  });

  it("global fallback when all prior laps are caution", () => {
    const carLaps = Array.from({ length: 10 }, (_, i) => ({
      lapNumber: 125 + i,
      lapTime: 230.0, // all caution
      inPit: 125 + i === 131,
    }));
    const result = computeLocalRef(carLaps, 131, 96.4);
    expect(result.source).toBe("global fallback");
    expect(result.value).toBe(96.4);
    expect(result.isReliable).toBe(false);
  });
});

// ─── analyzePitStop ─────────────────────────────────────────────────────────

const BARBER_CONFIG = {
  transitTime_s: 34.62,
  transitOverhead_s: 23.79,
};

describe("analyzePitStop", () => {
  it("green flag stop — Barber validation anchor", () => {
    // Car 119, Stop 11, Lap 266
    const carLaps = [
      ...Array.from({ length: 5 }, (_, i) => ({
        lapNumber: 261 + i,
        lapTime: 98.0,
        inPit: false,
      })),
      { lapNumber: 266, lapTime: 114.2, inPit: true }, // pit lap
      { lapNumber: 267, lapTime: 103.4, inPit: false }, // out-lap
    ];

    const result = analyzePitStop(carLaps, 266, 11, BARBER_CONFIG, 96.429);
    expect(result).not.toBeNull();
    expect(result!.twoLapActual_s).toBeCloseTo(217.6, 1);
    expect(result!.condition).toBe("Full green");
    expect(result!.serviceTime_s).toBeCloseTo(217.6 - 98.0 * 2 - 23.79, 1);
    expect(result!.pitRoadTime_s).toBeCloseTo(
      34.62 + result!.serviceTime_s,
      1
    );
    expect(result!.delta_s).toBeCloseTo(-10.83, 0.15);
  });

  it("full Code 35 stop — both laps under caution", () => {
    // Clean laps, then Code 35 deploys, car pits under caution
    const carLaps = [
      ...Array.from({ length: 3 }, (_, i) => ({
        lapNumber: 50 + i,
        lapTime: 96.4,
        inPit: false,
      })),
      { lapNumber: 53, lapTime: 230.0, inPit: false }, // C35 deployed
      { lapNumber: 54, lapTime: 230.0, inPit: false }, // inLap under C35
      { lapNumber: 55, lapTime: 230.0, inPit: true },  // pit under C35
      { lapNumber: 56, lapTime: 230.0, inPit: false },  // out under C35
    ];

    const result = analyzePitStop(carLaps, 55, 1, BARBER_CONFIG, 96.4);
    expect(result).not.toBeNull();
    expect(result!.condition).toBe("C35-in, C35-out");
    expect(result!.delta_s).toBeCloseTo(-34.62, 0.15);
  });

  it("returns null when out-lap is missing", () => {
    const carLaps = [
      { lapNumber: 10, lapTime: 96.4, inPit: false },
      { lapNumber: 11, lapTime: 120.0, inPit: true },
      // no lap 12
    ];
    const result = analyzePitStop(carLaps, 11, 1, BARBER_CONFIG, 96.4);
    expect(result).toBeNull();
  });
});

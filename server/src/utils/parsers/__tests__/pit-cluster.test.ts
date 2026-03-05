/**
 * Unit tests for cluster-based pit timing: calcCarBaseline & calcPitStopNetTime.
 */
import { describe, it, expect } from "vitest";
import {
  calcCarBaseline,
  calcPitStopNetTime,
} from "../position-analysis.js";

// ─── Helper to build minimal LapData ─────────────────────────────────────────

interface MinimalLap {
  l: number;
  ltSec: number;
  pit?: number;
}

function makeLaps(data: MinimalLap[]) {
  return data.map((d) => ({
    l: d.l,
    p: 1,
    cp: 1,
    lt: "",
    ltSec: d.ltSec,
    flag: "GF",
    pit: d.pit ?? 0,
  }));
}

// ─── calcCarBaseline ─────────────────────────────────────────────────────────

describe("calcCarBaseline", () => {
  it("computes correct mean for normal lap distribution", () => {
    // 20 laps around 120s, well within ±15% of median
    const laps = makeLaps(
      Array.from({ length: 20 }, (_, i) => ({
        l: i + 1,
        ltSec: 118 + (i % 5), // 118, 119, 120, 121, 122 repeating
      })),
    );
    const baseline = calcCarBaseline(laps, new Set());
    // Median should be ~120, all within ±15%, so mean of all 20
    expect(baseline).toBeCloseTo(120, 0);
    expect(baseline).toBeGreaterThan(118);
    expect(baseline).toBeLessThan(122);
  });

  it("excludes outliers beyond ±15% of median", () => {
    // 15 normal laps at ~130s + 3 outliers at 200s
    const normal = Array.from({ length: 15 }, (_, i) => ({
      l: i + 1,
      ltSec: 128 + (i % 5), // 128–132
    }));
    const outliers = [
      { l: 16, ltSec: 200 },
      { l: 17, ltSec: 210 },
      { l: 18, ltSec: 190 },
    ];
    const laps = makeLaps([...normal, ...outliers]);
    const baseline = calcCarBaseline(laps, new Set());
    // Outliers are ~50% above median (~130), well beyond 15% → excluded
    expect(baseline).toBeGreaterThan(127);
    expect(baseline).toBeLessThan(133);
  });

  it("excludes FCY laps from baseline", () => {
    const laps = makeLaps([
      ...Array.from({ length: 10 }, (_, i) => ({ l: i + 1, ltSec: 130 })),
      // FCY laps with inflated times
      { l: 11, ltSec: 160 },
      { l: 12, ltSec: 155 },
      { l: 13, ltSec: 158 },
    ]);
    const fcyLaps = new Set([11, 12, 13]);
    const baseline = calcCarBaseline(laps, fcyLaps);
    // FCY laps excluded → baseline should be ~130
    expect(baseline).toBeCloseTo(130, 1);
  });

  it("returns median when <5 qualifying laps after trim", () => {
    // Only 4 laps
    const laps = makeLaps([
      { l: 1, ltSec: 120 },
      { l: 2, ltSec: 122 },
      { l: 3, ltSec: 121 },
      { l: 4, ltSec: 123 },
    ]);
    const baseline = calcCarBaseline(laps, new Set());
    // Only 4 laps → returns median instead of mean
    const sorted = [120, 121, 122, 123];
    const expectedMedian = (sorted[1] + sorted[2]) / 2; // 121.5
    expect(baseline).toBeCloseTo(expectedMedian, 1);
  });

  it("returns 0 when no qualifying laps", () => {
    // All laps are pit laps or too short
    const laps = makeLaps([
      { l: 1, ltSec: 30, pit: 1 },
      { l: 2, ltSec: 50 }, // <60s
      { l: 3, ltSec: 1000 }, // >900s
    ]);
    const baseline = calcCarBaseline(laps, new Set());
    expect(baseline).toBe(0);
  });

  it("excludes pit-flagged laps", () => {
    const laps = makeLaps([
      ...Array.from({ length: 10 }, (_, i) => ({ l: i + 1, ltSec: 140 })),
      { l: 11, ltSec: 300, pit: 1 }, // pit lap — should be excluded
    ]);
    const baseline = calcCarBaseline(laps, new Set());
    expect(baseline).toBeCloseTo(140, 1);
  });
});

// ─── calcPitStopNetTime ──────────────────────────────────────────────────────

describe("calcPitStopNetTime", () => {
  it("handles simple 2-lap cluster (pit + 1 slow out-lap)", () => {
    // baseline 120s, pit lap = 300s, out-lap = 150s (>120*1.10=132), then normal
    const laps = makeLaps([
      { l: 1, ltSec: 120 },
      { l: 2, ltSec: 120 },
      { l: 3, ltSec: 300, pit: 1 }, // pit-flagged
      { l: 4, ltSec: 150 },         // slow out-lap
      { l: 5, ltSec: 122 },         // back to pace
    ]);
    const result = calcPitStopNetTime(2, laps, 120);
    // cluster = laps 3+4 = 300+150 = 450
    // net = 450 - 120*2 = 210
    expect(result.clusterLength).toBe(2);
    expect(result.netTime).toBeCloseTo(210, 1);
  });

  it("handles 3-lap cluster (pit + 2 slow laps, then back to pace)", () => {
    // baseline 120s, threshold = 132s
    const laps = makeLaps([
      { l: 1, ltSec: 120 },
      { l: 2, ltSec: 280, pit: 1 }, // pit-flagged
      { l: 3, ltSec: 145 },         // slow
      { l: 4, ltSec: 135 },         // still slow (>132)
      { l: 5, ltSec: 121 },         // back to pace
    ]);
    const result = calcPitStopNetTime(1, laps, 120);
    // cluster = laps 2+3+4 = 280+145+135 = 560
    // net = 560 - 120*3 = 200
    expect(result.clusterLength).toBe(3);
    expect(result.netTime).toBeCloseTo(200, 1);
  });

  it("stops at next pit-flagged lap (back-to-back pits)", () => {
    const laps = makeLaps([
      { l: 1, ltSec: 120 },
      { l: 2, ltSec: 300, pit: 1 }, // first pit
      { l: 3, ltSec: 290, pit: 1 }, // second pit — cluster stops
      { l: 4, ltSec: 120 },
    ]);
    const result = calcPitStopNetTime(1, laps, 120);
    // Only the first pit lap in cluster
    expect(result.clusterLength).toBe(1);
    expect(result.netTime).toBeCloseTo(180, 1); // 300 - 120
  });

  it("stops at >900s lap", () => {
    const laps = makeLaps([
      { l: 1, ltSec: 120 },
      { l: 2, ltSec: 300, pit: 1 },
      { l: 3, ltSec: 950 },         // >900 cap → cluster stops
      { l: 4, ltSec: 120 },
    ]);
    const result = calcPitStopNetTime(1, laps, 120);
    // Only pit lap in cluster (capped at 900 by cap logic in function — but pit lap is 300 < 900)
    expect(result.clusterLength).toBe(1);
    expect(result.netTime).toBeCloseTo(180, 1);
  });

  it("caps pit-flagged lap at 900s", () => {
    const laps = makeLaps([
      { l: 1, ltSec: 120 },
      { l: 2, ltSec: 1200, pit: 1 }, // very long pit — capped at 900
      { l: 3, ltSec: 120 },
    ]);
    const result = calcPitStopNetTime(1, laps, 120);
    // pit lap capped to 900, cluster = 1 lap
    expect(result.clusterLength).toBe(1);
    expect(result.netTime).toBeCloseTo(780, 1); // 900 - 120
  });

  it("floors net time at 0", () => {
    // Scenario where pit lap is close to baseline
    const laps = makeLaps([
      { l: 1, ltSec: 120 },
      { l: 2, ltSec: 110, pit: 1 }, // pit lap shorter than baseline
      { l: 3, ltSec: 120 },
    ]);
    const result = calcPitStopNetTime(1, laps, 120);
    expect(result.netTime).toBe(0);
    expect(result.clusterLength).toBe(1);
  });

  it("returns zero when baseline is 0", () => {
    const laps = makeLaps([
      { l: 1, ltSec: 300, pit: 1 },
    ]);
    const result = calcPitStopNetTime(0, laps, 0);
    expect(result.netTime).toBe(0);
    expect(result.clusterLength).toBe(0);
  });

  it("skips FCY laps in cluster walk", () => {
    // baseline 120s, threshold = 132s
    // Pit on lap 3, then FCY laps 4-6 (slow for everyone), then normal lap 7
    const laps = makeLaps([
      { l: 1, ltSec: 120 },
      { l: 2, ltSec: 120 },
      { l: 3, ltSec: 300, pit: 1 }, // pit-flagged
      { l: 4, ltSec: 200 },         // FCY — should be skipped
      { l: 5, ltSec: 210 },         // FCY — should be skipped
      { l: 6, ltSec: 195 },         // FCY — should be skipped
      { l: 7, ltSec: 118 },         // back to pace (green)
    ]);
    const fcyLaps = new Set([4, 5, 6]);
    const result = calcPitStopNetTime(2, laps, 120, fcyLaps);
    // Only pit lap in cluster (FCY laps skipped, lap 7 is at pace)
    expect(result.clusterLength).toBe(1);
    expect(result.netTime).toBeCloseTo(180, 1); // 300 - 120
  });

  it("skips FCY laps but captures slow green laps after FCY", () => {
    // Pit on lap 3, FCY on laps 4-5, then slow out-lap 6, then normal lap 7
    const laps = makeLaps([
      { l: 1, ltSec: 120 },
      { l: 2, ltSec: 120 },
      { l: 3, ltSec: 300, pit: 1 }, // pit-flagged
      { l: 4, ltSec: 200 },         // FCY
      { l: 5, ltSec: 190 },         // FCY
      { l: 6, ltSec: 150 },         // slow green out-lap (>132)
      { l: 7, ltSec: 118 },         // back to pace
    ]);
    const fcyLaps = new Set([4, 5]);
    const result = calcPitStopNetTime(2, laps, 120, fcyLaps);
    // cluster = pit (300) + slow green lap 6 (150) = 450
    // net = 450 - 120*2 = 210
    expect(result.clusterLength).toBe(2);
    expect(result.netTime).toBeCloseTo(210, 1);
  });

  it("COTA car #70 scenario: baseline ~144.5s, cluster of 3 laps → ~204s net", () => {
    // Simulated COTA scenario: baseline 144.5s, threshold = 144.5*1.10 = 158.95
    // Pit lap ~270s, out-lap ~175s, rejoin lap ~160s, then 143s back to pace
    const baseline = 144.5;
    const laps = makeLaps([
      ...Array.from({ length: 5 }, (_, i) => ({ l: i + 1, ltSec: 143 + (i % 3) })),
      { l: 6, ltSec: 270, pit: 1 }, // pit-flagged lap
      { l: 7, ltSec: 175 },         // slow out-lap
      { l: 8, ltSec: 160 },         // still slow (>158.95)
      { l: 9, ltSec: 143 },         // back to pace (<158.95)
      { l: 10, ltSec: 144 },
    ]);
    const result = calcPitStopNetTime(5, laps, baseline);
    // cluster = laps 6+7+8 = 270+175+160 = 605
    // net = 605 - 144.5*3 = 605 - 433.5 = 171.5
    expect(result.clusterLength).toBe(3);
    expect(result.netTime).toBeCloseTo(171.5, 0);

    // A more inflated scenario matching ~204s:
    const laps2 = makeLaps([
      ...Array.from({ length: 5 }, (_, i) => ({ l: i + 1, ltSec: 143 + (i % 3) })),
      { l: 6, ltSec: 310, pit: 1 }, // longer pit
      { l: 7, ltSec: 185 },         // slow out-lap
      { l: 8, ltSec: 165 },         // still slow
      { l: 9, ltSec: 143 },         // back to pace
    ]);
    const result2 = calcPitStopNetTime(5, laps2, baseline);
    // cluster = 310+185+165 = 660, net = 660 - 433.5 = 226.5
    expect(result2.clusterLength).toBe(3);
    expect(result2.netTime).toBeGreaterThan(200);
  });
});

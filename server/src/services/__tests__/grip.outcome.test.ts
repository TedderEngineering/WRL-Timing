import { describe, expect, it } from "vitest";
import {
  actualOf,
  compare,
  progressSummary,
  ON_TARGET_PSI,
  type CalcRow,
} from "../grip/outcome.js";

describe("compare", () => {
  it("is on target when every corner is within half a PSI", () => {
    expect(ON_TARGET_PSI).toBe(0.5);
    const c = compare(
      { lf: 30, rf: 30, lr: 30, rr: 30 },
      { lf: 30.5, rf: 29.5, lr: 30.2, rr: 30 }
    );
    expect(c.onTarget).toBe(true);
    expect(c.delta).toEqual({ lf: 0.5, rf: -0.5, lr: 0.2, rr: 0 });
    expect(c.worstMiss).toBe(0.5);
    expect(c.averageMiss).toBe(0.3);
  });

  it("is off target when any corner misses by more", () => {
    const c = compare(
      { lf: 30, rf: 30, lr: 30, rr: 30 },
      { lf: 30, rf: 30.6, lr: 30, rr: 30 }
    );
    expect(c.onTarget).toBe(false);
    expect(c.worstMiss).toBe(0.6);
    expect(c.delta.rf).toBe(0.6);
  });

  it("has no float noise in the differences", () => {
    expect(
      compare(
        { lf: 27.3, rf: 27.3, lr: 27.3, rr: 27.3 },
        { lf: 27.6, rf: 27, lr: 27.3, rr: 27.4 }
      ).delta
    ).toEqual({
      lf: 0.3,
      rf: -0.3,
      lr: 0,
      rr: 0.1,
    });
  });
});

describe("actualOf", () => {
  const base = {
    actualHotLf: 30,
    actualHotRf: 30,
    actualHotLr: 30,
    actualHotRr: 30,
    outcomeAt: new Date(),
  };
  it("returns the measured pressures once recorded", () => {
    expect(actualOf(base)).toEqual({ lf: 30, rf: 30, lr: 30, rr: 30 });
  });
  it("is null until all four are recorded", () => {
    expect(actualOf({ ...base, outcomeAt: null })).toBeNull();
    expect(actualOf({ ...base, actualHotRr: null })).toBeNull();
  });
});

describe("progressSummary", () => {
  const vir = { id: "t1", name: "VIRginia International Raceway", shortName: "VIR" };
  const ra = { id: "t2", name: "Road America", shortName: "RA" };
  let n = 0;
  /** A run `day` days into the season whose every corner missed by `miss` PSI. */
  const run = (day: number, miss: number | null, track = vir): CalcRow => {
    n += 1;
    const hot = miss === null ? null : 30 + miss;
    return {
      id: `c${n}`,
      name: `Run ${n}`,
      sessionDate: new Date(Date.UTC(2026, 3, 1 + day)),
      track,
      targetLf: 30,
      targetRf: 30,
      targetLr: 30,
      targetRr: 30,
      actualHotLf: hot,
      actualHotRf: hot,
      actualHotLr: hot,
      actualHotRr: hot,
      outcomeAt: hot === null ? null : new Date(),
    };
  };

  it("is empty with nothing recorded", () => {
    const p = progressSummary([run(1, null)]);
    expect(p.recordedTotal).toBe(0);
    expect(p.recent.count).toBe(0);
    expect(p.recent.averageWorstMiss).toBeNull();
    expect(p.trend).toBeNull();
    expect(p.tracks).toEqual([]);
  });

  it("counts the last ten, oldest first in the strip", () => {
    const rows = Array.from({ length: 12 }, (_, i) => run(i, i % 3 === 0 ? 1 : 0.2));
    const p = progressSummary(rows);
    expect(p.recordedTotal).toBe(12);
    expect(p.recent.count).toBe(10);
    // Days 2..11: misses of 1 on days 3, 6, 9.
    expect(p.recent.onTarget).toBe(7);
    expect(p.recent.runs[0].sessionDate.getUTCDate()).toBe(3);
    expect(p.recent.runs.at(-1)!.sessionDate.getUTCDate()).toBe(12);
  });

  it("has no trend before six recorded runs", () => {
    const p = progressSummary(Array.from({ length: 5 }, (_, i) => run(i, 0.3)));
    expect(p.trend).toBeNull();
  });

  it("compares the latest five with the five before", () => {
    const older = Array.from({ length: 5 }, (_, i) => run(i, 1.0));
    const newer = Array.from({ length: 5 }, (_, i) => run(10 + i, 0.4));
    const p = progressSummary([...newer, ...older]);
    expect(p.trend).toMatchObject({
      latestAverage: 0.4,
      previousAverage: 1,
      latestRuns: 5,
      previousRuns: 5,
      direction: "smaller",
    });
    const worse = progressSummary([
      ...Array.from({ length: 5 }, (_, i) => run(i, 0.3)),
      ...Array.from({ length: 3 }, (_, i) => run(10 + i, 0.9)),
    ]);
    expect(worse.trend).toMatchObject({
      direction: "larger",
      latestRuns: 5,
      previousRuns: 3,
    });
    const same = progressSummary(Array.from({ length: 10 }, (_, i) => run(i, 0.5)));
    expect(same.trend?.direction).toBe("similar");
  });

  it("groups by track, most recorded first", () => {
    const p = progressSummary([
      run(1, 0.2),
      run(2, 0.8, ra),
      run(3, 0.4),
      run(4, 0.6, ra),
      run(5, 0.1, ra),
    ]);
    expect(p.tracks.map((t) => t.track.shortName)).toEqual(["RA", "VIR"]);
    expect(p.tracks[0]).toMatchObject({
      recorded: 3,
      onTarget: 1,
      averageWorstMiss: 0.5,
    });
    expect(p.tracks[0].lastDate.getUTCDate()).toBe(6);
    expect(p.tracks[1]).toMatchObject({
      recorded: 2,
      onTarget: 2,
      averageWorstMiss: 0.3,
    });
  });
});

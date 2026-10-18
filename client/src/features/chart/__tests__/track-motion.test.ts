import { describe, expect, it } from "vitest";
import {
  FAR_M,
  FROZEN_MS,
  IN_PIT,
  MAX_COAST_MS,
  MAX_K,
  MIN_K,
  coastLimit,
  isFrozen,
  isParked,
  MIN_K_CAUTION,
  STALE,
  paceFromFixes,
  pointAt,
  signedGap,
  step,
  takeReading,
  targetOf,
  type CarLaps,
  type CarMotion,
  type CarPlace,
} from "../track-motion";

const LEN = 5734.36;
const PACE = 40;
const laps = (n = 10): ((num: string) => CarLaps) => () => ({ pace: PACE, laps: n });
const read = (m: Map<string, CarMotion>, cars: CarPlace[], now: number, lapsOf = laps()) => takeReading(m, cars, now, 0, LEN, 38, lapsOf);
/** Run frames of 16 ms from `from` to `to`, returning each frame's move (m). */
const frames = (m: Map<string, CarMotion>, from: number, to: number, num = "1") => {
  const moves: number[] = [];
  for (let t = from + 16; t <= to; t += 16) {
    const before = m.get(num)!.shown;
    step(m, t, 16, LEN);
    moves.push(signedGap(before, m.get(num)!.shown, LEN));
  }
  return moves;
};

describe("a car's pace", () => {
  it("is its lap pace until its fixes span 15 s", () => {
    const m = read(new Map(), [["1", 1000, 100, 0]], 0);
    expect(m.get("1")!.v).toBe(PACE);
    expect(read(m, [["1", 1300, 100, 0]], 5000).get("1")!.v).toBe(PACE); // 60 m/s over 5 s: not trusted
  });
  const fixes25 = [{ d: 0, at: 0 }, { d: 250, at: 10_000 }, { d: 500, at: 20_000 }]; // 25 m/s
  it("then the average over its recent fixes: under a caution, as slow as they say", () => {
    expect(paceFromFixes(fixes25, LEN, PACE, true)).toBeCloseTo(25, 6);
  });
  it("under green, within 85-115% of its lap pace (late fixes must not make a car crawl)", () => {
    expect(paceFromFixes(fixes25, LEN, PACE)).toBeCloseTo(34, 6);
    expect(paceFromFixes([{ d: 0, at: 0 }, { d: 1500, at: 20_000 }], LEN, PACE)).toBeCloseTo(46, 6); // 75 m/s capped at 115%
  });
  it("trusts fixes saying it is crawling or stopped", () => {
    expect(paceFromFixes([{ d: 0, at: 0 }, { d: 20, at: 20_000 }], LEN, PACE)).toBeCloseTo(1, 6);
  });
  it("counts across the line: 5,700 m to 60 m is 94 m covered", () => {
    expect(paceFromFixes([{ d: 5700, at: 0 }, { d: 60, at: 20_000 }], LEN, 4, true)).toBeCloseTo((LEN - 5700 + 60) / 20, 3);
  });
  it("is the typical pace for a car without laps, and slow in the pit lane", () => {
    expect(takeReading(new Map(), [["1", 10, null, 0]], 0, 0, LEN, 38).get("1")!.v).toBe(38);
    expect(read(new Map(), [["1", 0, 120, IN_PIT]], 0).get("1")!.v).toBeLessThan(14);
  });
});

describe("motion between fixes", () => {
  it("counts the reading's age, so a car read 2 s ago is already 2 s further on", () => {
    const m = takeReading(new Map(), [["1", 100, null, 0]], 10_000, 2_000, LEN, 38, laps());
    expect(targetOf(m.get("1")!, 10_000, LEN)).toBeCloseTo(180, 6);
  });
  it("places a new car straight at its place", () => {
    const m = read(new Map(), [["1", 1000, null, 0]], 0);
    step(m, 16, 16, LEN);
    expect(m.get("1")!.shown).toBeCloseTo(1000 + PACE * 0.016, 6);
  });
  it("keeps running through a repeated fix, at its own pace", () => {
    let m = read(new Map(), [["1", 1000, null, 0]], 0);
    step(m, 0, 0, LEN);
    for (let t = 5000; t <= 20_000; t += 5000) m = read(m, [["1", 1000, null, 0]], t); // the same fix for 20 s
    const moves = frames(m, 0, 20_000);
    expect(Math.min(...moves)).toBeGreaterThan(PACE * 0.016 * 0.99);
    expect(Math.abs(m.get("1")!.shown - (1000 + PACE * 20))).toBeLessThan(2);
  });
  it("closes a gap to a new fix by easing its pace, never stopping or going backwards", () => {
    let m = read(new Map(), [["1", 1000, null, 0]], 0);
    frames(m, 0, 5000);
    m = read(m, [["1", 1000 + PACE * 5 - 150, null, 0]], 5000); // the fix says it is 150 m behind
    const moves = frames(m, 5000, 35_000);
    expect(Math.min(...moves)).toBeGreaterThanOrEqual(PACE * 0.016 * MIN_K * 0.99);
    expect(Math.abs(signedGap(m.get("1")!.shown, targetOf(m.get("1")!, 35_000, LEN), LEN))).toBeLessThan(15);
  });
  it("under a caution may slow further to close a gap", () => {
    let m = takeReading(new Map(), [["1", 1000, null, 0]], 0, 0, LEN, 38, laps(), true);
    frames(m, 0, 5000);
    m = takeReading(m, [["1", 1000 + PACE * 5 - 300, null, 0]], 5000, 0, LEN, 38, laps(), true);
    const moves = frames(m, 5000, 6000);
    expect(Math.min(...moves)).toBeLessThan(PACE * 0.016 * MIN_K * 0.99);
    expect(Math.min(...moves)).toBeGreaterThanOrEqual(PACE * 0.016 * MIN_K_CAUTION * 0.99);
  });
  it("catches up to a fix ahead no faster than its pace allows", () => {
    let m = read(new Map(), [["1", 1000, null, 0]], 0);
    frames(m, 0, 5000);
    m = read(m, [["1", 1000 + PACE * 5 + 150, null, 0]], 5000);
    expect(Math.max(...frames(m, 5000, 6000))).toBeLessThanOrEqual(PACE * 0.016 * MAX_K * 1.01);
  });
  it("waits for a second fix to agree before moving a car placed far off", () => {
    let m = read(new Map(), [["1", 1000, null, 0]], 0);
    frames(m, 0, 5000);
    const far = (1000 + PACE * 5 + FAR_M + 500) % LEN;
    m = read(m, [["1", far, null, 0]], 5000);
    expect(m.get("1")!.far).toBe(1);
    expect(Math.max(...frames(m, 5000, 10_000))).toBeLessThan(5); // ignored: no jump
    m = read(m, [["1", (far + PACE * 5) % LEN, null, 0]], 10_000);
    step(m, 10_016, 16, LEN);
    expect(Math.abs(signedGap(m.get("1")!.shown, (far + PACE * 5) % LEN, LEN))).toBeLessThan(5);
  });
});

describe("a frozen fix", () => {
  it("is frozen after 25 s without a new one, and drawn as a faint signal", () => {
    const m = read(new Map(), [["1", 1000, null, 0]], 0).get("1")!;
    expect(isFrozen(m, FROZEN_MS - 1)).toBe(false);
    expect(isFrozen(m, FROZEN_MS)).toBe(true);
  });
  it("runs on while the car keeps completing laps", () => {
    let m = read(new Map(), [["1", 1000, null, 0]], 0, laps(10));
    const lapMs = (LEN / PACE) * 1000;
    m = read(m, [["1", 1000, null, 0]], lapMs, laps(11)); // a new lap, the same fix
    expect(coastLimit(m.get("1")!, LEN)).toBeCloseTo(lapMs * 2.5, -1);
    expect(targetOf(m.get("1")!, lapMs * 2, LEN)).toBeCloseTo((1000 + PACE * (lapMs * 2) / 1000) % LEN, 3);
  });
  it("stops after MAX_COAST_MS once it has gone 1.5 laps without a new one", () => {
    const m = read(new Map(), [["1", 1000, null, 0]], 0, laps(10)).get("1")!;
    // Its last fix 300 s after its last new lap (2.1 of its laps).
    expect(coastLimit({ ...m, at: 300_000 }, LEN)).toBe(MAX_COAST_MS);
  });
});

describe("a parked car", () => {
  const still = (flags: number, mph: number | null, at: number, lapsNow = 10, mphNow = mph) => {
    let m = read(new Map(), [["1", 1000, mph, 0]], 0, laps(10));
    m = read(m, [["1", 1000, mphNow, flags]], at, laps(lapsNow));
    return m.get("1")!;
  };
  it("is one at 0 mph with its fix frozen for 25 s", () => {
    expect(isParked(still(0, 0, 30_000), 30_000, LEN)).toBe(true);
    expect(isParked(still(0, 0, 20_000), 20_000, LEN)).toBe(false);
  });
  it("is one marked stale with fix and speed unchanged for 60 s (#77 on Sunday)", () => {
    expect(isParked(still(STALE, 54, 30_000), 30_000, LEN)).toBe(false);
    expect(isParked(still(STALE, 54, 60_000), 60_000, LEN)).toBe(true);
  });
  it("is not one marked stale whose speed still changes (#119 on Sunday)", () => {
    expect(isParked(still(STALE, 94, 60_000, 10, 122), 60_000, LEN)).toBe(false);
  });
  it("is not one whose fix is only frozen (it runs on), or that has completed a lap since", () => {
    expect(isParked(still(0, 54, 30_000), 30_000, LEN)).toBe(false);
    expect(isParked(still(0, 0, 30_000, 11), 30_000, LEN)).toBe(false);
  });
});

describe("gaps and the outline", () => {
  it("measures gaps the short way round the lap", () => {
    expect(signedGap(5700, 30, LEN)).toBeCloseTo(64.36, 2);
    expect(signedGap(30, 5700, LEN)).toBeCloseTo(-64.36, 2);
  });
  const pts: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const ds = [0, 100, 200, 300];
  it("interpolates along the outline and closes the lap", () => {
    expect(pointAt(pts, ds, 400, 50)).toEqual([50, 0]);
    expect(pointAt(pts, ds, 400, 250)).toEqual([50, 100]);
    expect(pointAt(pts, ds, 400, 350)).toEqual([0, 50]);
    expect(pointAt(pts, ds, 400, 450)).toEqual([50, 0]);
  });
  it("handles an outline whose first point is past the line", () => {
    const ds2 = [20, 120, 220, 320];
    expect(pointAt(pts, ds2, 400, 10)).toEqual([0, 10]);
  });
});

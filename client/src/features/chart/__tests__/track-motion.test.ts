import { describe, expect, it } from "vitest";
import {
  FAR_M,
  FROZEN_MS,
  IN_PIT,
  MAX_COAST_MS,
  MAX_K,
  MIN_K,
  MIN_K_CAUTION,
  OFF_EASE_MS,
  OFF_TRACK,
  OVERDUE_FACTOR,
  OVERDUE_SLACK_MS,
  STALE,
  isStopped,
  isPitting,
  visibility,
  FADE_IN_MS,
  PIT_FADE_M,
  type PitLane,
  coastLimit,
  isFrozen,
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
    expect(paceFromFixes([{ d: 0, at: 0 }, { d: 1500, at: 20_000 }], LEN, PACE, true)).toBeCloseTo(52, 6); // capped at 130%
  });
  it("under green, within 85-115% of its lap pace (fixes arriving late together must not make cars crawl)", () => {
    expect(paceFromFixes(fixes25, LEN, PACE)).toBeCloseTo(34, 6);
    expect(paceFromFixes([{ d: 0, at: 0 }, { d: 1500, at: 20_000 }], LEN, PACE)).toBeCloseTo(46, 6);
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
    expect(coastLimit(m.get("1")!, LEN)).toBeCloseTo(lapMs + lapMs * OVERDUE_FACTOR + OVERDUE_SLACK_MS, -1);
    expect(targetOf(m.get("1")!, lapMs * 2, LEN)).toBeCloseTo((1000 + PACE * (lapMs * 2) / 1000) % LEN, 3);
  });
  it("stops after MAX_COAST_MS once its next lap is long overdue", () => {
    const m = read(new Map(), [["1", 1000, null, 0]], 0, laps(10)).get("1")!;
    // Its last fix 300 s after its last new lap (2.1 of its laps).
    expect(coastLimit({ ...m, at: 300_000 }, LEN)).toBe(MAX_COAST_MS);
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

describe("cars off the track", () => {
  it("is drawn at its own point and does not run on at a pace", () => {
    let m = read(new Map(), [["555", 1000, null, 0]], 0);
    m = read(m, [["555", 1100, null, OFF_TRACK, [400, 300]]], 5_000);
    const c = m.get("555")!;
    expect(c.off).toEqual([400, 300]);
    expect(c.offShown).toEqual([400, 300]);
    expect(c.v).toBe(0);
    const before = c.shown;
    step(m, 10_000, 5_000, LEN);
    expect(m.get("555")!.shown).toBe(before);
  });

  it("eases between off-track fixes (a tow across the infield)", () => {
    let m = read(new Map(), [["555", 1100, null, OFF_TRACK, [400, 300]]], 0);
    m = read(m, [["555", 1150, null, OFF_TRACK, [500, 300]]], 5_000);
    expect(m.get("555")!.offShown).toEqual([400, 300]);
    step(m, 5_000 + OFF_EASE_MS / 2, OFF_EASE_MS / 2, LEN);
    expect(m.get("555")!.offShown![0]).toBeCloseTo(450, 5);
    step(m, 5_000 + OFF_EASE_MS * 2, OFF_EASE_MS, LEN);
    expect(m.get("555")!.offShown).toEqual([500, 300]);
  });

  it("back on the track, it is placed where its fix says and runs on again", () => {
    let m = read(new Map(), [["555", 1100, null, OFF_TRACK, [400, 300]]], 0);
    m = read(m, [["555", 2000, null, 0]], 5_000);
    const c = m.get("555")!;
    expect(c.off ?? null).toBeNull();
    expect(c.shown).toBe(2000);
    expect(c.v).toBe(PACE);
  });
});

describe("a stopped car (frozen fix, next lap overdue)", () => {
  const lapMs = (LEN / PACE) * 1000;
  const due = lapMs * OVERDUE_FACTOR + OVERDUE_SLACK_MS;

  it("is stopped once its fix is frozen and its next lap overdue, and goes back to its last fix", () => {
    const m = read(new Map(), [["7", 2000, null, 0]], 0, laps(10));
    // Frames up to just before it is overdue: it runs on past its fix.
    let t = 0;
    for (; t < due - 1000; t += 100) step(m, t + 100, 100, LEN);
    expect(isStopped(m.get("7")!, due - 1000, LEN)).toBe(false);
    expect(signedGap(2000, m.get("7")!.shown, LEN)).toBeGreaterThan(250);
    // Overdue: stopped, and back at its last real fix.
    for (; t < due + 2000; t += 100) step(m, t + 100, 100, LEN);
    expect(isStopped(m.get("7")!, due + 2000, LEN)).toBe(true);
    expect(m.get("7")!.shown).toBeCloseTo(2000, 0);
  });

  it("a frozen car that keeps crossing the line on time is not stopped (#77 at Sebring)", () => {
    let m = read(new Map(), [["77", 1000, null, 0]], 0, laps(10));
    m = read(m, [["77", 1000, null, 0]], lapMs, laps(11)); // a new lap, the same frozen fix
    expect(isStopped(m.get("77")!, lapMs * 1.5, LEN)).toBe(false);
  });

  it("waits longer when its last lap was slow (a caution)", () => {
    const slow = () => ({ pace: PACE, laps: 10, lastLapS: (LEN / PACE) * 2 });
    const m = read(new Map(), [["9", 1000, null, 0]], 0, slow);
    expect(isStopped(m.get("9")!, due + 1000, LEN)).toBe(false);
    expect(isStopped(m.get("9")!, lapMs * 2 * OVERDUE_FACTOR + OVERDUE_SLACK_MS + 1000, LEN)).toBe(true);
  });

  it("moves again when a new fix comes", () => {
    let m = read(new Map(), [["7", 2000, null, 0]], 0, laps(10));
    m = read(m, [["7", 2050, null, 0]], due + 5000, laps(10));
    expect(isStopped(m.get("7")!, due + 5000, LEN)).toBe(false);
  });

  // Sooner than an overdue lap, with no lap since its fix froze.
  const still = (flags: number, mph: number | null, at: number, lapsNow = 10, mphNow = mph) => {
    let m = read(new Map(), [["1", 1000, mph, 0]], 0, laps(10));
    m = read(m, [["1", 1000, mphNow, flags]], at, laps(lapsNow));
    return m.get("1")!;
  };
  it("is stopped reading 0 mph with its fix frozen for 25 s (#282 by the paddock)", () => {
    expect(isStopped(still(0, 0, 30_000), 30_000, LEN)).toBe(true);
    expect(isStopped(still(0, 0, 20_000), 20_000, LEN)).toBe(false);
  });
  it("is stopped marked stale with fix and speed unchanged for 60 s (#77 retired)", () => {
    expect(isStopped(still(STALE, 54, 30_000), 30_000, LEN)).toBe(false);
    expect(isStopped(still(STALE, 54, 60_000), 60_000, LEN)).toBe(true);
  });
  it("is not stopped marked stale while its speed still changes (#119 at 94-122 mph)", () => {
    expect(isStopped(still(STALE, 94, 60_000, 10, 122), 60_000, LEN)).toBe(false);
  });
  it("is not stopped at 0 mph once it has completed a lap since its fix", () => {
    expect(isStopped(still(0, 0, 30_000, 11), 30_000, LEN)).toBe(false);
  });

  it("an off-track car is never 'stopped' (it is drawn where it is)", () => {
    const m = read(new Map(), [["5", 100, null, OFF_TRACK, [10, 10]]], 0, laps(10));
    expect(isStopped(m.get("5")!, due * 3, LEN)).toBe(false);
  });
});

describe("a car going into the pits (before its flag)", () => {
  // Sebring on Sunday: the pit flag comes on at 5,724 m, the limiter is 35 mph.
  const lane: PitLane = { in: 5724, out: 832, mph: 35, n: 2 };
  const readPit = (m: Map<string, CarMotion>, cars: CarPlace[], now: number) => takeReading(m, cars, now, 0, LEN, 38, laps(), false, lane);

  it("is pitting at limiter speed in the approach to the pit-in point, and not elsewhere or at race speed", () => {
    expect(isPitting(5597, 36, lane, LEN)).toBe(true); // #119, 4 s before its flag
    expect(isPitting(5565, 36, lane, LEN)).toBe(true); // #120, 13 s before its flag
    expect(isPitting(5430, 76, lane, LEN)).toBe(false); // at race speed
    expect(isPitting(2600, 36, lane, LEN)).toBe(false); // a slow corner far from the pit lane
    expect(isPitting(5597, 36, null, LEN)).toBe(false); // the pit lane not learned yet
  });

  it("runs no faster than its reading and never past the pit-in point, then fades out there", () => {
    let m = readPit(new Map(), [["119", 5430, 76, 0]], 0);
    m = readPit(m, [["119", 5597, 36, 0]], 5000);
    const car = m.get("119")!;
    expect(car.v).toBeCloseTo(36 * 0.44704, 3);
    expect(targetOf(car, 60_000, LEN)).toBe(5724);
    for (let t = 5000; t < 40_000; t += 100) step(m, t + 100, 100, LEN);
    expect(signedGap(m.get("119")!.shown, 5724, LEN)).toBeGreaterThanOrEqual(-1);
    expect(visibility(m.get("119")!, 40_000, LEN)).toBeLessThan(0.05);
  });

  it("is not 'stopped' while waiting at the pit-in point for its flag", () => {
    let m = readPit(new Map(), [["119", 5430, 76, 0]], 0);
    m = readPit(m, [["119", 5700, 35, 0]], 5000);
    expect(isStopped(m.get("119")!, 400_000, LEN)).toBe(false);
  });

  it("goes back to its pace when its next reading says it was not pitting after all", () => {
    let m = readPit(new Map(), [["5", 5430, 76, 0]], 0);
    m = readPit(m, [["5", 5560, 40, 0]], 5000);
    expect(m.get("5")!.pitIn).toBe(5724);
    m = readPit(m, [["5", 5690, 70, 0]], 10_000);
    expect(m.get("5")!.pitIn).toBeNull();
    expect(m.get("5")!.v).toBe(PACE);
  });

  it("a car new to the map fades in", () => {
    const m = read(new Map(), [["1", 1000, null, 0]], 10_000);
    expect(visibility(m.get("1")!, 10_000, LEN)).toBe(0);
    expect(visibility(m.get("1")!, 10_000 + FADE_IN_MS / 2, LEN)).toBeCloseTo(0.5, 3);
    expect(visibility(m.get("1")!, 10_000 + FADE_IN_MS, LEN)).toBe(1);
    expect(PIT_FADE_M).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  FAR_M,
  FROZEN_MS,
  IN_PIT,
  MAX_COAST_MS,
  MAX_K,
  MIN_K,
  OFF_EASE_MS,
  OFF_TRACK,
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
  it("then the average over its recent fixes, so a caution slows it", () => {
    expect(paceFromFixes([{ d: 0, at: 0 }, { d: 250, at: 10_000 }, { d: 500, at: 20_000 }], LEN, PACE)).toBeCloseTo(25, 6);
  });
  it("within bounds of its lap pace, unless it is crawling", () => {
    expect(paceFromFixes([{ d: 0, at: 0 }, { d: 1500, at: 20_000 }], LEN, PACE)).toBeCloseTo(52, 6); // 75 m/s capped at 130%
    expect(paceFromFixes([{ d: 0, at: 0 }, { d: 20, at: 20_000 }], LEN, PACE)).toBeCloseTo(1, 6); // a stoppage: trusted
  });
  it("counts across the line: 5,700 m to 60 m is 94 m covered", () => {
    expect(paceFromFixes([{ d: 5700, at: 0 }, { d: 60, at: 20_000 }], LEN, 4)).toBeCloseTo((LEN - 5700 + 60) / 20, 3);
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
    const moves = frames(m, 5000, 25_000);
    expect(Math.min(...moves)).toBeGreaterThanOrEqual(PACE * 0.016 * MIN_K * 0.99);
    expect(Math.abs(signedGap(m.get("1")!.shown, targetOf(m.get("1")!, 25_000, LEN), LEN))).toBeLessThan(15);
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

import { describe, expect, it } from "vitest";
import { actualOf, compare, ON_TARGET_PSI } from "../grip/outcome.js";

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

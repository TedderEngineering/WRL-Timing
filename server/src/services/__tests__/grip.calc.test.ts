import { describe, it, expect } from "vitest";
import {
  parseCalcModel,
  evaluateCorner,
  calculateColdPressures,
  CalcModelError,
  type CalcInputs,
  type CalcRequest,
} from "../grip/calc.js";

// These models are invented for the tests. The real model is proprietary and
// must never appear in this repository.
const TEST_MODEL = JSON.stringify({
  version: "test",
  base: "refCold",
  terms: [
    { weight: 0.5, plus: "targetHot", minus: "refHot" },
    { weight: 0.1, plus: "refTrackTemp", minus: "trackTemp" },
    { weight: 0.2, plus: "duration", minus: "refDuration" },
  ],
  durationCap: 60,
  wetBlend: 0.25,
  wetToward: "targetHot",
  decimals: 1,
});

const inputs: CalcInputs = {
  refCold: 20,
  refHot: 26,
  targetHot: 28,
  refTrackTemp: 100,
  trackTemp: 80,
  refAmbientTemp: 80,
  ambientTemp: 70,
  refWheelTemp: 85,
  wheelTemp: 75,
  refDuration: 30,
  duration: 40,
};

describe("parseCalcModel", () => {
  it("accepts a well-formed model", () => {
    const model = parseCalcModel(TEST_MODEL);
    expect(model.terms).toHaveLength(3);
    expect(model.decimals).toBe(1);
  });

  it("rejects a missing model", () => {
    expect(() => parseCalcModel(undefined)).toThrow(CalcModelError);
    expect(() => parseCalcModel("  ")).toThrow("not configured");
  });

  it("rejects malformed JSON without echoing it", () => {
    expect(() => parseCalcModel("{secret: 1")).toThrow("not valid JSON");
  });

  it("names the bad field but never its value", () => {
    const bad = JSON.stringify({
      base: "refCold",
      terms: [{ weight: 0.123456, plus: "nope", minus: "refHot" }],
    });
    try {
      parseCalcModel(bad);
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("terms.0.plus");
      expect(message).not.toContain("0.123456");
      expect(message).not.toContain("nope");
    }
  });

  it("requires wetToward when wetBlend is set", () => {
    const bad = JSON.stringify({
      base: "refCold",
      terms: [{ weight: 1, plus: "targetHot", minus: "refHot" }],
      wetBlend: 0.5,
    });
    expect(() => parseCalcModel(bad)).toThrow("wetToward");
  });
});

describe("evaluateCorner", () => {
  const model = parseCalcModel(TEST_MODEL);

  it("adds each weighted difference to the base", () => {
    // 20 + 0.5*(28-26) + 0.1*(100-80) + 0.2*(40-30) = 20 + 1 + 2 + 2
    expect(evaluateCorner(model, inputs, false)).toBe(25);
  });

  it("blends toward the wet target when wet", () => {
    // 25 + 0.25*(28-25)
    expect(evaluateCorner(model, inputs, true)).toBe(25.8);
  });

  it("caps both durations", () => {
    // duration 90 -> 60, refDuration 75 -> 60, so the duration term is zero
    expect(
      evaluateCorner(model, { ...inputs, duration: 90, refDuration: 75 }, false)
    ).toBe(23);
    // only the new session is over the cap: 0.2*(60-30) = 6
    expect(evaluateCorner(model, { ...inputs, duration: 600 }, false)).toBe(29);
  });

  it("rounds to the configured number of decimals", () => {
    const fine = parseCalcModel(
      JSON.stringify({
        base: "refCold",
        terms: [{ weight: 0.333, plus: "targetHot", minus: "refHot" }],
        decimals: 2,
      })
    );
    expect(evaluateCorner(fine, inputs, false)).toBe(20.67);
  });

  it("ignores the wet flag when the model has no wet blend", () => {
    const dryOnly = parseCalcModel(
      JSON.stringify({
        base: "refCold",
        terms: [{ weight: 1, plus: "targetHot", minus: "refHot" }],
      })
    );
    expect(evaluateCorner(dryOnly, inputs, true)).toBe(
      evaluateCorner(dryOnly, inputs, false)
    );
  });
});

describe("calculateColdPressures", () => {
  const model = parseCalcModel(TEST_MODEL);
  const request: CalcRequest = {
    wet: false,
    trackTemp: 80,
    ambientTemp: 70,
    duration: 40,
    wheel: { Lf: 75, Rf: 75, Lr: 75, Rr: 75 },
    target: { Lf: 28, Rf: 28, Lr: 27, Rr: 27 },
    reference: {
      trackTemp: 100,
      ambientTemp: 80,
      duration: 30,
      cold: { Lf: 20, Rf: 20.5, Lr: 19, Rr: 19 },
      hot: { Lf: 26, Rf: 27, Lr: 25, Rr: 24 },
      wheel: { Lf: 85, Rf: 85, Lr: 85, Rr: 85 },
    },
  };

  it("evaluates each corner from that corner's own reference values", () => {
    expect(calculateColdPressures(model, request)).toEqual({
      Lf: 25, // 20   + 0.5*(28-26) + 4
      Rf: 25, // 20.5 + 0.5*(28-27) + 4
      Lr: 24, // 19   + 0.5*(27-25) + 4
      Rr: 24.5, // 19 + 0.5*(27-24) + 4
    });
  });

  it("applies wet to every corner", () => {
    const wet = calculateColdPressures(model, { ...request, wet: true });
    expect(wet.Lf).toBe(25.8);
    expect(wet.Rr).toBe(25.1); // 24.5 + 0.25*(27-24.5) = 25.125
  });
});

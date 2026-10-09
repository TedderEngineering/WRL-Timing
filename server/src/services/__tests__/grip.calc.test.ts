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
    { weight: 0.15, plus: "refAmbientTemp", minus: "ambientTemp" },
    { weight: 0.2, plus: "refDuration", minus: "duration" },
  ],
  durationCap: 45,
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

  it("accepts the same model base64-encoded", () => {
    const encoded = Buffer.from(TEST_MODEL, "utf8").toString("base64");
    expect(parseCalcModel(encoded)).toEqual(parseCalcModel(TEST_MODEL));
    expect(parseCalcModel(`  ${encoded}\n`)).toEqual(parseCalcModel(TEST_MODEL));
    expect(() => parseCalcModel("not json at all")).toThrow("not valid JSON");
    expect(() => parseCalcModel("bm90IGpzb24=")).toThrow("not valid JSON");
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
      wetBlend: 0.3,
    });
    expect(() => parseCalcModel(bad)).toThrow("wetToward");
  });
});

describe("evaluateCorner", () => {
  const model = parseCalcModel(TEST_MODEL);

  it("adds each weighted difference to the base", () => {
    // 20 + 0.5*(28-26) + 0.15*(80-70) + 0.2*(30-40) = 20 + 1 + 1.5 - 2
    expect(evaluateCorner(model, inputs, false)).toBe(20.5);
  });

  it("blends toward the wet target when wet", () => {
    // 20.5 + 0.25*(28-20.5) = 22.375
    expect(evaluateCorner(model, inputs, true)).toBe(22.4);
  });

  it("caps both durations", () => {
    // duration 90 -> 45, refDuration 75 -> 45, so the duration term is zero
    expect(
      evaluateCorner(model, { ...inputs, duration: 90, refDuration: 75 }, false)
    ).toBe(22.5);
    // only the new session is over the cap: 0.2*(30-45) = -3
    expect(evaluateCorner(model, { ...inputs, duration: 600 }, false)).toBe(19.5);
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
      // shared part: 0.15*(80-70) + 0.2*(30-40) = -0.5
      Lf: 20.5, // 20   + 0.5*(28-26) - 0.5
      Rf: 20.5, // 20.5 + 0.5*(28-27) - 0.5
      Lr: 19.5, // 19   + 0.5*(27-25) - 0.5
      Rr: 20, // 19 + 0.5*(27-24) - 0.5
    });
  });

  it("applies wet to every corner", () => {
    const wet = calculateColdPressures(model, { ...request, wet: true });
    expect(wet.Lf).toBe(22.4); // 20.5 + 0.25*(28-20.5) = 22.375
    expect(wet.Rr).toBe(21.8); // 20 + 0.25*(27-20) = 21.75
  });
});

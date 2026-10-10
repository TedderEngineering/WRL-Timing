import { describe, expect, it } from "vitest";
import { baselineValues, modelSlug, parseSpec } from "../setup/spec.js";

const minimal = {
  format: 1,
  make: "Example",
  model: "Test Car",
  source: { title: "Owner's manual" },
  corner: [
    { id: "spring_rate", label: "Spring", unit: "lb/in", type: "choice", options: [{ value: "250", label: "250 lb/in" }] },
    { id: "rebound", label: "Rebound", type: "number", min: 0, front: { max: 9 }, rear: { max: 12 } },
  ],
  car: [{ key: "car.wing_position", label: "Wing", type: "choice", options: [{ value: "1", label: "1" }] }],
  baseline: { label: "Factory", values: { "lf.spring_rate": "250", "lf.rebound": " 4 ", "rf.rebound": "" } },
  torques: [{ part: "Lug nuts", value: "122 N·m" }],
};

describe("car library specs", () => {
  it("accepts a spec and keeps the extra reference sections", () => {
    const spec = parseSpec(minimal);
    expect(spec.corner).toHaveLength(2);
    expect((spec as Record<string, unknown>).torques).toEqual(minimal.torques);
    expect(spec.seriesRules).toEqual([]);
  });

  it("rejects a field listed twice", () => {
    expect(() => parseSpec({ ...minimal, corner: [...minimal.corner, minimal.corner[0]] })).toThrow(/listed twice/);
  });

  it("rejects a baseline key that is not a sheet key", () => {
    expect(() => parseSpec({ ...minimal, baseline: { label: "x", values: { "LF rebound": "4" } } })).toThrow();
  });

  it("rejects an oversized spec", () => {
    expect(() => parseSpec({ ...minimal, notes: "x".repeat(400_000) })).toThrow(/at most/);
  });

  it("gives the baseline values, trimmed and without blanks", () => {
    expect(baselineValues(minimal)).toEqual({ "lf.spring_rate": "250", "lf.rebound": "4" });
    expect(baselineValues({ ...minimal, baseline: undefined })).toBeNull();
    expect(baselineValues({ nonsense: true })).toBeNull();
  });

  it("only takes simple slugs", () => {
    expect(modelSlug.safeParse("toyota-gr86-cup").success).toBe(true);
    expect(modelSlug.safeParse("Toyota GR86").success).toBe(false);
    expect(modelSlug.safeParse("../x").success).toBe(false);
  });
});

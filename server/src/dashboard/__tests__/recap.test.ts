import { describe, expect, it } from "vitest";
import { extractRecap } from "../recap.js";
import { sampleAnalysis, sampleFacts } from "../../analysis/__tests__/sample-package.js";

describe("extractRecap", () => {
  const pkg = sampleAnalysis(sampleFacts()) as any;
  const recap = extractRecap(pkg)!;

  it("keeps the headline exactly as the package wrote it", () => {
    expect(recap.headline).toEqual(pkg.raceSummary.headline);
  });

  it("lists one winner per class, in class order, with the class summary", () => {
    const order = [...pkg.metadata.classes].sort((a: any, b: any) => a.order - b.order).map((c: any) => c.id);
    expect(recap.classWinners.map((w) => w.class)).toEqual(order.filter((c: string) => recap.classWinners.some((w) => w.class === c)));
    for (const w of recap.classWinners) {
      const e = pkg.entries.find((x: any) => x.car === w.car);
      expect(e.result.positionClass).toBe(1);
      expect(e.class).toBe(w.class);
    }
  });

  it("keeps key moments in lap order and turns FCY periods into lap bands", () => {
    const laps = recap.moments.map((m) => m.lap);
    expect(laps).toEqual([...laps].sort((a, b) => a - b));
    expect(recap.bands.filter((b) => b.kind === "fcy")).toHaveLength(pkg.fcyPeriods.length);
    for (const b of recap.bands) expect(b.toLap).toBeGreaterThanOrEqual(b.fromLap);
  });

  it("returns null for a facts-only package (no summary yet)", () => {
    expect(extractRecap(sampleFacts() as any)).toBeNull();
  });
});

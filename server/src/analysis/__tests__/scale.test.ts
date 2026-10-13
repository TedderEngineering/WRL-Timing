/**
 * T14 scale: synthetic 75-car, 8-hour race (4 classes, 280 laps, a stop every 35 laps, two FCYs).
 * Targets (FACT_ENGINE_SPEC.md §8.2): package <= 4 MB raw / 0.7 MB gzip; build <= 30 s.
 */
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildFacts } from "../buildFacts.js";
import { validatePackage } from "../validate-package.js";
import { OPTS } from "./scenarios.js";
import { synthImsa, type SynthCar } from "./synth.js";

describe("scale (T14)", () => {
  it("75 cars, 8 hours: size and build time within target", () => {
    const classes = ["GP1", "GP2", "GTO", "GTU"];
    const cars: SynthCar[] = [];
    for (let i = 0; i < 75; i++) {
      const laps = 270 + (i % 10);
      const stops = [];
      for (let L = 30 + (i % 7); L < laps - 5; L += 35) stops.push({ lap: L, pitLane: 120 + (i % 5) });
      cars.push({ car: String(100 + i), cls: classes[i % 4], base: 100 + (i % 19) * 0.4, grid: i * 0.5, laps, stops, make: "Toyota" });
    }
    const files = synthImsa({ cars, fcy: [[5000, 5600], [17000, 17900]] });
    const t0 = performance.now();
    const pkg = buildFacts({ format: "alkamel-imsa", files, options: { ...OPTS, rulebook: { pitCycleModel: "windows", scheduledDurationS: 28800 } } });
    const ms = performance.now() - t0;
    const json = JSON.stringify(pkg);
    const gz = gzipSync(json).length;
    console.log(`T14: ${pkg.entries.length} cars, ${Object.values(pkg.laps.cars).reduce((a, c) => a + c.lap.length, 0)} lap rows, ${pkg.events.pitPassages.length} passages, ${pkg.positionChanges.rows.lap.length} swaps: ${(json.length / 1e6).toFixed(2)} MB raw, ${(gz / 1e6).toFixed(2)} MB gzip, ${(ms / 1000).toFixed(2)} s`);
    expect(validatePackage(pkg).errors).toEqual([]);
    expect(json.length).toBeLessThanOrEqual(4e6);
    expect(gz).toBeLessThanOrEqual(0.7e6);
    expect(ms).toBeLessThanOrEqual(30000);
  }, 120_000);
});

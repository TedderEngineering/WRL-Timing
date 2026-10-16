import { describe, expect, it, vi } from "vitest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));
import { extractRaceStories } from "../race-stories.js";
import { sampleAnalysis, sampleFacts } from "../../analysis/__tests__/sample-package.js";

describe("race stories (Story tab)", () => {
  const pkg = sampleAnalysis(sampleFacts()) as unknown as Record<string, any>;

  it("carries the race summary and every car's story, with finishing positions", () => {
    const out = extractRaceStories(pkg, 3, "2026-10-16T00:00:00.000Z")!;
    expect(out.version).toBe(3);
    expect(out.recap.headline.text).toBe(pkg.raceSummary.headline.text);
    expect(out.stories.map((s) => s.car).sort()).toEqual(pkg.carStories.map((s: any) => String(s.car)).sort());
    const first = out.stories.find((s) => s.car === pkg.carStories[0].car)!;
    const entry = pkg.entries.find((e: any) => e.car === first.car);
    expect(first).toMatchObject({ cls: entry.class, positionClass: entry.result?.positionClass ?? null });
  });

  it("never includes rule findings or facts", () => {
    const out = extractRaceStories(pkg, 1, null)!;
    const text = JSON.stringify(out);
    expect(text).not.toContain("ruleFindings");
    expect(text).not.toContain("pitPassages");
  });

  it("is null for a package without a race summary", () => {
    expect(extractRaceStories({ ...pkg, raceSummary: null }, 1, null)).toBeNull();
  });
});

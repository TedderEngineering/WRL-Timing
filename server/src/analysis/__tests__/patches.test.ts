import { describe, expect, it } from "vitest";
import { classDigest, fillRef, factIndex, mergePatches, raceDigest, type AnalysisPatch } from "../patches.js";
import { validatePackage } from "../validate-package.js";
import { sampleAnalysis, sampleFacts } from "./sample-package.js";

/** The hand-written sample analysis as patches with bare refs (no value, unit or display). */
function asPatches(base: ReturnType<typeof sampleFacts>): AnalysisPatch[] {
  const A = sampleAnalysis(base);
  const bare = (p: any) => ({ text: p.text, refs: p.refs.map((r: any) => ({ factId: r.factId, field: r.field, ...(r.transform ? { transform: r.transform } : {}) })) });
  const byClass = new Map<string, AnalysisPatch>();
  for (const s of A.carStories) {
    const cls = base.entries.find((e) => e.car === s.car)!.class;
    const p = byClass.get(cls) ?? { patchFormat: "analysis-patch/1", scope: { kind: "class", class: cls }, carStories: [], ruleFindings: [] };
    byClass.set(cls, p);
    p.carStories!.push({ id: s.id, car: s.car, headline: bare(s.headline), paragraphs: s.paragraphs.map(bare), keyFactIds: s.keyFactIds, events: (s.events ?? []).filter((e) => e.title).map((e) => ({ id: e.id, title: e.title })) });
  }
  const race: AnalysisPatch = {
    patchFormat: "analysis-patch/1",
    scope: { kind: "race" },
    ruleFindings: A.ruleFindings.map((f) => ({ ...f, statement: bare(f.statement) })) as any,
    raceSummary: {
      ...A.raceSummary!,
      headline: bare(A.raceSummary!.headline),
      paragraphs: A.raceSummary!.paragraphs.map(bare),
      classSummaries: A.raceSummary!.classSummaries!.map((c) => ({ class: c.class, text: bare(c.text) })),
      keyMoments: A.raceSummary!.keyMoments!.map((k) => ({ ...k, lap: { factId: k.lap.factId, field: k.lap.field } as any, text: bare(k.text) })),
    },
  };
  return [...byClass.values(), race];
}

describe("analysis patches", () => {
  it("fills each ref from its fact, so bare refs merge into a publishable package", () => {
    const base = sampleFacts();
    const { pkg, problems } = mergePatches(base, asPatches(base), { skill: "test" });
    expect(problems).toEqual([]);
    const rep = validatePackage(pkg, { stage: "analysis", publish: true, base });
    expect(rep.errors).toEqual([]);
    expect(pkg.carStories).toHaveLength(base.entries.length);
    expect(pkg.ruleFindings.map((f) => f.id)).toEqual(["finding:1"]);
    expect(pkg.completeness.carStories).toBe("complete");
  });

  it("fills seconds with their display and positions with P", () => {
    const base = sampleFacts();
    const find = factIndex(base);
    const stop = base.events.pitPassages.find((p) => p.officialPitLaneTimeS !== null)!;
    const s = fillRef({ factId: stop.id, field: "officialPitLaneTimeS" }, find);
    expect(s.unit).toBe("s");
    expect(s.display).toMatch(/^\d+:\d{2}\.\d{3}$/);
    const car = base.entries[0].car;
    expect(fillRef({ factId: `result:${car}`, field: "positionClass" }, find)).toMatchObject({ unit: "pos", display: `P${base.entries[0].result!.positionClass}` });
    expect(() => fillRef({ factId: "pit:nope:1", field: "inLap" }, find)).toThrow(/unknown fact/);
  });

  it("gives a nested field the unit of its last part", () => {
    const find = () => ({ positionEffect: { classPosBefore: 3 } });
    expect(fillRef({ factId: "pit:x:1", field: "positionEffect.classPosBefore" }, find)).toMatchObject({ value: 3, unit: "pos", display: "P3" });
  });

  it("reports a ref to a missing fact instead of writing it silently", () => {
    const base = sampleFacts();
    const car = base.entries[0].car;
    const { problems } = mergePatches(base, [
      { patchFormat: "analysis-patch/1", scope: { kind: "class", class: base.entries[0].class }, carStories: [{ id: `story:${car}`, car, headline: { text: `{car:${car}} on lap {0}.`, refs: [{ factId: `pit:${car}:99`, field: "inLap" } as any] }, paragraphs: [], keyFactIds: [] }] },
    ]);
    expect(problems.join(" ")).toContain(`unknown fact pit:${car}:99`);
  });

  it("writes a digest with every fact id to cite", () => {
    const base = sampleFacts();
    const cls = base.metadata.classes[0].id;
    const d = classDigest(base, cls);
    const car = base.entries.find((e) => e.class === cls)!.car;
    expect(d).toContain(`result:${car} status=`);
    expect(d).toContain(`pit:${car}:1 kind=`);
    expect(raceDigest(base)).toContain("overall winner: {car:");
  });
});

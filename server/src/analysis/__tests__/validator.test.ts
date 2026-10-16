/**
 * validate-package.ts: core negatives (T11), one mutation per analysis rule A1–A20, and the rule-check
 * contract (ruleChecks / ruleMarkers / ruleCoverage, A21)
 * (stage2/claude/tools/mutation_tests.py), on a synthetic race with a hand-written valid analysis.
 */
import { describe, expect, it } from "vitest";
import { buildStoryEvents } from "../engine/story-events.js";
import { ref, sampleAnalysis, sampleFacts } from "./sample-package.js";
import { formatDuration, validatePackage } from "../validate-package.js";
import type { CarStory, FactRef, KeyMoment, RaceAnalysisPackage, RuleCheck } from "../schema/package-types.js";
import { greenRace, OPTS } from "./scenarios.js";
import { synthImsa } from "./synth.js";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const facts = sampleFacts;
const analysis = sampleAnalysis;

const BASE = facts();
const GOOD = analysis(BASE);
const run = (p: unknown) => validatePackage(p, { stage: "analysis", base: BASE });
const story = (p: RaceAnalysisPackage, car: string) => p.carStories.find((s) => s.car === car)!;

describe("validator: good packages", () => {
  it("facts draft passes V1-V8", () => expect(validatePackage(BASE).errors).toEqual([]));
  it("hand-written analysis passes V1-V8 and A1-A20", () => {
    const r = run(GOOD);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe("validator: core negatives (T11)", () => {
  const cases: [string, (p: any) => void, RegExp][] = [
    ["wrong seconds value (rounded)", (p) => (story(p, "7").paragraphs[1].refs[0].value = 62.0001), /A4/],
    ["bare number typed into prose", (p) => (story(p, "7").paragraphs[0].text += " It lost 12 s."), /A7/],
    ["numeric car id", (p) => (p.events.pitPassages[0].car = 7), /V1/],
    ["published while a story section is open", (p) => {
      p.status = "published";
      p.completeness.carStories = "partial";
    }, /V1/],
    ["unknown passage kind", (p) => (p.events.pitPassages[0].kind = "pit"), /V1/],
    ["dangling cycle id", (p) => (p.events.pitPassages.find((x: any) => x.cycleId).cycleId = "cycle:GS:9"), /V3/],
    ["timestamp as race date", (p) => (p.metadata.raceDate = "2026-10-02T00:00:00Z"), /V1/],
    ["entry without make", (p) => delete p.entries[0].make, /V1/],
    ["schemaVersion 1.0.0", (p) => (p.schemaVersion = "1.0.0"), /V1/],
    ["finding without severity", (p) => delete p.ruleFindings[0].severity, /V1/],
    ["seconds display with a trailing unit", (p) => (story(p, "7").paragraphs[1].refs[0].display = "1:02.000 s"), /A6/],
    ["seconds display missing", (p) => delete story(p, "7").paragraphs[1].refs[0].display, /A6/],
  ];
  for (const [name, fn, rule] of cases) {
    it(name, () => {
      const p = clone(GOOD);
      fn(p);
      const r = run(p);
      expect(r.ok).toBe(false);
      expect(r.errors.join("\n")).toMatch(rule);
    });
  }
  it("publishes with rule checks partial or absent (no rulebook, or one not yet verified)", () => {
    for (const state of ["partial", "absent"] as const) {
      const p = clone(GOOD);
      p.status = "published";
      p.completeness.ruleChecks = state;
      // (A1 would flag the change against the facts base, which has them complete: only the schema gate matters here.)
      expect(run(p).errors.filter((e: string) => /^V1/.test(e))).toEqual([]);
    }
  });
  it("lapdown: ids resolve", () => {
    const p = clone(GOOD);
    const ld = p.positionChanges.lapDowns!;
    expect(ld.car.length).toBeGreaterThan(0);
    const fid = `lapdown:${ld.car[0]}:${ld.lap[0]}`;
    story(p, ld.car[0]).keyFactIds.push(fid);
    expect(run(p).errors).toEqual([]);
    story(p, ld.car[0]).keyFactIds.push(`lapdown:${ld.car[0]}:999`);
    expect(run(p).errors.join("\n")).toMatch(/A3 .*lapdown/);
  });
});

describe("validator: one mutation per analysis rule (A1–A20)", () => {
  const M: [string, string, (p: RaceAnalysisPackage) => void][] = [
    ["A1", "pit-lane time edited in the package", (p) => (p.events.pitPassages.find((x) => x.id === "pit:7:1")!.officialPitLaneTimeS = 61)],
    ["A2", "downgrade with no written judgement", (p) => {
      const x = p.events.pitPassages.find((y) => y.id === "pit:20:1")!;
      x.confidence = "medium";
      x.confidenceNotes = ["judgement_x"];
    }],
    ["A3", "ref to a fact id that does not exist", (p) => (story(p, "7").paragraphs[1].refs[1].factId = "pit:7:9")],
    ["A4", "lap number off by one", (p) => (story(p, "7").paragraphs[1].refs[1].value = 11)],
    ["A5", "pit-lane time cited with unit pos", (p) => (story(p, "7").paragraphs[1].refs[0].unit = "pos")],
    ["A6", "display 1:02.0 for 62.000", (p) => (story(p, "7").paragraphs[1].refs[0].display = "1:02.0")],
    ["A7", "bare digit typed into the text", (p) => (story(p, "7").paragraphs[0].text = story(p, "7").paragraphs[0].text.replace("completed", "completed P1 and"))],
    ["A8", "number word 'two'", (p) => (story(p, "7").paragraphs[0].text = story(p, "7").paragraphs[0].text.replace("completed", "completed two hours and"))],
    ["A9", "unit typed after a time placeholder", (p) => (story(p, "7").paragraphs[1].text = story(p, "7").paragraphs[1].text.replace("{0} in", "{0} s in"))],
    ["A10", "cause speculation", (p) => (story(p, "24").paragraphs[0].text = story(p, "24").paragraphs[0].text.replace("laps.", "laps with a gearbox problem."))],
    ["A11", "class position without the word class", (p) => (story(p, "7").headline.text = story(p, "7").headline.text.replace(" in {class:GS}", ""))],
    ["A12", "'provisional' removed", (p) => (story(p, "7").headline.text = story(p, "7").headline.text.replace(" on the provisional results", ""))],
    ["A13", "a story deleted", (p) => (p.carStories = p.carStories.filter((s) => s.car !== "20"))],
    ["A14", "penalty dropped from keyFactIds", (p) => (story(p, "11").keyFactIds = story(p, "11").keyFactIds.filter((f) => f !== "pen:11:1"))],
    ["A15", "driver token for a driver the car does not have", (p) => (story(p, "7").paragraphs[0].text += " {driver:7:3} drove.")],
    ["A16", "finding deleted (open rule check uncovered)", (p) => (p.ruleFindings = [])],
    ["A17", "headline over 35 words", (p) => (story(p, "7").headline.text += " It was a long race in the sun and the car ran well from the start to the end of the race without any trouble at all on the day.")],
    ["A18", "key moments out of race order", (p) => {
      const km = p.raceSummary!.keyMoments!;
      [km[0], km[3]] = [km[3], km[0]];
      km[0].id = "moment:1";
      km[3].id = "moment:4";
    }],
    ["A19", "class summary deleted", (p) => (p.raceSummary!.classSummaries = p.raceSummary!.classSummaries!.filter((c) => c.class !== "TCR"))],
    ["A20", "rule-check confidence raised low -> high", (p) => (p.ruleChecks[0].confidence = "high")],
  ];
  for (const [rule, desc, fn] of M) {
    it(`${rule}: ${desc}`, () => {
      const p = clone(GOOD);
      fn(p);
      const r = run(p);
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.startsWith(rule + " "))).toBe(true);
    });
  }
  it("A1: an event skeleton edited by the analysis is refused", () => {
    const p = clone(GOOD);
    story(p, "7").events![0].lap += 1;
    expect(run(p).errors.join("\n")).toMatch(/A1 .*events skeleton/);
  });
});

describe("validator: rule-check contract (schema 1.1.0) and A21", () => {
  const facts = (p: RaceAnalysisPackage) => validatePackage(p);
  const errs = (r: { errors: string[] }) => r.errors.join("\n");

  it("a facts-only draft without rule checks, markers or coverage is valid", () => {
    const p = clone(BASE);
    p.ruleChecks = [];
    delete p.ruleMarkers;
    delete p.ruleCoverage;
    expect(facts(p).errors).toEqual([]);
  });

  it("A21: a finding may not claim more than the severityCeiling of a check it cites (every stage)", () => {
    const p = clone(GOOD);
    p.ruleFindings[0].severity = "possible";
    expect(errs(run(p))).toMatch(/A21 finding:1 severity possible exceeds the severityCeiling info of rule:min-pit-lane-time:11:1/);
    expect(errs(facts(p))).toMatch(/A21 /);
    p.ruleChecks[0].severityCeiling = "possible";
    expect(errs(facts(p))).not.toMatch(/A21 /);
    delete p.ruleChecks[0].severityCeiling;
    expect(errs(facts(p))).not.toMatch(/A21 /);
  });

  it("engine-shaped findings and the pre-contract G3 sections are refused by the schema (V1)", () => {
    const a = clone(GOOD) as any;
    a.ruleFindings[0] = { id: "finding:1", ruleId: "min-pit-lane-time", severity: "info", statement: null };
    expect(errs(run(a))).toMatch(/V1/);
    for (const k of ["ruleChecksRun", "rulesNotCheckable"]) {
      const b = clone(BASE) as any;
      b[k] = [];
      expect(errs(facts(b))).toMatch(new RegExp(`V1 .*additional properties .*${k}`));
    }
  });

  const check = (over: Partial<RuleCheck>): RuleCheck => ({
    ...clone(BASE.ruleChecks[0]),
    officialAction: undefined,
    ...over,
  });

  it("markers resolve to a check of the same car and rule (V2, V3)", () => {
    const p = clone(BASE);
    p.ruleMarkers = [{ id: "marker:11:1", kind: "earliest_legal_pit", car: "11", lap: 3, clock: null, raceTimeS: 600, ruleCheckId: "rule:min-pit-lane-time:11:1", ruleKey: "min-pit-lane-time" }];
    expect(facts(p).errors).toEqual([]);
    p.ruleMarkers[0].ruleCheckId = "rule:min-pit-lane-time:11:9";
    expect(errs(facts(p))).toMatch(/V3 marker:11:1 -> ruleCheckId/);
    p.ruleMarkers[0] = { ...p.ruleMarkers[0], id: "marker:7:1", car: "7", ruleCheckId: "rule:min-pit-lane-time:11:1" };
    expect(errs(facts(p))).toMatch(/V3 marker:7:1 -> rule:min-pit-lane-time:11:1 is for another car/);
    p.ruleMarkers[0].ruleCheckId = null;
    expect(facts(p).errors).toEqual([]);
  });

  it("check ids name the rule and car; a race-level check has car null and '_race' (V2)", () => {
    const p = clone(BASE);
    p.ruleChecks.push(check({ id: "rule:min-pit-lane-time:7:1", car: "11" }));
    expect(errs(facts(p))).toMatch(/V2 rule:min-pit-lane-time:7:1 must be rule:min-pit-lane-time:11:<n>/);
    const q = clone(BASE);
    q.ruleChecks.push(check({ id: "rule:min-pit-lane-time:_race:1", car: null, subjectFactIds: ["pit:11:2"] }));
    q.ruleCoverage!.run[0].checks = 2;
    expect(facts(q).errors).toEqual([]);
  });

  it("margins agree with the status, bounds hold the measured value, passes have ceiling info (V8)", () => {
    const cases: [Partial<RuleCheck>, RegExp][] = [
      [{ status: "pass", margin: -1, limit: 61 }, /passes with a negative margin/],
      [{ status: "fail", margin: 2, limit: 58 }, /fails with a non-negative margin/],
      [{ measuredRange: [59, 61] }, /measured 60 is not the measuredRange lower bound 59/],
      [{ measuredRange: [60, 59] }, /measuredRange lower 60 > upper 59/],
      [{ status: "pass", severityCeiling: "possible" }, /pass with severityCeiling possible/],
    ];
    for (const [over, re] of cases) {
      const p = clone(BASE);
      Object.assign(p.ruleChecks[0], over);
      expect(errs(facts(p))).toMatch(re);
    }
  });

  it("coverage counts equal the checks written per rule (V8)", () => {
    const p = clone(BASE);
    p.ruleCoverage!.run[0].checks = 2;
    expect(errs(facts(p))).toMatch(/V8 ruleCoverage.run counts 2 checks for min-pit-lane-time, ruleChecks has 1/);
    const q = clone(BASE);
    q.ruleCoverage!.run = [];
    expect(errs(facts(q))).toMatch(/V8 ruleCoverage.run counts 0 checks for min-pit-lane-time/);
  });
});

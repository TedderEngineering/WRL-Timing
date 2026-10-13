/**
 * validate-package.ts: core negatives (T11) and one mutation per analysis rule A1–A20
 * (stage2/claude/tools/mutation_tests.py), on a synthetic race with a hand-written valid analysis.
 */
import { describe, expect, it } from "vitest";
import { buildFacts } from "../buildFacts.js";
import { buildStoryEvents } from "../engine/story-events.js";
import { formatDuration, validatePackage } from "../validate-package.js";
import type { CarStory, FactRef, KeyMoment, RaceAnalysisPackage, RuleCheck } from "../schema/package-types.js";
import { greenRace, OPTS } from "./scenarios.js";
import { synthImsa } from "./synth.js";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function facts(): RaceAnalysisPackage {
  const pkg = buildFacts({ format: "alkamel-imsa", files: synthImsa(greenRace()), options: OPTS });
  const check: RuleCheck = {
    id: "rule:min-pit-lane-time:11:1",
    ruleKey: "min-pit-lane-time",
    rulebookRef: { field: "pitStop.minimumPitLaneTimeS", section: "TBD" },
    car: "11",
    subjectFactIds: ["pit:11:2"],
    status: "unknown",
    measured: 60,
    limit: null,
    unit: "s",
    margin: null,
    officialAction: ["pen:11:1"],
    source: { kind: "derived" },
    confidence: "low",
    confidenceNotes: ["rulebook_value_missing"],
  };
  pkg.ruleChecks = [check];
  return pkg;
}

const ref = (pkg: RaceAnalysisPackage, factId: string, field: string, unit: FactRef["unit"]): FactRef => {
  let obj: any = factId.startsWith("result:") ? pkg.entries.find((e) => e.result?.id === factId)!.result : [...pkg.events.pitPassages, ...pkg.events.penalties].find((x) => x.id === factId);
  for (const p of field.split(".")) obj = obj[p];
  const r: FactRef = { value: obj, factId, field, unit };
  if (unit === "s") r.display = formatDuration(obj);
  if (unit === "pos") r.display = `P${obj}`;
  return r;
};

function analysis(base: RaceAnalysisPackage): RaceAnalysisPackage {
  const P = clone(base);
  const events = buildStoryEvents(base);
  P.carStories = P.entries.map((e): CarStory => {
    const car = e.car;
    const need = new Set<string>([`result:${car}`]);
    for (const r of P.events.retirements) if (r.car === car) need.add(r.id);
    for (const p of P.events.penalties) if (p.car === car) need.add(p.id);
    for (const p of P.events.pitPassages) if (p.car === car && p.kind !== "stop") need.add(p.id);
    const firstStop = P.events.pitPassages.find((p) => p.car === car && p.kind === "stop" && p.officialPitLaneTimeS !== null);
    const paragraphs = [{ text: `{car:${car}} completed {0} laps.`, refs: [ref(P, `result:${car}`, "laps", "laps")] }];
    if (firstStop) {
      paragraphs.push({ text: "It spent {0} in the pit lane on lap {1}.", refs: [ref(P, firstStop.id, "officialPitLaneTimeS", "s"), ref(P, firstStop.id, "inLap", "lap")] });
      need.add(firstStop.id);
    }
    const evs = (events[car] ?? []).map((x, i) => (i === 0 ? { ...x, title: { text: `{car:${car}} in the pit lane`, refs: [] } } : x));
    return {
      id: `story:${car}`,
      car,
      headline: { text: `{car:${car}} finished {0} in {class:${e.class}} on the provisional results.`, refs: [ref(P, `result:${car}`, "positionClass", "pos")] },
      paragraphs,
      keyFactIds: [...need],
      events: evs,
    };
  });
  P.ruleFindings = [
    {
      id: "finding:1",
      ruleCheckIds: ["rule:min-pit-lane-time:11:1"],
      car: "11",
      assessment: "data_insufficient",
      severity: "info",
      statement: { text: "Race control penalised {car:11}; its stop on lap {0} took {1} in the pit lane, and the rulebook minimum is not on file.", refs: [ref(P, "pit:11:2", "inLap", "lap"), ref(P, "pit:11:2", "officialPitLaneTimeS", "s")] },
      judgementOnLowConfidence: { text: "The check waits for the rulebook value, so no shortfall is stated.", refs: [] },
    },
  ];
  const winner = P.entries.find((e) => e.result?.positionOverall === 1)!.car;
  const cw = (cls: string) => P.entries.find((e) => e.class === cls && e.result?.positionClass === 1)!.car;
  const stops = P.events.pitPassages.filter((p) => p.kind === "stop" && p.outcome === "rejoined").sort((a, b) => a.inLap - b.inLap || a.id.localeCompare(b.id)).slice(0, 4);
  const keyMoments: KeyMoment[] = stops.map((p, i) => ({
    id: `moment:${i + 1}`,
    lap: ref(P, p.id, "inLap", "lap"),
    causes: ["pit_cycle"],
    title: { text: `{car:${p.car}} makes its stop`, refs: [] },
    text: { text: `{car:${p.car}} pitted on lap {0}.`, refs: [ref(P, p.id, "inLap", "lap")] },
    cars: [p.car],
    factIds: [p.id],
  }));
  P.raceSummary = {
    id: "summary",
    headline: { text: `{car:${winner}} won the race, {0} overall on the provisional results.`, refs: [ref(P, `result:${winner}`, "positionOverall", "pos")] },
    paragraphs: [{ text: `{car:${winner}} led at the finish. {car:${cw("TCR")}} won {class:TCR}.`, refs: [] }],
    classSummaries: ["GS", "TCR"].map((c) => ({ class: c, text: { text: `{car:${cw(c)}} won {class:${c}}, {0} in class on the provisional results.`, refs: [ref(P, `result:${cw(c)}`, "positionClass", "pos")] } })),
    keyMoments,
  };
  P.analysis = { author: "claude", skill: "/analyze-race@test" };
  P.completeness = { ...P.completeness, carStories: "complete", ruleFindings: "complete", raceSummary: "complete" };
  return P;
}

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
    ["published while a blocker or section is open", (p) => {
      p.status = "published";
      p.completeness.ruleChecks = "partial";
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

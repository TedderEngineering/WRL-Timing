/**
 * A complete, publishable sample package built from a synthetic race: the facts
 * draft (`sampleFacts`) and a hand-written analysis on top of it (`sampleAnalysis`).
 * Shared by the validator tests and the package-ingest (G5) tests.
 */
import { buildFacts } from "../buildFacts.js";
import { buildStoryEvents } from "../engine/story-events.js";
import { formatDuration } from "../validate-package.js";
import { lapLossFacts } from "../lap-loss.js";
import type { CarStory, FactRef, KeyMoment, RaceAnalysisPackage, RuleCheck } from "../schema/package-types.js";
import { greenRace, OPTS } from "./scenarios.js";
import { synthImsa } from "./synth.js";

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function sampleFacts(): RaceAnalysisPackage {
  const pkg = buildFacts({ format: "alkamel-imsa", files: synthImsa(greenRace()), options: OPTS });
  // rule-check contract (schema 1.1.0): what run-rule-checks writes; Claude writes the finding from it
  const check: RuleCheck = {
    id: "rule:min-pit-lane-time:11:1",
    ruleKey: "min-pit-lane-time",
    rulebookRef: { field: "pitStop.minimumPitLaneTimeS", section: "TBD", doc: "TBD", quote: "TBD" },
    car: "11",
    subjectFactIds: ["pit:11:2"],
    status: "unknown",
    measured: 60,
    limit: null,
    unit: "s",
    margin: null,
    officialAction: ["pen:11:1"],
    lap: 10,
    verified: false,
    severityCeiling: "info",
    severityNotes: ["rule_unverified"],
    notes: ["race_control_penalised"],
    source: { kind: "derived" },
    confidence: "low",
    confidenceNotes: ["rulebook_value_missing"],
  };
  pkg.ruleChecks = [check];
  pkg.ruleMarkers = [];
  pkg.ruleCoverage = {
    rulebookId: "sample-2026",
    rulebookHash: "0".repeat(64),
    event: null,
    session: null,
    run: [{ ruleId: "min-pit-lane-time", checks: 1 }],
    notCheckable: [{ ruleId: "max-stint", reason: "tbd_value", detail: "params.value_s", tbd: [{ field: "params.value_s", question: "Maximum stint?" }] }],
  };
  return pkg;
}

export const ref = (pkg: RaceAnalysisPackage, factId: string, field: string, unit: FactRef["unit"]): FactRef => {
  let obj: any = factId.startsWith("result:") ? pkg.entries.find((e) => e.result?.id === factId)!.result : [...pkg.events.pitPassages, ...pkg.events.penalties].find((x) => x.id === factId);
  for (const p of field.split(".")) obj = obj[p];
  const r: FactRef = { value: obj, factId, field, unit };
  if (unit === "s") r.display = formatDuration(obj);
  if (unit === "pos") r.display = `P${obj}`;
  return r;
};

export function sampleAnalysis(base: RaceAnalysisPackage): RaceAnalysisPackage {
  const P = clone(base);
  const events = buildStoryEvents(base);
  const lapLoss = lapLossFacts(base);
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
    const lost = lapLoss.get(car);
    if (lost && lost.lapsLost > 0) {
      paragraphs.push({ text: "It lost {0} laps to its class leader, {1} of them on track.", refs: [{ value: lost.lapsLost, factId: `laploss:${car}`, field: "lapsLost", unit: "laps" }, { value: lost.onTrack, factId: `laploss:${car}`, field: "onTrack", unit: "laps" }] });
    }
    const evs = (events[car] ?? []).map((x, i) => (i === 0 ? { ...x, title: { text: `{car:${car}} in the pit lane`, refs: [] } } : x));
    return {
      id: `story:${car}`,
      car,
      headline: { text: `{car:${car}} ${P.events.retirements.some((r) => r.car === car) ? "is classified" : "finished"} {0} in {class:${e.class}} on the provisional results.`, refs: [ref(P, `result:${car}`, "positionClass", "pos")] },
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


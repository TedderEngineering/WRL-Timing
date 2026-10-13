// Dev helper: print the synthetic scenario packages' passages.  npx tsx src/analysis/__tests__/dump-synth.ts
import { buildFacts } from "../buildFacts.js";
import { greenRace, fcyRace, OPTS } from "./scenarios.js";
import { synthImsa } from "./synth.js";

for (const [name, r] of [["green", greenRace()], ["fcy", fcyRace()]] as const) {
  const pkg = buildFacts({ format: "alkamel-imsa", files: synthImsa(r), options: OPTS });
  console.log("==", name, pkg.dataQuality.map((d) => d.code).join(","));
  for (const p of pkg.events.pitPassages) {
    console.log(p.id, p.kind, p.outcome, p.inLap, p.outLap, p.officialPitLaneTimeS, p.fcyContext, p.timeLost.method, p.timeLost.valueS, p.cycleId, p.lapDown, p.penaltiesServed.join("|"), (p.confidenceNotes ?? []).join("|"));
  }
  for (const c of pkg.pitCycles) console.log(c.id, c.members.map((m) => m.car).join(","));
  for (const pen of pkg.events.penalties) console.log(pen.id, pen.penaltyType, pen.status, pen.servedByPassageId, pen.resultsEffectS);
  for (const e of pkg.entries) if (e.result?.postRacePenaltyS) console.log(e.car, e.result.positionOverall, e.result.prePenaltyPositionOverall, e.result.postRacePenaltyS);
  console.log(pkg.events.retirements.map((r) => `${r.id}:${r.where}`).join(" "));
}

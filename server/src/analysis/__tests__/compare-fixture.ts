/**
 * Compare a built package against expected/<race>.json (Stage 1 fixtures + fixture_deltas.json)
 * with the FACT_ENGINE_SPEC.md §8.2 tolerances. Returns every mismatch; callers decide.
 */
import type { CycleResult, PitPassage, RaceAnalysisPackage } from "../schema/package-types.js";

export const TOL = {
  clock: 0.001, // T1 pitIn/pitOut
  official: 0.001, // T1 officialPitLaneTimeS
  lossAlkamel: 0.002, // T2 Alkamel (3 dp) green and FCY (fixture_deltas C1/C2), groups (C3)
  lossWrl: 0.006, // T2 WRL (2 dp in the fixture)
  refLap: 0.0006, // T2 refLapS
  classMedian: 0.0006,
  fcyFlags: 0.001, // T5 flags-file periods
  fcyRecon: 0.01, // T5 reconstructed, against V1_race_level_fcy (Alkamel, 3 dp)
  fcyReconWrl: 0.051, // T5 WRL: V1_race_level_fcy is printed to 1 dp, so ±0.05 is the rounding of the expected value itself
};

export interface Mismatch {
  key: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface CompareResult {
  race: string;
  totalPassages: number;
  matchedPassages: number;
  mismatches: Mismatch[];
  raceLevel: Mismatch[];
}

function clockSecs(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

const byLen = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

export function compareRace(pkg: RaceAnalysisPackage, exp: any): CompareResult {
  const wrl = exp.family === "wrl";
  const mismatches: Mismatch[] = [];
  const raceLevel: Mismatch[] = [];
  const passages = pkg.events.pitPassages;
  const cycById = new Map(pkg.pitCycles.map((c) => [c.id, c]));
  const crByPassage = new Map<string, CycleResult>(pkg.cycleResults.map((r) => [r.passageId, r]));
  const groups = new Map(pkg.events.pitGroups.map((g) => [g.id, g]));
  const lossTol = wrl ? TOL.lossWrl : TOL.lossAlkamel;
  const near = (a: number | null | undefined, b: number | null | undefined, t: number) =>
    (a === null || a === undefined) && (b === null || b === undefined) ? true : a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) <= t + 1e-9;
  let matched = 0;
  for (const e of exp.passages) {
    const key = `${e.car}:L${e.inLap}`;
    const cands = passages.filter((p) => p.car === e.car && p.inLap === e.inLap);
    const mm: Mismatch[] = [];
    const chk = (field: string, ok: boolean, expected: unknown, actual: unknown) => {
      if (!ok) mm.push({ key, field, expected, actual });
    };
    if (cands.length !== 1) {
      mm.push({ key, field: "presence", expected: 1, actual: cands.length });
      mismatches.push(...mm);
      continue;
    }
    const p: PitPassage = cands[0];
    chk("outLap", p.outLap === e.outLap, e.outLap, p.outLap);
    chk("kind", p.kind === e.kind, e.kind, p.kind);
    chk("outcome", p.outcome === e.outcome, e.outcome, p.outcome);
    if (wrl) chk("underFcy", (p.fcyContext !== "green") === e.underFcy, e.underFcy, p.fcyContext);
    else {
      chk("fcyContext", p.fcyContext === e.fcyContext, e.fcyContext, p.fcyContext);
      chk("inLapCompleted", p.inLapCompleted === e.inLapCompleted, e.inLapCompleted, p.inLapCompleted);
      if (p.pitIn) chk("pitIn", near(clockSecs(p.pitIn.clock), e.pitInClockS, TOL.clock), e.pitInClockS, p.pitIn.clock);
      if (p.pitOut) chk("pitOut", near(clockSecs(p.pitOut.clock), e.pitOutClockS, TOL.clock), e.pitOutClockS, p.pitOut.clock);
      chk("officialPitLaneTimeS", near(p.officialPitLaneTimeS, e.officialPitLaneTimeS, TOL.official), e.officialPitLaneTimeS, p.officialPitLaneTimeS);
      if (e.pitLaneTimeReliable !== null && e.pitLaneTimeReliable !== undefined) chk("pitLaneTimeReliable", p.pitLaneTimeReliable === e.pitLaneTimeReliable, e.pitLaneTimeReliable, p.pitLaneTimeReliable);
    }
    // time lost
    const et = e.timeLost;
    const tl = p.timeLost;
    if (et.method === "fcy_fallback_or_none") {
      chk("timeLost.method", tl.method === "fcy_lap_field" || tl.method === "none", "fcy_lap_field|none", tl.method);
    } else if (et.method === "see_group") {
      chk("timeLost.method", tl.method === "see_group", "see_group", tl.method);
    } else {
      chk("timeLost.method", tl.method === et.method, et.method, tl.method);
      chk("timeLost.valueS", near(tl.valueS, et.valueS, lossTol), et.valueS, tl.valueS);
      if (et.refLapS !== undefined) chk("timeLost.refLapS", near(tl.refLapS, et.refLapS, TOL.refLap), et.refLapS, tl.refLapS);
      if (et.refWindowLaps !== undefined) chk("timeLost.refWindowLaps", tl.refWindowLaps === et.refWindowLaps, et.refWindowLaps, tl.refWindowLaps);
      if (et.refLapCount !== undefined) chk("timeLost.refLapCount", tl.refLapCount === et.refLapCount, et.refLapCount, tl.refLapCount);
    }
    // positions through the stop
    if (e.position) {
      const cr = crByPassage.get(p.id);
      const pe = cr ?? p.positionEffect;
      if (!pe) chk("position", false, "positionEffect/cycleResult", null);
      else {
        const ep = e.position;
        if (ep.beforeLap !== undefined) chk("beforeLap", pe.beforeLap === ep.beforeLap, ep.beforeLap, pe.beforeLap);
        chk("afterLap", pe.afterLap === ep.afterLap, ep.afterLap, pe.afterLap);
        chk("classPosBefore", pe.classPosBefore === ep.classPosBefore, ep.classPosBefore, pe.classPosBefore);
        chk("classPosAfter", pe.classPosAfter === ep.classPosAfter, ep.classPosAfter, pe.classPosAfter);
        chk("netClass", pe.netClass === ep.netClass, ep.netClass, pe.netClass);
        const g = (pe.gainedOn ?? []).map((x) => x.car).sort(byLen);
        const l = (pe.lostTo ?? []).map((x) => x.car).sort(byLen);
        chk("gainedOn", JSON.stringify(g) === JSON.stringify(ep.gainedOn), ep.gainedOn, g);
        chk("lostTo", JSON.stringify(l) === JSON.stringify(ep.lostTo), ep.lostTo, l);
        if (cr) {
          chk("overallPosBefore", cr.overallPosBefore === ep.overallPosBefore, ep.overallPosBefore, cr.overallPosBefore);
          chk("overallPosAfter", cr.overallPosAfter === ep.overallPosAfter, ep.overallPosAfter, cr.overallPosAfter);
          if (ep.netOverall !== undefined) chk("netOverall", cr.netOverall === ep.netOverall, ep.netOverall, cr.netOverall);
          if (ep.lapsDownBefore !== undefined) {
            chk("lapsDownBefore", cr.lapsDownBefore === ep.lapsDownBefore, ep.lapsDownBefore, cr.lapsDownBefore);
            chk("lapsDownAfter", cr.lapsDownAfter === ep.lapsDownAfter, ep.lapsDownAfter, cr.lapsDownAfter);
          }
        }
        if (ep.lapsDownBefore !== undefined && ep.lapsDownBefore !== null && ep.lapsDownAfter !== null) {
          chk("lapDown", p.lapDown === ep.lapsDownAfter > ep.lapsDownBefore, ep.lapsDownAfter > ep.lapsDownBefore, p.lapDown);
        }
      }
    }
    if (e.lapDown !== undefined) chk("lapDown", p.lapDown === e.lapDown, e.lapDown, p.lapDown);
    // cycle membership
    if (e.cycle) {
      const cy = p.cycleId ? cycById.get(p.cycleId) : null;
      const members = cy ? [...new Set(cy.members.map((m) => m.car))].sort(byLen) : null;
      if (e.cycle.id) chk("cycleId", p.cycleId === e.cycle.id, e.cycle.id, p.cycleId);
      chk("cycleMembers", JSON.stringify(members) === JSON.stringify(e.cycle.members), e.cycle.members, members);
    } else chk("cycleId", p.cycleId === null, null, p.cycleId);
    if (mm.length) mismatches.push(...mm);
    else matched++;
  }
  // race level: FCY periods, class medians, cycles, groups
  const fcyExp: number[][] | null = wrl ? exp.fcyIntervalsRaceS : exp.fcyIntervalsClockS;
  if (fcyExp) {
    const got = pkg.fcyPeriods.map((f) => (wrl ? [f.start.raceTimeS, f.end.raceTimeS] : [clockSecs(f.start.clock)!, clockSecs(f.end.clock)!]));
    const t = wrl ? TOL.fcyReconWrl : exp.fcyReconstructed ? TOL.fcyRecon : TOL.fcyFlags;
    if (got.length !== fcyExp.length) raceLevel.push({ key: "fcy", field: "count", expected: fcyExp.length, actual: got.length });
    fcyExp.forEach((iv, i) => {
      const g = got[i];
      if (!g || !near(g[0], iv[0], t) || !near(g[1], iv[1], t)) raceLevel.push({ key: `fcy:${i + 1}`, field: "interval", expected: iv, actual: g });
    });
    if (exp.fcyLeaderLaps) {
      const laps = pkg.fcyPeriods.flatMap((f) => Array.from({ length: f.leaderLaps[1] - f.leaderLaps[0] + 1 }, (_, k) => f.leaderLaps[0] + k));
      if (JSON.stringify(laps) !== JSON.stringify(exp.fcyLeaderLaps)) raceLevel.push({ key: "fcy", field: "leaderLaps", expected: exp.fcyLeaderLaps, actual: laps });
    }
  }
  for (const [cls, v] of Object.entries(exp.classMedianCleanGreenLapS as Record<string, number>)) {
    const c = pkg.metadata.classes.find((x) => x.name === cls || x.id === cls);
    if (!c || !near(c.medianCleanGreenLapS, v, TOL.classMedian)) raceLevel.push({ key: `class:${cls}`, field: "medianCleanGreenLapS", expected: v, actual: c?.medianCleanGreenLapS });
  }
  for (const cy of exp.cycles ?? []) {
    const c = cycById.get(cy.id);
    const members = c ? c.members.map((m) => m.car).sort(byLen) : null;
    const ok = c && JSON.stringify([...new Set(members)]) === JSON.stringify(cy.members) && c.members.length === cy.nMembers && near(clockSecs(c.opens.clock), cy.opensClockS, TOL.clock) && near(clockSecs(c.closes.clock), cy.closesClockS, TOL.clock);
    if (!ok) raceLevel.push({ key: cy.id, field: "cycle", expected: cy, actual: c ? { members, n: c.members.length, opens: c.opens.clock, closes: c.closes.clock } : null });
  }
  for (const g of exp.groups ?? []) {
    const pg = [...groups.values()].find((x) => x.car === g.car && x.laps[0] === g.laps[0] && x.laps[1] === g.laps[1]);
    if (!pg || pg.timeLost.method !== g.method || !near(pg.timeLost.valueS, g.valueS, TOL.lossAlkamel)) raceLevel.push({ key: `group:${g.car}:${g.laps.join("-")}`, field: "timeLost", expected: g, actual: pg?.timeLost });
  }
  if (exp.transitEstimateS !== undefined) {
    const pls = pkg.events.pitPassages.filter((p) => p.officialPitLaneTimeS !== null && p.kind !== "pit_lane_start" && p.outcome === "rejoined").map((p) => p.officialPitLaneTimeS!);
    const m = pls.length ? Math.min(...pls) : null;
    if (!near(m, exp.transitEstimateS, TOL.official)) raceLevel.push({ key: "transit", field: "estimate", expected: exp.transitEstimateS, actual: m });
  }
  return { race: exp.race, totalPassages: exp.passages.length, matchedPassages: matched, mismatches, raceLevel };
}

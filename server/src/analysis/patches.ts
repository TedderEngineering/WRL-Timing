/**
 * The writing side of an analysis run (racetrace-ingest steps 8–9): a digest of a facts package
 * to write from, and the merge of written patches (`analysis-patch/1`) back into the package.
 *
 * Patches may leave out each ref's `value`, `display` and `unit`: the merge fills them from the
 * fact itself (the same lookup and unit table as the validator), so a story can never quote a
 * number that differs from its fact. A value the writer did give is kept, and the validator
 * checks it.
 */
import proseRulesJson from "./schema/prose-rules.json" with { type: "json" };
import type { CarStory, FactRef, Prose, RaceAnalysisPackage, RaceSummary, RuleFinding } from "./schema/package-types.js";
import { buildStoryEvents } from "./engine/story-events.js";
import { expectedDisplay, formatDuration } from "./validate-package.js";

const R: any = proseRulesJson;

// ─── Fact lookup (as validate-package resolves refs) ─────────────────────────

export function factIndex(P: RaceAnalysisPackage): (fid: string) => any | null {
  const facts = new Map<string, any>();
  const add = (x: { id: string } | null | undefined) => x && facts.set(x.id, x);
  for (const e of P.entries) {
    add(e);
    add(e.result);
  }
  const ev = P.events;
  for (const k of ["pitPassages", "pitGroups", "penalties", "retirements", "flags"] as const) for (const x of ev[k]) add(x);
  for (const k of ["fcyPeriods", "stints", "driveTimes", "pitCycles", "cycleResults", "ruleChecks", "dataQuality"] as const) {
    for (const x of (P[k] ?? []) as { id: string }[]) add(x);
  }
  const rows = new Map<string, any>();
  const pr = P.positionChanges.rows;
  for (let i = 0; i < pr.lap.length; i++) rows.set(`pass:${pr.winner[i]}:${pr.lap[i]}:${pr.loser[i]}`, { lap: pr.lap[i], winner: pr.winner[i], loser: pr.loser[i], mechanism: pr.mechanism[i] });
  const ld = P.positionChanges.lapDowns;
  if (ld) for (let i = 0; i < ld.car.length; i++) rows.set(`lapdown:${ld.car[i]}:${ld.lap[i]}`, { car: ld.car[i], lap: ld.lap[i], lapsDown: ld.lapsDown[i], cause: ld.cause[i] });
  return (fid) => {
    if (fid.startsWith("lap:")) {
      const p = fid.split(":");
      const cols = p.length === 3 ? (P.laps.cars as any)[p[1]] : undefined;
      if (!cols) return null;
      const i = cols.lap.indexOf(Number(p[2]));
      if (i < 0) return null;
      const row: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cols)) row[k] = (v as unknown[])[i];
      return row;
    }
    if (fid.startsWith("pass:") || fid.startsWith("lapdown:")) return rows.get(fid) ?? null;
    return facts.get(fid) ?? null;
  };
}

export function fieldOf(obj: any, path: string): unknown {
  let cur = obj;
  for (const part of path.match(/[A-Za-z][A-Za-z0-9]*|\[[0-9]+\]/g) ?? []) {
    if (part === "length" && Array.isArray(cur)) cur = cur.length;
    else if (part.startsWith("[")) cur = cur?.[Number(part.slice(1, -1))];
    else cur = cur?.[part];
    if (cur === undefined) return undefined;
  }
  return cur;
}

export function unitFor(field: string): FactRef["unit"] | null {
  for (const [u, spec] of Object.entries(R.units as Record<string, { fields: string }>)) if (new RegExp(spec.fields).test(field)) return u as FactRef["unit"];
  return null;
}

/** Fill a ref's value, unit and display from its fact. Throws on an unknown fact or field. */
export function fillRef(r: Partial<FactRef> & { factId: string; field: string }, find: (fid: string) => any | null): FactRef {
  const obj = find(r.factId);
  if (obj === null) throw new Error(`unknown fact ${r.factId}`);
  const raw = fieldOf(obj, r.field);
  if (raw === undefined) throw new Error(`${r.factId} has no field ${r.field}`);
  // A nested field ("positionEffect.classPosBefore") takes the unit of its last part.
  const unit = r.unit ?? unitFor(r.field) ?? unitFor(r.field.split(".").pop() ?? "") ?? undefined;
  let value = r.value;
  if (value === undefined) {
    if (typeof raw === "number") value = r.transform === "abs" ? Math.abs(raw) : r.transform === "neg" ? -raw : raw;
    else if (typeof raw === "string") value = raw;
    else throw new Error(`${r.factId}.${r.field} is ${raw === null ? "null" : typeof raw}: cite another fact`);
  }
  const out: FactRef = { value, factId: r.factId, field: r.field };
  if (unit) out.unit = unit;
  if (r.transform) out.transform = r.transform;
  if (r.display !== undefined) out.display = r.display;
  else if (typeof value === "number" && unit === "s") out.display = formatDuration(value);
  else if (typeof value === "number" && unit === "pos") out.display = expectedDisplay(value, unit);
  return out;
}

function fillProse(p: Prose | undefined, find: (fid: string) => any | null, where: string, problems: string[]): Prose | undefined {
  if (!p) return p;
  const refs = (p.refs ?? []).map((r, i) => {
    try {
      return fillRef(r as FactRef, find);
    } catch (e) {
      problems.push(`${where} ref ${i}: ${(e as Error).message}`);
      return r as FactRef;
    }
  });
  return { text: p.text, refs };
}

// ─── Patches ─────────────────────────────────────────────────────────────────

export interface AnalysisPatch {
  patchFormat: "analysis-patch/1";
  packageId?: string;
  basedOn?: { engineVersion?: string; generatedAt?: string };
  scope: { kind: "class"; class: string } | { kind: "race" };
  carStories?: (Omit<CarStory, "events"> & { events?: { id: string; title?: Prose; text?: Prose }[] })[];
  ruleFindings?: Omit<RuleFinding, "id">[] & { id?: string }[];
  raceSummary?: RaceSummary;
  factJudgements?: { factId: string; confidence?: "low" | "medium"; note: string }[];
  notes?: string[];
}

export interface MergeResult {
  pkg: RaceAnalysisPackage;
  problems: string[];
}

/**
 * Merge patches into a copy of the facts package: stories replace the car's story, findings are
 * appended and numbered finding:1…n in order, the race patch sets the summary. Every ref is
 * filled from its fact. Each story gets the engine's event skeleton (with any titles written).
 */
export function mergePatches(base: RaceAnalysisPackage, patches: AnalysisPatch[], meta: { skill?: string; model?: string } = {}): MergeResult {
  const P: RaceAnalysisPackage = JSON.parse(JSON.stringify(base));
  const find = factIndex(base);
  const problems: string[] = [];
  const skeleton = buildStoryEvents(base);
  const stories = new Map<string, CarStory>();
  const findings: RuleFinding[] = [];

  for (const patch of patches) {
    if (patch.patchFormat !== "analysis-patch/1") {
      problems.push(`patch with format ${JSON.stringify(patch.patchFormat)}`);
      continue;
    }
    if (patch.basedOn?.generatedAt && patch.basedOn.generatedAt !== base.generatedAt) {
      problems.push(`patch ${JSON.stringify(patch.scope)} was written on facts generated ${patch.basedOn.generatedAt}, not ${base.generatedAt}`);
    }
    for (const s of patch.carStories ?? []) {
      const sid = `story:${s.car}`;
      const written = new Map((s.events ?? []).map((e) => [e.id, e]));
      const events = (skeleton[s.car] ?? []).map((e) => {
        const w = written.get(e.id);
        const out = { ...e };
        if (w?.title) out.title = fillProse(w.title, find, `${sid} ${e.id}.title`, problems);
        if (w?.text) out.text = fillProse(w.text, find, `${sid} ${e.id}.text`, problems);
        return out;
      });
      const story: CarStory = {
        id: sid,
        car: s.car,
        headline: fillProse(s.headline, find, `${sid}.headline`, problems)!,
        paragraphs: (s.paragraphs ?? []).map((p, i) => fillProse(p, find, `${sid}.paragraphs[${i}]`, problems)!),
        keyFactIds: s.keyFactIds ?? [],
        ...(s.lowConfidenceJudgements?.length
          ? {
              lowConfidenceJudgements: s.lowConfidenceJudgements.map((j) => ({
                factId: j.factId,
                judgement: fillProse(j.judgement, find, `${sid} judgement ${j.factId}`, problems)!,
              })),
            }
          : {}),
        ...(events.length ? { events } : {}),
      };
      if (stories.has(s.car)) problems.push(`second story for car ${s.car}`);
      stories.set(s.car, story);
    }
    for (const f of (patch.ruleFindings ?? []) as RuleFinding[]) {
      findings.push({
        ...f,
        id: "",
        statement: fillProse(f.statement, find, `finding for ${f.ruleCheckIds?.join(",")}`, problems)!,
        ...(f.judgementOnLowConfidence ? { judgementOnLowConfidence: fillProse(f.judgementOnLowConfidence, find, `finding judgement`, problems) } : {}),
      });
    }
    if (patch.raceSummary) {
      const s = patch.raceSummary;
      P.raceSummary = {
        id: "summary",
        headline: fillProse(s.headline, find, "summary.headline", problems)!,
        paragraphs: s.paragraphs.map((p, i) => fillProse(p, find, `summary.paragraphs[${i}]`, problems)!),
        ...(s.classSummaries ? { classSummaries: s.classSummaries.map((c) => ({ class: c.class, text: fillProse(c.text, find, `summary class ${c.class}`, problems)! })) } : {}),
        ...(s.keyMoments
          ? {
              keyMoments: s.keyMoments.map((k, i) => ({
                ...k,
                id: k.id ?? `moment:${i + 1}`,
                lap: fillRef(k.lap as FactRef, find),
                ...(k.lapEnd ? { lapEnd: fillRef(k.lapEnd as FactRef, find) } : {}),
                title: fillProse(k.title, find, `moment ${i + 1}.title`, problems)!,
                text: fillProse(k.text, find, `moment ${i + 1}.text`, problems)!,
              })),
            }
          : {}),
      };
    }
    for (const j of patch.factJudgements ?? []) problems.push(`factJudgements are not merged by this tool (${j.factId}); write the judgement in the story instead`);
  }

  // Stories in entry order; findings numbered in order.
  P.carStories = P.entries.map((e) => stories.get(e.car)).filter((s): s is CarStory => !!s);
  P.ruleFindings = findings.map((f, i) => ({ ...f, id: `finding:${i + 1}` }));
  const all = P.carStories.length === P.entries.length;
  P.completeness = {
    ...P.completeness,
    carStories: all ? "complete" : P.carStories.length ? "partial" : "absent",
    ruleFindings: "complete",
    raceSummary: P.raceSummary ? "complete" : "absent",
  };
  P.analysis = { author: "claude", ...(meta.skill ? { skill: meta.skill } : {}), ...(meta.model ? { model: meta.model } : {}), completedAt: new Date().toISOString() };
  return { pkg: P, problems };
}

// ─── Digest ──────────────────────────────────────────────────────────────────

const num = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)) : v === null || v === undefined ? "-" : String(v));
const secs = (v: unknown) => (typeof v === "number" ? `${num(v)}s (${formatDuration(v)})` : "-");

/**
 * A plain-text digest of one class (or the race), one line per fact with its id and the field
 * names to cite. Written to be read by the person or agent writing the stories.
 */
/** Counterparties as `car(cause)[pass:…]`, so the row behind each one can be cited. */
function cps(xs: { car: string; cause: string; passId?: string | null }[] | undefined): string {
  return (xs ?? []).map((g) => `${g.car}(${g.cause})${g.passId ? `[${g.passId}]` : ""}`).join(",") || "-";
}

export function classDigest(P: RaceAnalysisPackage, cls: string): string {
  const L: string[] = [];
  const entries = P.entries.filter((e) => e.class === cls).sort((a, b) => (a.result?.positionClass ?? 999) - (b.result?.positionClass ?? 999));
  const ev = P.events;
  const className = P.metadata.classes.find((c) => c.id === cls)?.name ?? cls;
  L.push(`# Class ${cls} (${className}) · ${entries.length} cars · results ${P.metadata.resultsStatus}`);
  L.push("");
  L.push(
    "Row facts are citable like any other: `pass:<winner>:<lap>:<loser>` (fields lap, winner, loser, mechanism) and `lapdown:<car>:<lap>` (fields lap, lapsDown, cause). Each gainedOn / lostTo entry below names its row in brackets. stats.nMembers counts cars: a car that stopped twice in one cycle is one member."
  );
  L.push("");
  L.push("## Pit cycles in class");
  for (const c of P.pitCycles.filter((x) => x.class === cls)) {
    L.push(
      `${c.id} ordinal=${c.ordinal} trigger=${c.trigger} stats.nMembers=${c.stats.nMembers} meanTimeLostS=${secs(c.stats.meanTimeLostS)} bestTimeLostS=${secs(c.stats.bestTimeLostS)} best=${c.stats.bestTimeLostPassageId ?? "-"} fcy=${(c.fcyPeriodIds ?? []).join(",") || "-"}`
    );
  }
  for (const e of entries) {
    const car = e.car;
    const r = e.result;
    L.push("");
    L.push(`## {car:${car}} ${e.team} · ${e.vehicle} · drivers ${e.drivers.map((d) => `{driver:${car}:${d.number}}=${d.name}`).join(", ") || "-"}`);
    L.push(`car:${car} startPosition=${num(e.startPosition)}`);
    if (r) {
      L.push(
        `${r.id} status=${r.status} positionClass=${num(r.positionClass)} positionOverall=${num(r.positionOverall)} laps=${num(r.laps)} gapFirst=${r.gapFirst ?? "-"} bestLapS=${secs(r.bestLapS)} bestLapNumber=${num(r.bestLapNumber)} confidence=${r.confidence}`
      );
    } else L.push(`(no result)`);
    for (const s of P.stints.filter((x) => x.car === car)) {
      L.push(`${s.id} driver=${num(s.driver)} startLap=${s.startLap} endLap=${s.endLap} laps=${s.laps} driveTimeS=${secs(s.driveTimeS)} start=${s.startReason} end=${s.endReason}`);
    }
    for (const p of ev.pitPassages.filter((x) => x.car === car)) {
      const cr = P.cycleResults.find((x) => x.passageId === p.id);
      L.push(
        `${p.id} kind=${p.kind} stopNumber=${num(p.stopNumber)} inLap=${p.inLap} outLap=${num(p.outLap)} fcyContext=${p.fcyContext} officialPitLaneTimeS=${secs(p.officialPitLaneTimeS)} timeLost.valueS=${secs(p.timeLost.valueS)} (${p.timeLost.method}) driverIn=${num(p.driverIn)} driverOut=${num(p.driverOut)} cycleId=${p.cycleId ?? "-"} outcome=${p.outcome} confidence=${p.confidence}${p.positionEffect ? ` positionEffect.classPosBefore=${num(p.positionEffect.classPosBefore)} positionEffect.classPosAfter=${num(p.positionEffect.classPosAfter)} positionEffect.netClass=${num(p.positionEffect.netClass)} gainedOn=${cps(p.positionEffect.gainedOn)} lostTo=${cps(p.positionEffect.lostTo)}` : ""}`
      );
      if (cr) {
        L.push(
          `  ${cr.id} beforeLap=${num(cr.beforeLap)} afterLap=${num(cr.afterLap)} classPosBefore=${num(cr.classPosBefore)} classPosAfter=${num(cr.classPosAfter)} netClass=${num(cr.netClass)} timeLostRank=${num(cr.timeLostRank)} deltaToCycleMeanS=${secs(cr.deltaToCycleMeanS)} gainedOn=${cps(cr.gainedOn)} lostTo=${cps(cr.lostTo)} confidence=${cr.confidence}${cr.confidenceNotes?.includes("several_stops_in_cycle") ? " (car stopped more than once in this cycle: rank and delta are over its stops combined)" : ""}`
        );
      }
    }
    for (const g of ev.pitGroups.filter((x) => x.car === car)) L.push(`${g.id} laps=${g.laps.join("-")} timeLost.valueS=${secs(g.timeLost.valueS)} passages=${g.passageIds.join(",")}`);
    for (const p of ev.penalties.filter((x) => x.car === car)) {
      L.push(`${p.id} reason="${p.reason}" penaltyType=${p.penaltyType} status=${p.status} amountS=${secs(p.amountS)} issuedLeaderLap=${num(p.issuedLeaderLap)} servedBy=${p.servedByPassageId ?? "-"}`);
    }
    for (const x of ev.retirements.filter((y) => y.car === car)) L.push(`${x.id} lastCompletedLap=${x.lastCompletedLap} where=${x.where} classPosAtRetirement=${num(x.classPosAtRetirement)}`);
    const pr = P.positionChanges.rows;
    const passes: string[] = [];
    for (let i = 0; i < pr.lap.length; i++) {
      if (pr.mechanism[i] !== "on_track") continue;
      if (pr.winner[i] === car) passes.push(`pass:${pr.winner[i]}:${pr.lap[i]}:${pr.loser[i]} (gained on ${pr.loser[i]})`);
      else if (pr.loser[i] === car) passes.push(`pass:${pr.winner[i]}:${pr.lap[i]}:${pr.loser[i]} (lost to ${pr.winner[i]})`);
    }
    if (passes.length) L.push(`on-track class swaps (${passes.length}): ${passes.slice(0, 12).join("; ")}${passes.length > 12 ? " …" : ""}`);
    const ld = P.positionChanges.lapDowns;
    if (ld) {
      const mine = ld.car.map((c, i) => (c === car ? `lapdown:${c}:${ld.lap[i]} lapsDown=${ld.lapsDown[i]} cause=${ld.cause[i]}` : null)).filter(Boolean);
      if (mine.length) L.push(mine.join("; "));
    }
    for (const c of P.ruleChecks.filter((x) => x.car === car && x.status !== "pass" && x.status !== "not_applicable")) {
      L.push(
        `${c.id} RULE ${c.ruleKey} status=${c.status} measured=${num(c.measured)} limit=${num(c.limit)} margin=${num(c.margin)} unit=${c.unit ?? "-"} lap=${num(c.lap)} officialAction=${(c.officialAction ?? []).join(",") || "-"} verified=${c.verified ? "yes" : "no"} severityCeiling=${c.severityCeiling ?? "-"} subjects=${c.subjectFactIds.join(",")}`
      );
    }
  }
  return L.join("\n") + "\n";
}

/** Race-level context: metadata, classes, cautions, race-level rule checks, data notes. */
export function raceDigest(P: RaceAnalysisPackage): string {
  const M = P.metadata as any;
  const L: string[] = [];
  L.push(`# ${M.series ?? ""} ${M.event ?? ""} ${M.session ?? ""} · ${M.raceDate ?? ""} · results ${M.resultsStatus}`);
  L.push(`packageId=${P.packageId} engineVersion=${P.engineVersion} generatedAt=${P.generatedAt} rulebook=${P.rulebookVersion ?? "none"}`);
  L.push(`lexicon (words allowed with digits): ${(M.lexicon ?? []).join(" | ") || "-"}`);
  L.push("");
  L.push("## Classes");
  for (const c of M.classes) {
    const es = P.entries.filter((e) => e.class === c.id);
    const w = es.find((e) => e.result?.positionClass === 1);
    L.push(`{class:${c.id}} ${c.name}: ${es.length} cars, winner ${w ? `{car:${w.car}} (result:${w.car})` : "-"}`);
  }
  const ow = P.entries.find((e) => e.result?.positionOverall === 1);
  L.push(`overall winner: ${ow ? `{car:${ow.car}} result:${ow.car} class ${ow.class}` : "-"}`);
  L.push("");
  L.push("## Cautions");
  for (const f of P.fcyPeriods) L.push(`${f.id} type=${f.type} leaderLaps[0]=${f.leaderLaps[0]} leaderLaps[1]=${f.leaderLaps[1]} durationS=${secs(f.durationS)} endsAtFinish=${f.endsAtFinish}`);
  if (!P.fcyPeriods.length) L.push("none");
  L.push("");
  L.push("## Race-level rule checks (not pass)");
  const race = P.ruleChecks.filter((c) => c.car === null && c.status !== "pass" && c.status !== "not_applicable");
  for (const c of race) L.push(`${c.id} ${c.ruleKey} status=${c.status} measured=${num(c.measured)} limit=${num(c.limit)}`);
  if (!race.length) L.push("none");
  L.push("");
  L.push("## Data notes");
  for (const q of P.dataQuality) L.push(`${q.id} ${q.severity} ${q.code}: ${q.message}`);
  if (!P.dataQuality.length) L.push("none");
  return L.join("\n") + "\n";
}

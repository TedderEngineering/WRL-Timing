/**
 * Race Analysis Package validator, rules V1–V8 (FACT_ENGINE_SPEC.md §7). Port of
 * stage2/core/tools/check_package.py. V1 is JSON Schema draft 2020-12 via Ajv; later rules assume a
 * schema-valid shape and are skipped when V1 fails.
 */
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import schemaJson from "./schema/race-analysis-package.schema.json" with { type: "json" };
import type { Prose, RaceAnalysisPackage } from "./schema/package-types.js";

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  factCount: number;
  lapRows: number;
  swapRows: number;
}

// CJS/ESM interop for ajv and ajv-formats.
const Ajv2020: any = (Ajv2020Module as any).default ?? Ajv2020Module;
const addFormats: any = (addFormatsModule as any).default ?? addFormatsModule;

let compiled: any = null;
function schemaValidator(): any {
  if (!compiled) {
    const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allErrors: true, allowUnionTypes: true });
    addFormats(ajv);
    compiled = ajv.compile(schemaJson as object);
  }
  return compiled;
}

export const PACKAGE_SCHEMA = schemaJson;

const TOKEN = /\{(?:(\d+)|car:([0-9A-Za-z]+)|class:([A-Za-z0-9+_-]+)|driver:([0-9A-Za-z]+):(\d+))\}/g;

function decimals(v: number): number {
  const s = String(v);
  if (s.includes("e")) return 0;
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

function roundTo(x: number, n: number): number {
  const f = 10 ** n;
  return Math.round(x * f) / f;
}

export function validatePackage(pkgIn: unknown, opts: { publish: boolean } = { publish: false }): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const validate = schemaValidator();
  if (!validate(pkgIn)) {
    for (const e of (validate.errors ?? []).slice(0, 200)) errors.push(`V1 schema ${e.instancePath || "/"}: ${e.message}${e.params ? " " + JSON.stringify(e.params).slice(0, 120) : ""}`);
    return { ok: false, errors, warnings, factCount: 0, lapRows: 0, swapRows: 0 };
  }
  const P = pkgIn as RaceAnalysisPackage;
  const facts = new Map<string, any>();
  const add = (x: { id: string }) => {
    if (facts.has(x.id)) errors.push(`V2 duplicate id ${x.id}`);
    facts.set(x.id, x);
  };
  for (const e of P.entries) {
    add(e);
    if (e.result) add(e.result);
  }
  const ev = P.events;
  for (const k of ["pitPassages", "pitGroups", "penalties", "retirements", "flags"] as const) for (const x of ev[k]) add(x);
  for (const k of ["fcyPeriods", "stints", "driveTimes", "pitCycles", "cycleResults", "ruleChecks", "ruleFindings", "carStories", "dataQuality"] as const) {
    for (const x of P[k] as { id: string }[]) add(x);
  }
  if (P.raceSummary) add(P.raceSummary);
  const cars = new Set(P.entries.map((e) => e.car));
  const classes = new Set(P.metadata.classes.map((c) => c.id));

  // V2 id grammar and self-consistency
  const PREFIX = { pitPassages: "pit", pitGroups: "pitgroup", penalties: "pen", retirements: "ret", flags: "flag" } as const;
  for (const [k, pre] of Object.entries(PREFIX) as [keyof typeof PREFIX, string][]) {
    for (const x of ev[k]) if (!x.id.startsWith(pre + ":")) errors.push(`V2 ${k} id ${x.id} must start with ${pre}:`);
  }
  for (const x of ev.pitPassages) if (x.id !== `pit:${x.car}:${x.ordinal}`) errors.push(`V2 passage id ${x.id} != pit:<car>:<ordinal>`);
  for (const c of P.pitCycles) if (c.id !== `cycle:${c.class}:${c.ordinal}`) errors.push(`V2 cycle id ${c.id}`);
  for (const x of [...ev.pitPassages, ...P.stints, ...P.driveTimes, ...P.cycleResults, ...ev.penalties, ...ev.retirements] as { id: string; car: string }[]) {
    if (!cars.has(x.car)) errors.push(`V2 ${x.id} refers to unknown car ${x.car}`);
  }
  for (const e of P.entries) if (!classes.has(e.class)) errors.push(`V2 ${e.id} class ${e.class} is not in metadata.classes`);

  // V6 lap table
  const laps = P.laps.cars;
  let lapRows = 0;
  for (const [car, cols] of Object.entries(laps)) {
    const n = cols.lap.length;
    lapRows += n;
    for (const [col, arr] of Object.entries(cols)) if ((arr as unknown[]).length !== n) errors.push(`V6 laps ${car} column ${col} has ${(arr as unknown[]).length} rows, lap has ${n}`);
    for (let i = 1; i < n; i++) if (!(cols.lap[i] > cols.lap[i - 1])) errors.push(`V6 laps ${car} not strictly ascending at index ${i}`);
    if (!cars.has(car)) errors.push(`V6 laps for unknown car ${car}`);
  }
  const rows = P.positionChanges.rows;
  const swapIds = new Set<string>();
  for (let i = 0; i < rows.lap.length; i++) swapIds.add(`pass:${rows.winner[i]}:${rows.lap[i]}:${rows.loser[i]}`);
  const lapDownIds = new Set<string>();
  const ld = P.positionChanges.lapDowns;
  if (ld) for (let i = 0; i < ld.car.length; i++) lapDownIds.add(`lapdown:${ld.car[i]}:${ld.lap[i]}`);

  const resolve = (fid: string): { obj: any; ok: boolean } => {
    if (fid.startsWith("lap:")) {
      const [, car, L] = fid.split(":");
      const cols = laps[car];
      if (!cols) return { obj: null, ok: false };
      const i = cols.lap.indexOf(Number(L));
      return i < 0 ? { obj: null, ok: false } : { obj: { __lap: true, car, i }, ok: true };
    }
    if (fid.startsWith("pass:")) return { obj: null, ok: swapIds.has(fid) };
    if (fid.startsWith("lapdown:")) return { obj: null, ok: lapDownIds.has(fid) };
    return { obj: facts.get(fid), ok: facts.has(fid) };
  };
  const field = (obj: any, path: string): unknown => {
    if (obj && obj.__lap) return (laps[obj.car] as any)[path][obj.i];
    let cur = obj;
    for (const part of path.match(/[A-Za-z][A-Za-z0-9]*|\[[0-9]+\]/g) ?? []) {
      if (part === "length" && Array.isArray(cur)) cur = cur.length;
      else if (part.startsWith("[")) cur = cur[Number(part.slice(1, -1))];
      else cur = cur[part];
      if (cur === undefined) throw new Error("missing");
    }
    return cur;
  };

  // V3 cross references
  const need = (fid: string | null | undefined, where: string) => {
    if (fid === null || fid === undefined) return;
    if (!resolve(fid).ok) errors.push(`V3 ${where} -> unresolved ${fid}`);
  };
  for (const x of ev.pitPassages) {
    for (const f of [x.cycleId, x.groupId, ...x.penaltiesServed, ...(x.fcyPeriodIds ?? [])]) need(f, x.id);
    if (x.timeLost.groupId) need(x.timeLost.groupId, x.id);
    for (const cp of [...(x.positionEffect?.gainedOn ?? []), ...(x.positionEffect?.lostTo ?? [])]) if (cp.passId) need(cp.passId, x.id);
  }
  for (const g of ev.pitGroups) for (const f of g.passageIds) need(f, g.id);
  for (const p of ev.penalties) {
    need(p.servedByPassageId, p.id);
    if (p.convertedFromId) need(p.convertedFromId, p.id);
  }
  for (const r of ev.retirements) need(r.passageId, r.id);
  for (const f of P.fcyPeriods) for (const po of f.pitsOpen ?? []) need(po.flagId, f.id);
  for (const c of P.pitCycles) {
    for (const m of c.members) need(m.passageId, c.id);
    for (const f of [...(c.overlappingPassageIds ?? []), ...(c.fcyPeriodIds ?? [])]) need(f, c.id);
    if (c.stats.bestTimeLostPassageId) need(c.stats.bestTimeLostPassageId, c.id);
    if (c.stats.bestPitLanePassageId) need(c.stats.bestPitLanePassageId, c.id);
  }
  for (const r of P.cycleResults) {
    need(r.cycleId, r.id);
    need(r.passageId, r.id);
    for (const cp of [...r.gainedOn, ...r.lostTo]) if (cp.passId) need(cp.passId, r.id);
  }
  for (const s of P.stints) for (const f of s.penaltyPassageIds ?? []) need(f, s.id);
  for (const d of P.driveTimes) for (const f of d.stintIds) need(f, d.id);
  for (const rc of P.ruleChecks) for (const f of [...rc.subjectFactIds, ...(rc.officialAction ?? [])]) need(f, rc.id);
  for (const fd of P.ruleFindings) for (const f of fd.ruleCheckIds) need(f, fd.id);
  for (const st of P.carStories) for (const f of st.keyFactIds) need(f, st.id);
  for (const q of P.dataQuality) for (const f of q.factIds ?? []) need(f, q.id);

  // V4 prose numbers (+ V7 low-confidence judgements)
  const lex = [...P.metadata.lexicon].sort((a, b) => b.length - a.length);
  const lowCited: { where: string; fid: string }[] = [];
  const checkProse = (pr: Prose, where: string) => {
    const used = new Set<number>();
    for (const m of pr.text.matchAll(TOKEN)) {
      if (m[1] !== undefined) {
        const i = Number(m[1]);
        used.add(i);
        if (i >= pr.refs.length) errors.push(`V4 ${where} placeholder {${i}} has no ref`);
      } else if (m[2] && !cars.has(m[2])) errors.push(`V4 ${where} unknown car token ${m[2]}`);
      else if (m[3] && !classes.has(m[3])) errors.push(`V4 ${where} unknown class token ${m[3]}`);
    }
    pr.refs.forEach((_, i) => {
      if (!used.has(i)) errors.push(`V4 ${where} ref ${i} not used in text`);
    });
    let rest = pr.text.replace(TOKEN, "");
    for (const term of lex) rest = rest.split(term).join("");
    if (/[0-9]/.test(rest)) errors.push(`V4 ${where} bare digit in prose: ${JSON.stringify(rest)}`);
    pr.refs.forEach((r, i) => {
      const { obj, ok } = resolve(r.factId);
      if (!ok) {
        errors.push(`V4 ${where} ref ${i} unresolved ${r.factId}`);
        return;
      }
      let fv: unknown;
      try {
        fv = field(obj, r.field);
      } catch {
        errors.push(`V4 ${where} ref ${i} field ${r.field} missing on ${r.factId}`);
        return;
      }
      const v = r.value;
      if (typeof fv === "boolean" || fv === null) {
        errors.push(`V4 ${where} ref ${i} cites a non-numeric/null field ${r.factId}.${r.field}`);
        return;
      }
      if (typeof fv === "number") {
        if (typeof v !== "number") {
          errors.push(`V4 ${where} ref ${i} value ${JSON.stringify(v)} is not a number`);
          return;
        }
        const fvv = r.transform === "abs" ? Math.abs(fv) : r.transform === "neg" ? -fv : fv;
        const nd = decimals(v);
        if (Math.abs(roundTo(fvv, nd) - v) > 10 ** -nd * 0.5 + 1e-9) errors.push(`V4 ${where} ref ${i} value ${v} != fact ${r.factId}.${r.field} = ${fv}`);
        const disp = r.display;
        if (disp !== undefined && !new RegExp(`^P?${String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(disp) && !disp.includes(String(v))) {
          errors.push(`V4 ${where} ref ${i} display ${JSON.stringify(disp)} does not render ${v}`);
        }
      } else if (fv !== v) errors.push(`V4 ${where} ref ${i} value ${JSON.stringify(v)} != fact ${JSON.stringify(fv)}`);
      if (obj && !obj.__lap && obj.confidence === "low") lowCited.push({ where, fid: r.factId });
    });
  };
  for (const st of P.carStories) {
    checkProse(st.headline, `${st.id}.headline`);
    st.paragraphs.forEach((pr, k) => checkProse(pr, `${st.id}.p${k}`));
    const judged = new Set((st.lowConfidenceJudgements ?? []).map((j) => j.factId));
    for (const x of lowCited.filter((y) => y.where.startsWith(st.id))) if (!judged.has(x.fid)) errors.push(`V7 ${x.where} cites low-confidence ${x.fid} without a judgement`);
    for (const j of st.lowConfidenceJudgements ?? []) checkProse(j.judgement, `${st.id}.judgement:${j.factId}`);
  }
  for (const fd of P.ruleFindings) {
    const before = lowCited.length;
    checkProse(fd.statement, fd.id);
    if (fd.judgementOnLowConfidence) checkProse(fd.judgementOnLowConfidence, `${fd.id}.judgement`);
    const citedLow = fd.ruleCheckIds.some((f) => facts.get(f)?.confidence === "low");
    if ((citedLow || lowCited.length > before) && !fd.judgementOnLowConfidence) errors.push(`V7 ${fd.id} rests on low-confidence facts without a judgement`);
  }
  if (P.raceSummary) {
    checkProse(P.raceSummary.headline, "summary.headline");
    P.raceSummary.paragraphs.forEach((pr, k) => checkProse(pr, `summary.p${k}`));
    for (const cs of P.raceSummary.classSummaries ?? []) checkProse(cs.text, `summary.class:${cs.class}`);
  }

  // V5 coverage
  const storyCars = new Set(P.carStories.map((s) => s.car));
  const missing = [...cars].filter((c) => !storyCars.has(c));
  if (missing.length) (opts.publish ? errors : warnings).push(`V5 ${missing.length} of ${cars.size} cars have no story`);
  if (opts.publish && !P.raceSummary) errors.push("V5 raceSummary missing");
  if (opts.publish && P.dataQuality.some((q) => q.severity === "blocker")) errors.push("V5 blocker data-quality notes present");

  // V8 consistency
  for (const x of ev.pitPassages) {
    if (x.kind === "retirement" && x.outLap !== null) errors.push(`V8 ${x.id} retirement with an out-lap`);
    if ((x.kind === "stop" || x.kind === "garage") && x.stopNumber === null) errors.push(`V8 ${x.id} stop without stopNumber`);
    if (x.fcyContext !== "green" && x.timeLost.method === "green_reference") errors.push(`V8 ${x.id} FCY passage with green-referenced time lost`);
  }
  for (const r of P.cycleResults) {
    if (r.classPosBefore !== null && r.classPosAfter !== null && r.netClass !== r.classPosBefore - r.classPosAfter) errors.push(`V8 ${r.id} netClass inconsistent`);
  }
  for (const e of P.entries) {
    if (P.metadata.resultsStatus !== "none" && e.result && e.result.resultsStatus !== P.metadata.resultsStatus) errors.push(`V8 ${e.id} resultsStatus differs from metadata`);
  }
  return { ok: errors.length === 0, errors, warnings, factCount: facts.size, lapRows, swapRows: swapIds.size };
}

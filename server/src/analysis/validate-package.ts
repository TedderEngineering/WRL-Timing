/**
 * Race Analysis Package validator.
 *
 * Core rules V1–V8 (FACT_ENGINE_SPEC.md §7; port of stage2/core/tools/check_package.py) and analysis
 * rules A1–A23 (CLAUDE_ANALYSIS_DESIGN.md §6.2; port of stage2/claude/tools/check_analysis.py with
 * schema/prose-rules.json). V1 (JSON Schema 2020-12, Ajv) stops everything on failure.
 *
 * Rule-check contract (schema 1.1.0): the engine writes ruleChecks[] (passes included), ruleMarkers[] and
 * ruleCoverage; Claude writes ruleFindings[] from the checks. V2/V3/V8 check check ids, marker links, margins
 * and coverage counts; A21 (every stage) refuses a finding whose severity exceeds the severityCeiling of a
 * check it cites.
 *
 * Stages:
 *  - 'facts'    (engine draft): V1–V8; prose, if any, is checked for references and values.
 *  - 'analysis' (after the Claude pass, and always at publish): V1–V8 and A1–A23.
 *
 * Fact-reference values (schema 1.1.0): a number equals the fact exactly after `transform`; seconds are
 * cited at full millisecond precision, never rounded, and carry `display` = the GUI rendering
 * [h:]m:ss.sss (no trailing " s"). `lapdown:<car>:<lap>` and `pass:<w>:<lap>:<l>` rows resolve.
 */
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import schemaJson from "./schema/race-analysis-package.schema.json" with { type: "json" };
import proseRulesJson from "./schema/prose-rules.json" with { type: "json" };
import type { FactRef, FindingSeverity, Prose, RaceAnalysisPackage, StoryEvent } from "./schema/package-types.js";
import { buildStoryEvents } from "./engine/story-events.js";

export interface ValidateOptions {
  publish?: boolean;
  stage?: "facts" | "analysis";
  /** Facts-only package the analysis was written on (A1, A20, A2 judgement checks, event skeletons). */
  base?: RaceAnalysisPackage;
  /** Limit coverage rules A13, A14, A16 to one class (patches written class by class). */
  scopeClass?: string;
  /** Coverage gaps (A13, A16) become warnings. Examples only; never in the publish gate. */
  allowPartial?: boolean;
}

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
    // strictTypes is off: the schema's publish gate (allOf/if/then) uses untyped subschemas by design.
    const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allErrors: true, allowUnionTypes: true });
    addFormats(ajv);
    compiled = ajv.compile(schemaJson as object);
  }
  return compiled;
}

export const PACKAGE_SCHEMA = schemaJson;
const R: any = proseRulesJson;

/** GUI rendering of seconds: [h:]m:ss.sss, 3 decimals, never rounded beyond the millisecond, no unit. */
export function formatDuration(v: number): string {
  const sign = v < 0 ? "-" : "";
  const ms = Math.round(Math.abs(v) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = (ms % 60000) / 1000;
  const ss = s.toFixed(3).padStart(6, "0");
  return h ? `${sign}${h}:${String(m).padStart(2, "0")}:${ss}` : `${sign}${m}:${ss}`;
}

export function expectedDisplay(v: number | string, unit: string | undefined): string {
  if (typeof v === "string") return v;
  if (unit === "s") return formatDuration(v);
  if (unit === "pos") return `P${v}`;
  return String(v);
}

function decimals(v: number): number {
  const s = String(v);
  if (s.includes("e")) return 0;
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

const roundTo = (x: number, n: number) => Math.round(x * 10 ** n) / 10 ** n;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Python-style regex source (inline flags, lookbehind) → JS RegExp. */
function rx(src: string, flags = "i"): RegExp {
  return new RegExp(src, flags);
}

export function validatePackage(pkgIn: unknown, opts: ValidateOptions = {}): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (rule: string, msg: string) => errors.push(`${rule} ${msg}`);
  const warn = (rule: string, msg: string) => warnings.push(`${rule} ${msg}`);
  const stage = opts.publish ? "analysis" : opts.stage ?? "facts";
  const validate = schemaValidator();
  if (!validate(pkgIn)) {
    for (const e of (validate.errors ?? []).slice(0, 200)) err("V1", `schema ${e.instancePath || "/"}: ${e.message}${e.params ? " " + JSON.stringify(e.params).slice(0, 120) : ""}`);
    return { ok: false, errors, warnings, factCount: 0, lapRows: 0, swapRows: 0 };
  }
  const P = pkgIn as RaceAnalysisPackage;
  const M = P.metadata;
  const ev = P.events;

  /* ---------------------------------------------------------------- fact index (V2) */
  const facts = new Map<string, any>();
  const add = (x: { id: string }) => {
    if (facts.has(x.id)) err("V2", `duplicate id ${x.id}`);
    facts.set(x.id, x);
  };
  for (const e of P.entries) {
    add(e);
    if (e.result) add(e.result);
  }
  for (const k of ["pitPassages", "pitGroups", "penalties", "retirements", "flags"] as const) for (const x of ev[k]) add(x);
  for (const k of ["fcyPeriods", "stints", "driveTimes", "pitCycles", "cycleResults", "ruleChecks", "ruleFindings", "carStories", "dataQuality"] as const) {
    for (const x of P[k] as { id: string }[]) add(x);
  }
  for (const m of P.ruleMarkers ?? []) add(m);
  if (P.raceSummary) add(P.raceSummary);
  const cars = new Set(P.entries.map((e) => e.car));
  const entries = new Map(P.entries.map((e) => [e.car, e]));
  const classes = new Set(M.classes.map((c) => c.id));

  const PREFIX = { pitPassages: "pit", pitGroups: "pitgroup", penalties: "pen", retirements: "ret", flags: "flag" } as const;
  for (const [k, pre] of Object.entries(PREFIX) as [keyof typeof PREFIX, string][]) {
    for (const x of ev[k]) if (!x.id.startsWith(pre + ":")) err("V2", `${k} id ${x.id} must start with ${pre}:`);
  }
  for (const x of ev.pitPassages) if (x.id !== `pit:${x.car}:${x.ordinal}`) err("V2", `passage id ${x.id} != pit:<car>:<ordinal>`);
  for (const c of P.pitCycles) if (c.id !== `cycle:${c.class}:${c.ordinal}`) err("V2", `cycle id ${c.id}`);
  for (const x of [...ev.pitPassages, ...P.stints, ...P.driveTimes, ...P.cycleResults, ...ev.penalties, ...ev.retirements] as { id: string; car: string }[]) {
    if (!cars.has(x.car)) err("V2", `${x.id} refers to unknown car ${x.car}`);
  }
  for (const e of P.entries) if (!classes.has(e.class)) err("V2", `${e.id} class ${e.class} is not in metadata.classes`);
  for (const rc of P.ruleChecks) {
    if (rc.car !== null && !cars.has(rc.car)) err("V2", `${rc.id} refers to unknown car ${rc.car}`);
    if (!rc.id.startsWith(`rule:${rc.ruleKey}:${rc.car ?? "_race"}:`)) err("V2", `${rc.id} must be rule:${rc.ruleKey}:${rc.car ?? "_race"}:<n>`);
  }
  for (const m of P.ruleMarkers ?? []) {
    if (!cars.has(m.car)) err("V2", `${m.id} refers to unknown car ${m.car}`);
    if (!m.id.startsWith(`marker:${m.car}:`)) err("V2", `${m.id} must be marker:${m.car}:<n>`);
  }

  /* ---------------------------------------------------------------- V6 lap table, row facts */
  const laps = P.laps.cars;
  let lapRows = 0;
  for (const [car, cols] of Object.entries(laps)) {
    const n = cols.lap.length;
    lapRows += n;
    for (const [col, arr] of Object.entries(cols)) if ((arr as unknown[]).length !== n) err("V6", `laps ${car} column ${col} has ${(arr as unknown[]).length} rows, lap has ${n}`);
    for (let i = 1; i < n; i++) if (!(cols.lap[i] > cols.lap[i - 1])) err("V6", `laps ${car} not strictly ascending at index ${i}`);
    if (!cars.has(car)) err("V6", `laps for unknown car ${car}`);
  }
  const rowFacts = new Map<string, any>();
  const pr = P.positionChanges.rows;
  for (let i = 0; i < pr.lap.length; i++) rowFacts.set(`pass:${pr.winner[i]}:${pr.lap[i]}:${pr.loser[i]}`, { lap: pr.lap[i], winner: pr.winner[i], loser: pr.loser[i], mechanism: pr.mechanism[i], fcy: pr.fcy?.[i] });
  const ld = P.positionChanges.lapDowns;
  if (ld) for (let i = 0; i < ld.car.length; i++) rowFacts.set(`lapdown:${ld.car[i]}:${ld.lap[i]}`, { car: ld.car[i], lap: ld.lap[i], lapsDown: ld.lapsDown[i], cause: ld.cause[i] });
  const swapRows = pr.lap.length;

  const resolve = (fid: string): any | null => {
    if (fid.startsWith("lap:")) {
      const parts = fid.split(":");
      const cols = parts.length === 3 ? laps[parts[1]] : undefined;
      if (!cols) return null;
      const i = cols.lap.indexOf(Number(parts[2]));
      if (i < 0) return null;
      const row: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cols)) row[k] = (v as unknown[])[i];
      return row;
    }
    if (fid.startsWith("pass:") || fid.startsWith("lapdown:")) return rowFacts.get(fid) ?? null;
    return facts.has(fid) ? facts.get(fid) : null;
  };
  const field = (obj: any, path: string): unknown => {
    let cur = obj;
    for (const part of path.match(/[A-Za-z][A-Za-z0-9]*|\[[0-9]+\]/g) ?? []) {
      if (part === "length" && Array.isArray(cur)) cur = cur.length;
      else if (part.startsWith("[")) cur = cur[Number(part.slice(1, -1))];
      else cur = cur?.[part];
      if (cur === undefined) throw new Error("missing");
    }
    return cur;
  };

  /* ---------------------------------------------------------------- V3 cross references */
  const need = (fid: string | null | undefined, where: string, rule = "V3") => {
    if (fid === null || fid === undefined) return;
    if (resolve(fid) === null) err(rule, `${where} -> unresolved ${fid}`);
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
    need(c.stats.bestTimeLostPassageId, c.id);
    need(c.stats.bestPitLanePassageId, c.id);
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
  {
    const rcById = new Map(P.ruleChecks.map((r) => [r.id, r]));
    for (const m of P.ruleMarkers ?? []) {
      if (m.ruleCheckId === null) continue;
      const rc = rcById.get(m.ruleCheckId);
      if (!rc) err("V3", `${m.id} -> ruleCheckId ${m.ruleCheckId} is not a rule check`);
      else if (rc.car !== m.car || (m.ruleKey !== undefined && rc.ruleKey !== m.ruleKey)) err("V3", `${m.id} -> ${rc.id} is for another car or rule`);
    }
  }
  for (const st of P.carStories) {
    for (const f of st.keyFactIds) need(f, st.id);
    for (const e of st.events ?? []) for (const f of e.evidence) need(f, `${st.id}.${e.id}`);
  }
  for (const q of P.dataQuality) for (const f of q.factIds ?? []) need(f, q.id);

  /* ---------------------------------------------------------------- prose engine (V4, A3–A11) */
  const lex = [...M.lexicon].sort((a, b) => b.length - a.length);
  const lexRe = lex.map((t) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(t)}(?![A-Za-z0-9])`, "g"));
  const TOKEN = new RegExp(R.tokenRegex, "g");
  const strip = (text: string) => {
    let t = text.replace(TOKEN, " X ");
    for (const r of lexRe) t = t.replace(r, " Name ");
    return t;
  };
  const sentences = (text: string) => strip(text).trim().split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const words = (text: string) => strip(text).split(/\s+/).filter(Boolean).length;
  const unitFor = (f: string): string | null => {
    for (const [u, spec] of Object.entries(R.units as Record<string, { fields: string }>)) if (new RegExp(spec.fields).test(f)) return u;
    return null;
  };
  const analysis = stage === "analysis";
  const lowCited: { where: string; fid: string }[] = [];

  const checkRef = (r: FactRef, i: number, where: string, sentence: string) => {
    const obj = resolve(r.factId);
    if (obj === null) {
      err(analysis ? "A3" : "V4", `${where} ref ${i} unresolved ${r.factId}`);
      return;
    }
    let fv: unknown;
    try {
      fv = field(obj, r.field);
    } catch {
      err(analysis ? "A3" : "V4", `${where} ref ${i} field ${r.field} missing on ${r.factId}`);
      return;
    }
    const unit = r.unit;
    const expUnit = unitFor(r.field);
    if (analysis) {
      if (!unit) err("A5", `${where} ref ${i} has no unit`);
      else if (unit === "pct" || unit === "km/h") err("A5", `${where} ref ${i} unit ${unit} is not shown in v1`);
      else if (expUnit && unit !== expUnit) err("A5", `${where} ref ${i} unit ${unit} does not match field ${r.field} (expected ${expUnit})`);
    }
    const v = r.value;
    if (fv === null || typeof fv === "boolean") {
      err(analysis ? "A4" : "V4", `${where} ref ${i} cites a null or boolean field ${r.factId}.${r.field}`);
      return;
    }
    const secs = unit === "s" || (!unit && expUnit === "s");
    if (typeof fv === "number") {
      if (typeof v !== "number") {
        err(analysis ? "A4" : "V4", `${where} ref ${i} value ${JSON.stringify(v)} is not numeric`);
        return;
      }
      const fvv = r.transform === "abs" ? Math.abs(fv) : r.transform === "neg" ? -fv : fv;
      // A signed difference cited as a size: the word after it must give the right direction.
      if (analysis && r.transform === "abs" && fv !== 0 && /deltaToCycleMeanS$/.test(r.field)) {
        const w = sentence.match(new RegExp(`\\{${i}\\}\\s+(?:\\S+\\s+)?(more|less|slower|quicker|faster)\\b`, "i"))?.[1]?.toLowerCase();
        const says = w === "more" || w === "slower" ? 1 : w ? -1 : 0;
        if (says && says !== Math.sign(fv)) err("A23", `${where} ref ${i} says "${w}" but ${r.factId}.${r.field} is ${fv}`);
      }
      if (secs) {
        // Seconds: full millisecond precision, never rounded (coordinator decision 4; design F1).
        if (roundTo(v, 3) !== v || Math.abs(v - roundTo(fvv, 3)) > 0.0005 + 1e-9) err(analysis ? "A4" : "V4", `${where} ref ${i} value ${v} != fact ${r.factId}.${r.field} = ${fv} (seconds are cited at full ms precision)`);
        const want = formatDuration(v);
        if (r.display === undefined) err(analysis ? "A6" : "V4", `${where} ref ${i} needs display "${want}" (GUI m:ss.sss)`);
        else if (r.display !== want) err(analysis ? "A6" : "V4", `${where} ref ${i} display ${JSON.stringify(r.display)} should be ${JSON.stringify(want)}`);
      } else if (analysis) {
        if (v !== fvv) err("A4", `${where} ref ${i} value ${v} != fact ${r.factId}.${r.field} = ${fv}`);
        if (r.display !== undefined && r.display !== expectedDisplay(v, unit)) err("A6", `${where} ref ${i} display ${JSON.stringify(r.display)} should be ${JSON.stringify(expectedDisplay(v, unit))}`);
      } else {
        const nd = decimals(v);
        if (Math.abs(roundTo(fvv, nd) - v) > 10 ** -nd * 0.5 + 1e-9) err("V4", `${where} ref ${i} value ${v} != fact ${r.factId}.${r.field} = ${fv}`);
        if (r.display !== undefined && !new RegExp(`^P?${escapeRe(String(v))}$`).test(r.display) && !r.display.includes(String(v))) err("V4", `${where} ref ${i} display ${JSON.stringify(r.display)} does not render ${v}`);
      }
    } else {
      if (r.transform) err(analysis ? "A4" : "V4", `${where} ref ${i} transform on a text field`);
      if (v !== fv) err(analysis ? "A4" : "V4", `${where} ref ${i} value ${JSON.stringify(v)} != fact ${JSON.stringify(fv)}`);
    }
    if (analysis) {
      for (const [scope, spec] of Object.entries(R.scopeWords as Record<string, { fields: string; sentenceMustMatch: string }>)) {
        if (new RegExp(spec.fields).test(r.field) && !rx(spec.sentenceMustMatch).test(sentence)) err("A11", `${where} ref ${i} (${r.field}) needs the word "${scope}" in its sentence`);
      }
    }
    if (obj && typeof obj === "object" && obj.confidence === "low") lowCited.push({ where, fid: r.factId });
  };

  const bannedHits = (text: string, kind: string): string[] => {
    const t = strip(text);
    const hits: string[] = [];
    for (const [cat, pats] of Object.entries(R.banned as Record<string, string[]>)) {
      for (const p of pats) {
        const m = t.match(rx(p));
        if (m) hits.push(`${cat}:"${m[0]}"`);
      }
    }
    for (const ex of Object.values(R.bannedExceptions as Record<string, { pattern: string; allowedIn: string[] }>)) {
      if (!ex.allowedIn.includes(kind)) {
        const m = t.match(rx(ex.pattern));
        if (m) hits.push(`terminology:"${m[0]}"`);
      }
    }
    return hits;
  };

  const checkProse = (p: Prose, where: string, kind: "story" | "finding" | "summary") => {
    const text = p.text;
    const used = new Set<number>();
    for (const m of text.matchAll(TOKEN)) {
      if (m[1] !== undefined) {
        used.add(Number(m[1]));
        if (Number(m[1]) >= p.refs.length) err(analysis ? "A3" : "V4", `${where} placeholder {${m[1]}} has no ref`);
      } else if (m[2] !== undefined && !cars.has(m[2])) err(analysis ? "A15" : "V4", `${where} unknown car token ${m[2]}`);
      else if (m[3] !== undefined && !classes.has(m[3])) err(analysis ? "A15" : "V4", `${where} unknown class token ${m[3]}`);
      else if (m[4] !== undefined) {
        const e = entries.get(m[4]);
        if (!e || !e.drivers.some((d) => d.number === Number(m[5]))) err(analysis ? "A15" : "V4", `${where} unknown driver token driver:${m[4]}:${m[5]}`);
      }
    }
    p.refs.forEach((_, i) => {
      if (!used.has(i)) err(analysis ? "A3" : "V4", `${where} ref ${i} is not used in the text`);
    });
    const rest = strip(text);
    if (new RegExp(R.bareDigitRegex).test(rest)) err(analysis ? "A7" : "V4", `${where} bare digit in prose: ${JSON.stringify(rest.trim().slice(0, 120))}`);
    if (analysis) {
      const nw = rest.match(rx(R.numberWordRegex));
      if (nw) err("A8", `${where} number word "${nw[0]}" (cite a fact instead)`);
      for (const [name, pat] of Object.entries(R.formatRegexes as Record<string, string>)) {
        const target = ["unit-after-time-placeholder", "P-before-position-placeholder", "hash-before-car-token"].includes(name) ? text : rest;
        const m = target.match(rx(pat));
        if (m) err("A9", `${where} format rule ${name}: "${m[0]}"`);
      }
      for (const h of bannedHits(text, kind)) err("A10", `${where} banned ${h}`);
    }
    const sentOf = new Map<number, string>();
    for (const s of text.split(/(?<=[.!?])\s+/)) for (const m of s.matchAll(/\{(\d+)\}/g)) sentOf.set(Number(m[1]), s);
    p.refs.forEach((r, i) => checkRef(r, i, where, sentOf.get(i) ?? ""));
  };

  const L = R.limits;
  const dur = M.scheduledDurationS ?? 0;
  const tier = dur && dur <= L.sprintMaxDurationS ? "sprint" : "endurance";
  const checkLen = (p: Prose, where: string, spec: { sentences?: number[]; words?: number; chars?: number }) => {
    const ns = sentences(p.text).length;
    const nw = words(p.text);
    if (spec.sentences && !(spec.sentences[0] <= ns && ns <= spec.sentences[1])) err("A17", `${where} has ${ns} sentences (allowed ${spec.sentences[0]}-${spec.sentences[1]})`);
    if (spec.words !== undefined && nw > spec.words) err("A17", `${where} has ${nw} words (max ${spec.words})`);
    if (spec.chars !== undefined && p.text.length > spec.chars) err("A17", `${where} has ${p.text.length} characters (max ${spec.chars})`);
    return nw;
  };
  const cites = (prs: Prose[], pred: (r: FactRef) => boolean) => prs.some((p) => p.refs.some(pred));
  const provisional = M.resultsStatus === "provisional";
  const POSF = /^(positionClass|positionOverall|prePenaltyPosition(Class|Overall))$/;
  const provisionalOk = (prs: Prose[]) =>
    !provisional || !cites(prs, (r) => r.factId.startsWith("result:") && POSF.test(r.field)) || prs.some((p) => /\bprovisional\b/i.test(strip(p.text)));
  const inScope = (car: string) => !opts.scopeClass || entries.get(car)?.class === opts.scopeClass;

  /* ---------------------------------------------------------------- stories */
  const engineEvents = opts.base ? buildStoryEvents(opts.base) : null;
  const storyByCar = new Map<string, true>();
  for (const st of P.carStories) {
    const car = st.car;
    const sid = st.id;
    if (analysis) {
      if (sid !== `story:${car}`) err("A13", `${sid} id must be story:${car}`);
      if (storyByCar.has(car)) err("A13", `second story for car ${car}`);
    }
    storyByCar.set(car, true);
    if (!entries.has(car)) {
      err(analysis ? "A13" : "V2", `${sid} is for unknown car ${car}`);
      continue;
    }
    const e = entries.get(car)!;
    const res = e.result;
    const prs = [st.headline, ...st.paragraphs];
    checkProse(st.headline, `${sid}.headline`, "story");
    st.paragraphs.forEach((p, k) => checkProse(p, `${sid}.p${k}`, "story"));
    for (const j of st.lowConfidenceJudgements ?? []) {
      checkProse(j.judgement, `${sid}.judgement[${j.factId}]`, "story");
      if (resolve(j.factId) === null) err(analysis ? "A3" : "V3", `${sid} judgement on unknown fact ${j.factId}`);
      if (analysis) checkLen(j.judgement, `${sid}.judgement[${j.factId}]`, L["story.judgement"]);
    }
    for (const evn of st.events ?? []) {
      if (evn.title) checkProse(evn.title, `${sid}.${evn.id}.title`, "story");
      if (evn.text) checkProse(evn.text, `${sid}.${evn.id}.text`, "story");
    }
    if (engineEvents && st.events) {
      const skel = (x: StoryEvent) => {
        const { title: _t, text: _x, ...rest } = x;
        void _t;
        void _x;
        return rest;
      };
      if (JSON.stringify(st.events.map(skel)) !== JSON.stringify((engineEvents[car] ?? []).map(skel))) err("A1", `${sid}.events skeleton differs from the engine's (buildStoryEvents); only title and text may be written`);
    }
    if (analysis) {
      if (!st.headline.text.includes(`{car:${car}}`)) err("A15", `${sid} headline must name {car:${car}}`);
      checkLen(st.headline, `${sid}.headline`, L["story.headline"]);
      let tot = words(st.headline.text);
      st.paragraphs.forEach((p, k) => (tot += checkLen(p, `${sid}.p${k}`, L["story.paragraph"])));
      const t = res?.status === "dns" ? "dns" : tier;
      const [lo, hi] = L["story.paragraphs.count"][t];
      if (!(lo <= st.paragraphs.length && st.paragraphs.length <= hi)) err("A17", `${sid} has ${st.paragraphs.length} paragraphs (allowed ${lo}-${hi} for ${t})`);
      if (tot > L["story.totalWords"][t]) err("A17", `${sid} has ${tot} words (max ${L["story.totalWords"][t]} for ${t})`);
      const kf = st.keyFactIds;
      if (!(L["story.keyFactIds"][0] <= kf.length && kf.length <= L["story.keyFactIds"][1])) err("A17", `${sid} has ${kf.length} keyFactIds`);
      for (const f of kf) if (resolve(f) === null) err("A3", `${sid} keyFactId ${f} unresolved`);
      const needIds = new Set<string>();
      if (res) needIds.add(res.id);
      for (const r of ev.retirements) if (r.car === car) needIds.add(r.id);
      for (const p of ev.penalties) if (p.car === car) needIds.add(p.id);
      for (const p of ev.pitPassages) if (p.car === car && p.kind !== "stop") needIds.add(p.id);
      const miss = [...needIds].filter((x) => !kf.includes(x)).sort();
      if (miss.length) err("A14", `${sid} keyFactIds must include ${miss.join(", ")}`);
      if (res && !cites(prs, (r) => r.factId === res.id)) err("A14", `${sid} never cites ${res.id}`);
      if (!provisionalOk(prs)) err("A12", `${sid} cites finishing positions but never says "provisional"`);
      // A car that retired may still be classified (SRO lists such cars as Classified): write both,
      // "retired after lap N" and "classified P in class", never that it finished.
      if (ev.retirements.some((r) => r.car === car) && prs.some((p) => /\bfinish(?:ed|es|ing)?\b/i.test(p.text))) err("A22", `${sid} car retired (ret:${car}): say it retired and how the results classify it, not that it finished`);
    }
    const judged = new Set((st.lowConfidenceJudgements ?? []).map((j) => j.factId));
    for (const x of lowCited.filter((y) => y.where.startsWith(sid + "."))) {
      if (!judged.has(x.fid)) err(analysis ? "A2" : "V7", `${x.where} cites low-confidence ${x.fid} without a judgement`);
    }
  }
  if (analysis) {
    const missing = [...cars].filter((c) => !storyByCar.has(c) && inScope(c));
    if (missing.length) (opts.allowPartial ? warn : err)("A13", `${missing.length} cars without a story: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? " …" : ""}`);
  } else {
    const missing = [...cars].filter((c) => !storyByCar.has(c));
    if (missing.length) warn("V5", `${missing.length} of ${cars.size} cars have no story`);
  }

  /* ---------------------------------------------------------------- rule findings (A16, V7) */
  const checks = new Map(P.ruleChecks.map((r) => [r.id, r]));
  const covered = new Map<string, string[]>();
  for (const fd of P.ruleFindings) {
    const fid = fd.id;
    const before = lowCited.length;
    checkProse(fd.statement, fid, "finding");
    if (analysis) checkLen(fd.statement, fid, L["finding.statement"]);
    if (fd.judgementOnLowConfidence) {
      checkProse(fd.judgementOnLowConfidence, `${fid}.judgement`, "finding");
      if (analysis) checkLen(fd.judgementOnLowConfidence, `${fid}.judgement`, L["finding.judgement"]);
    }
    const rcs = fd.ruleCheckIds.map((c) => checks.get(c));
    if (rcs.some((x) => !x)) {
      err(analysis ? "A3" : "V3", `${fid} cites an unknown rule check`);
      continue;
    }
    for (const c of fd.ruleCheckIds) covered.set(c, [...(covered.get(c) ?? []), fid]);
    const citedLow = rcs.some((r) => r!.confidence === "low") || lowCited.length > before;
    if (citedLow && !fd.judgementOnLowConfidence) err(analysis ? "A2" : "V7", `${fid} rests on low-confidence facts without judgementOnLowConfidence`);
    if (!analysis) continue;
    const sts = new Set(rcs.map((r) => r!.status));
    const acted = rcs.some((r) => (r!.officialAction ?? []).length > 0);
    let allowed: string[] = [];
    if (sts.size === 1 && sts.has("pass")) allowed = ["compliant"];
    else if (sts.has("fail")) allowed = acted ? ["penalised_consistent", "data_insufficient"] : ["possible_unpenalised", "data_insufficient"];
    else if (sts.has("unknown")) allowed = acted ? ["data_insufficient", "not_assessable", "penalised_consistent"] : ["data_insufficient", "not_assessable"];
    else if (sts.size === 1 && sts.has("not_applicable")) allowed = ["not_assessable"];
    if (allowed.length && !allowed.includes(fd.assessment)) err("A16", `${fid} assessment ${fd.assessment} does not fit rule-check status ${[...sts].sort().join(",")} (allowed ${allowed.join(", ")})`);
    if (fd.assessment === "possible_unpenalised" && !/\bpossibl[ey]\b/i.test(strip(fd.statement.text))) err("A16", `${fid} possible_unpenalised wording must say "possible"`);
    if (acted && !/\brace control\b/i.test(strip(fd.statement.text))) err("A16", `${fid} must attribute the official action to race control`);
    if (fd.car && rcs.some((r) => r!.car !== fd.car)) err("A16", `${fid} car differs from its rule checks`);
  }
  if (analysis) {
    for (const [cid, r] of checks) {
      if (r.status === "pass" || r.status === "not_applicable" || (r.car === null ? !!opts.scopeClass : !inScope(r.car))) continue;
      const cov = covered.get(cid);
      if (!cov) (opts.allowPartial ? warn : err)("A16", `rule check ${cid} (${r.status}) has no finding`);
      else if (cov.length > 1) err("A16", `rule check ${cid} is covered by ${cov.length} findings`);
    }
  }

  /* ---------------------------------------------------------------- A21 severity ceiling (every stage) */
  const SEV_RANK: Record<FindingSeverity, number> = { info: 0, possible: 1, likely: 2 };
  for (const fd of P.ruleFindings) {
    for (const cid of fd.ruleCheckIds) {
      const ceil = checks.get(cid)?.severityCeiling;
      if (ceil && SEV_RANK[fd.severity] > SEV_RANK[ceil]) err("A21", `${fd.id} severity ${fd.severity} exceeds the severityCeiling ${ceil} of ${cid}`);
    }
  }

  /* ---------------------------------------------------------------- race summary, key moments (A12, A17–A19) */
  const S = P.raceSummary;
  if (!S) {
    if (analysis && !opts.scopeClass) err("A19", "raceSummary is missing");
  } else {
    checkProse(S.headline, "summary.headline", "summary");
    S.paragraphs.forEach((p, k) => checkProse(p, `summary.p${k}`, "summary"));
    for (const cs of S.classSummaries ?? []) checkProse(cs.text, `summary.class[${cs.class}]`, "summary");
    if (analysis) {
      checkLen(S.headline, "summary.headline", L["summary.headline"]);
      const [lo, hi] = L["summary.paragraphs.count"];
      if (!(lo <= S.paragraphs.length && S.paragraphs.length <= hi)) err("A17", `summary has ${S.paragraphs.length} paragraphs (allowed ${lo}-${hi})`);
      const ns = S.paragraphs.reduce((a, p) => a + sentences(p.text).length, 0);
      const nw = S.paragraphs.reduce((a, p) => a + words(p.text), 0);
      if (!(L["summary.paragraphs.sentences"][0] <= ns && ns <= L["summary.paragraphs.sentences"][1])) err("A17", `summary paragraphs have ${ns} sentences (allowed ${L["summary.paragraphs.sentences"].join("-")})`);
      if (nw > L["summary.paragraphs.words"]) err("A17", `summary paragraphs have ${nw} words (max ${L["summary.paragraphs.words"]})`);
      const prs = [S.headline, ...S.paragraphs];
      const ow = P.entries.find((e) => e.result?.positionOverall === 1)?.car;
      if (ow && !cites(prs, (r) => r.factId === `result:${ow}`)) err("A19", `summary headline/paragraphs never cite result:${ow} (overall winner)`);
      if (!provisionalOk([...prs, ...(S.classSummaries ?? []).map((c) => c.text)])) err("A12", `summary cites finishing positions but never says "provisional"`);
      const cs = new Map((S.classSummaries ?? []).map((c) => [c.class, c]));
      for (const cid of classes) {
        if (!P.entries.some((e) => e.class === cid)) continue;
        const c = cs.get(cid);
        if (!c) {
          err("A19", `classSummaries has no entry for class ${cid}`);
          continue;
        }
        checkLen(c.text, `summary.class[${cid}]`, L["summary.class"]);
        const cw = P.entries.find((e) => e.class === cid && e.result?.positionClass === 1)?.car;
        if (cw && !cites([c.text], (r) => r.factId === `result:${cw}`)) err("A19", `class summary ${cid} never cites result:${cw} (class winner)`);
      }
    }
    const km = S.keyMoments;
    if (km === undefined) {
      if (analysis) err("A18", "raceSummary.keyMoments is missing (schema 1.1.0)");
    } else {
      if (analysis) {
        const [lo, hi] = L["keyMoments.count"][tier];
        if (!(lo <= km.length && km.length <= hi)) err("A18", `${km.length} key moments (allowed ${lo}-${hi} for ${tier})`);
      }
      let prev = -1;
      km.forEach((k, n) => {
        const w = `moment:${n + 1}`;
        if (k.id !== w) err("A18", `${k.id} must have id ${w}`);
        for (const part of ["lap", "lapEnd"] as const) {
          const ref = k[part];
          if (!ref) continue;
          checkProse({ text: "{0}", refs: [ref] }, `${w}.${part}`, "summary");
          if (ref.unit !== "lap") err("A18", `${w}.${part} must have unit lap`);
        }
        const lv = typeof k.lap.value === "number" && Number.isInteger(k.lap.value) ? k.lap.value : -1;
        if (lv < prev) err("A18", `${w} is out of race order (lap ${lv} after ${prev})`);
        prev = Math.max(prev, lv);
        checkProse(k.title, `${w}.title`, "summary");
        checkProse(k.text, `${w}.text`, "summary");
        if (analysis) {
          const t = L["keyMoment.title"];
          if (words(k.title.text) > t.words || k.title.text.length > t.chars) err("A17", `${w} title too long`);
          if (t.noFinalStop && k.title.text.trimEnd().endsWith(".")) err("A17", `${w} title must not end with a full stop`);
          checkLen(k.text, `${w}.text`, L["keyMoment.text"]);
        }
        for (const c of k.cars) if (!cars.has(c)) err("A18", `${w} unknown car ${c}`);
        for (const f of k.factIds) if (resolve(f) === null) err(analysis ? "A3" : "V3", `${w} factId ${f} unresolved`);
      });
    }
  }

  /* ---------------------------------------------------------------- A1 / A20 / A2 against the facts base */
  if (analysis) {
    if (opts.base) {
      const B = opts.base as any;
      const PROSE = new Set(["carStories", "ruleFindings", "raceSummary", "analysis", "status"]);
      const RANK: Record<string, number> = { high: 2, medium: 1, low: 0 };
      const confChanges = new Map<string, [string | undefined, string | undefined, string[], string[]]>();
      const stripConf = (x: any, other: any): any => {
        if (Array.isArray(x)) return x.map((v, i) => stripConf(v, Array.isArray(other) ? other[i] : undefined));
        if (x && typeof x === "object") {
          const isFact = "id" in x && "confidence" in x;
          if (isFact && other && typeof other === "object") confChanges.set(x.id, [other.confidence, x.confidence, other.confidenceNotes ?? [], x.confidenceNotes ?? []]);
          const o: any = {};
          for (const k of Object.keys(x)) {
            if (isFact && (k === "confidence" || k === "confidenceNotes")) continue;
            o[k] = stripConf(x[k], other && typeof other === "object" ? other[k] : undefined);
          }
          return o;
        }
        return x;
      };
      const pick = (o: any) => {
        const out: any = {};
        for (const k of Object.keys(o)) if (!PROSE.has(k)) out[k] = o[k];
        out.completeness = Object.fromEntries(Object.entries(o.completeness).filter(([k]) => !["carStories", "ruleFindings", "raceSummary"].includes(k)));
        return out;
      };
      const pb = pick(B);
      const pp = pick(P);
      const sb = stripConf(pb, undefined);
      const sp = stripConf(pp, pb);
      const canon = (v: any): string => JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]])) : val));
      const diff = [...new Set([...Object.keys(sb), ...Object.keys(sp)])].filter((k) => canon(sb[k]) !== canon(sp[k]));
      if (diff.length) err("A1", `fact sections differ from the facts base: ${diff.sort().join(", ")}`);
      const judgedIds = new Set<string>();
      for (const st of P.carStories) for (const j of st.lowConfidenceJudgements ?? []) judgedIds.add(j.factId);
      for (const fd of P.ruleFindings) {
        if (!fd.judgementOnLowConfidence) continue;
        for (const c of fd.ruleCheckIds) judgedIds.add(c);
        for (const r of fd.judgementOnLowConfidence.refs) judgedIds.add(r.factId);
      }
      for (const [fid, [cb, cp, nb, np]] of confChanges) {
        if (cb === cp && JSON.stringify(nb) === JSON.stringify(np)) continue;
        if ((RANK[cp ?? ""] ?? 9) > (RANK[cb ?? ""] ?? -1)) err("A20", `${fid} confidence raised ${cb} -> ${cp}`);
        if (JSON.stringify(np.slice(0, nb.length)) !== JSON.stringify(nb)) err("A20", `${fid} existing confidenceNotes were changed`);
        for (const n of np.slice(nb.length)) if (!new RegExp(R.judgementNoteRegex).test(n)) err("A20", `${fid} added note ${JSON.stringify(n)} is not judgement_*`);
        if (!judgedIds.has(fid)) err("A2", `${fid} was annotated or downgraded without a written judgement`);
      }
    } else warn("A1", "no base given: fact immutability (A1, A20) not checked");
  }

  /* ---------------------------------------------------------------- V5 publish coverage */
  if (opts.publish) {
    if (!P.raceSummary) err("V5", "raceSummary missing");
    if (P.dataQuality.some((q) => q.severity === "blocker")) err("V5", "blocker data-quality notes present");
  }

  /* ---------------------------------------------------------------- V8 consistency */
  for (const x of ev.pitPassages) {
    if (x.kind === "retirement" && x.outLap !== null) err("V8", `${x.id} retirement with an out-lap`);
    if ((x.kind === "stop" || x.kind === "garage") && x.stopNumber === null) err("V8", `${x.id} stop without stopNumber`);
    if (x.fcyContext !== "green" && x.timeLost.method === "green_reference") err("V8", `${x.id} FCY passage with green-referenced time lost`);
  }
  for (const r of P.cycleResults) {
    if (r.classPosBefore !== null && r.classPosAfter !== null && r.netClass !== r.classPosBefore - r.classPosAfter) err("V8", `${r.id} netClass inconsistent`);
  }
  for (const e of P.entries) {
    if (M.resultsStatus !== "none" && e.result && e.result.resultsStatus !== M.resultsStatus) err("V8", `${e.id} resultsStatus differs from metadata`);
  }
  for (const rc of P.ruleChecks) {
    const m = rc.margin;
    if (m !== null && m !== undefined) {
      if (rc.status === "pass" && m < 0) err("V8", `${rc.id} passes with a negative margin ${m}`);
      if (rc.status === "fail" && m >= 0) err("V8", `${rc.id} fails with a non-negative margin ${m}`);
    }
    if (rc.measuredRange) {
      const [lo, hi] = rc.measuredRange;
      if (lo > hi) err("V8", `${rc.id} measuredRange lower ${lo} > upper ${hi}`);
      if (rc.measured !== null && rc.measured !== undefined && rc.measured !== lo) err("V8", `${rc.id} measured ${rc.measured} is not the measuredRange lower bound ${lo}`);
    }
    if ((rc.status === "pass" || rc.status === "not_applicable") && rc.severityCeiling && rc.severityCeiling !== "info") err("V8", `${rc.id} ${rc.status} with severityCeiling ${rc.severityCeiling} (must be info)`);
  }
  const cov = P.ruleCoverage;
  if (cov) {
    const perRule = new Map<string, number>();
    for (const rc of P.ruleChecks) perRule.set(rc.ruleKey, (perRule.get(rc.ruleKey) ?? 0) + 1);
    const ran = new Map<string, number>();
    for (const r of cov.run) ran.set(r.ruleId, (ran.get(r.ruleId) ?? 0) + r.checks);
    for (const [k, n] of perRule) if (ran.get(k) !== n) err("V8", `ruleCoverage.run counts ${ran.get(k) ?? 0} checks for ${k}, ruleChecks has ${n}`);
    for (const [k, n] of ran) if (n > 0 && !perRule.has(k)) err("V8", `ruleCoverage.run counts ${n} checks for ${k}, ruleChecks has none`);
    if (P.rulebook.sha256 && P.rulebook.sha256 !== cov.rulebookHash) err("V8", `ruleCoverage.rulebookHash differs from rulebook.sha256`);
  } else if (P.ruleChecks.some((rc) => rc.severityCeiling !== undefined) || (P.ruleMarkers ?? []).length) {
    warn("V8", "ruleChecks or ruleMarkers without ruleCoverage");
  }
  return { ok: errors.length === 0, errors, warnings, factCount: facts.size, lapRows, swapRows };
}

/**
 * Shared pieces of the rule checks: handler interface, severity capping, citations, race-control links.
 */
import type { CarId, Confidence, FactId } from "../package-types.js";
import type { ResolvedRule, Severity, TbdEntry } from "../rulebook-types.js";
import { getPath, SEVERITY_RANK } from "../load-rulebook.js";
import type {
  Citation,
  CitationLayer,
  EngineRuleFinding,
  EvidenceRef,
  NotCheckableReason,
  NotEvaluatedSubject,
  RaceControlLink,
} from "../types.js";
import type { RaceCtx } from "./context.js";

export type FindingDraft = Omit<
  EngineRuleFinding,
  | "id"
  | "ruleId"
  | "ruleType"
  | "title"
  | "citation"
  | "provenance"
  | "verified"
  | "seasonConfirmed"
  | "statement"
  | "class"
> & { class?: string | null };

export interface MarkerDraft {
  car: CarId;
  lap: number | null;
  raceTimeS: number;
}

export interface CheckInput {
  ctx: RaceCtx;
  rule: ResolvedRule;
  /** Every resolved rule for the same class group (handlers that depend on another rule read it here). */
  rules: Map<string, ResolvedRule>;
  /** Cars the rule applies to, in car order. */
  cars: CarId[];
  /** Rulebook class ids of this group. */
  classes: string[];
}

export interface CheckOutput {
  evaluated: number;
  passed: number;
  findings: FindingDraft[];
  notEvaluated: NotEvaluatedSubject[];
  notes: string[];
  markers?: MarkerDraft[];
}

export type NotCheckableOut = {
  notCheckable: { reason: NotCheckableReason; detail: string; tbd?: TbdEntry[] };
};

export interface CheckHandler {
  name: string;
  /** Param paths (under params) that must not be TBD; a function for "either / or" requirements. */
  required: (rule: ResolvedRule) => string[] | { anyOf: string[] };
  run: (input: CheckInput) => CheckOutput | NotCheckableOut;
}

export function emptyOutput(): CheckOutput {
  return { evaluated: 0, passed: 0, findings: [], notEvaluated: [], notes: [] };
}

export function isTbd(v: unknown): boolean {
  if (v === "TBD") return true;
  if (Array.isArray(v)) return v.some(isTbd);
  if (v && typeof v === "object") return Object.values(v).some(isTbd);
  return false;
}

export function param<T = unknown>(rule: ResolvedRule, path: string): T | undefined {
  return getPath(rule.params, path) as T | undefined;
}

export function num(rule: ResolvedRule, path: string): number | null {
  const v = param(rule, path);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A tolerance from the rulebook `defaults.tolerances` block (0 when absent or not numeric). */
export function tolerance(ctx: RaceCtx, key: string): number {
  const v = ctx.rulebook.defaults?.tolerances?.[key];
  return typeof v === "number" ? v : 0;
}

export function lower(sev: Severity): Severity {
  return sev === "likely" ? "possible" : "info";
}

export function minSev(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
export function minConf(...c: (Confidence | undefined | null)[]): Confidence {
  const v = c.filter((x): x is Confidence => !!x);
  if (!v.length) return "medium";
  return v.reduce((a, b) => (CONF_RANK[a] <= CONF_RANK[b] ? a : b));
}

/**
 * Final severity of a finding: never above the rule's resolved severity (overrides only lower it), and at most
 * `possible` when the rule is unverified or carried from another season, or the evidence is low confidence
 * (RULEBOOK_FORMAT.md R7, §8).
 */
export function capSeverity(
  rule: ResolvedRule,
  draft: FindingDraft
): { severity: Severity; notes: string[] } {
  const notes = [...draft.severityNotes];
  let sev = minSev(draft.severity, rule.severity);
  if (SEVERITY_RANK[draft.severity] > SEVERITY_RANK[rule.severity])
    notes.push("capped_at_rule_severity");
  const cap = (code: string) => {
    if (sev === "likely") {
      sev = "possible";
      notes.push(code);
    }
  };
  if (!rule.seasonConfirmed) cap("season_not_confirmed");
  if (!rule.verified) cap("rule_unverified");
  if (draft.confidence === "low") cap("low_confidence_fact");
  return { severity: sev, notes };
}

function citationFrom(
  ctx: RaceCtx,
  layer: ResolvedRule["provenance"][number],
  docs: Map<string, { title: string; version: string; date: string; obtained: string }>
): Citation {
  const src = layer.source[0];
  const d = docs.get(src?.doc ?? "");
  return {
    doc: src?.doc ?? "TBD",
    docTitle: d?.title ?? null,
    docVersion: d?.version ?? null,
    docDate: d?.date ?? null,
    docObtained: d?.obtained ?? null,
    section: src?.section ?? "TBD",
    page: src?.page ?? "TBD",
    quote: layer.quote,
    layer: layer.layer,
    ...(layer.eventKey ? { eventKey: layer.eventKey } : {}),
  };
}

/**
 * Citation of a resolved rule: the innermost layer that set a value the rule uses (an event override that sets
 * the number cites the event document), else the series layer.
 */
export function citations(
  ctx: RaceCtx,
  rule: ResolvedRule,
  docs: Map<string, { title: string; version: string; date: string; obtained: string }>
): { citation: Citation; provenance: CitationLayer[] } {
  const prov = rule.provenance.map((p) => ({
    ...citationFrom(ctx, p, docs),
    verified: p.verified,
    setsParams: p.setsParams,
  }));
  const setter = [...rule.provenance]
    .reverse()
    .find((p) => p.layer !== "series" && p.setsParams.length > 0);
  const main = setter ?? rule.provenance[0];
  return { citation: citationFrom(ctx, main, docs), provenance: prov };
}

/**
 * Race-control link: penalties for the same car whose reason matches the rule's matter, issued at or after
 * `fromS` (and before `toS`). With no race-control data in the race the status is `not_available`.
 */
export function raceControlFor(
  ctx: RaceCtx,
  car: CarId,
  reason: RegExp,
  fromS = -Infinity,
  toS = Infinity
): RaceControlLink {
  const hits = ctx
    .penaltiesOf(car)
    .filter(
      (p) => p.penaltyType !== "warning" && reason.test(`${p.reason} ${p.rawText ?? ""}`)
    )
    .filter((p) => {
      const t = p.issued?.raceTimeS;
      return t === undefined || t === null ? true : t >= fromS - 1e-6 && t <= toS;
    });
  if (hits.length) return { status: "penalised", penaltyIds: hits.map((p) => p.id) };
  return { status: ctx.hasRaceControl ? "none_found" : "not_available", penaltyIds: [] };
}

export function ev(label: string, ...ids: (FactId | null | undefined)[]): EvidenceRef[] {
  return ids.filter((x): x is FactId => !!x).map((factId) => ({ label, factId }));
}

/** Lower one severity step when the margin is inside the measurement tolerance (RULEBOOK_FORMAT.md §6.2). */
export function toleranceSeverity(
  base: Severity,
  overBy: number,
  tol: number
): { severity: Severity; notes: string[] } {
  if (overBy > tol + 1e-9) return { severity: base, notes: [] };
  return { severity: lower(base), notes: ["within_measurement_tolerance"] };
}

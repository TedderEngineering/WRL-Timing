/**
 * Rule-check outputs for the Race Analysis Package, schema 1.1 decisions of 12 Oct 2026:
 * - severity vocabulary `info | possible | likely`;
 * - the prose field is `statement`, written later by the Claude pass (null here: findings carry no prose);
 * - `ruleMarkers[]` holds `kind = earliest_legal_pit` per car, with lap and clock.
 *
 * These types extend the 1.0.0 package types (./package-types.ts) and move to the shared schema at merge.
 */
import type { CarId, ClassId, Confidence, FactId, IsoDateTime } from "./package-types.js";
import type { RuleType, Severity, TbdEntry } from "./rulebook-types.js";

export type { Severity };

export interface Citation {
  doc: string;
  docTitle: string | null;
  docVersion: string | null;
  docDate: string | null;
  /** obtained = yes / partial / no, from the rulebook's documents[]. */
  docObtained: string | null;
  section: string;
  page: number | string;
  /** Verbatim, <= 25 words (or "TBD"). */
  quote: string;
  /** Layer that set the value the check used. */
  layer: "series" | "class" | "event" | "event-class";
  eventKey?: string;
}

export interface CitationLayer extends Citation {
  verified: boolean;
  setsParams: string[];
}

/**
 * Race-control status of the subject of a finding.
 * - penalised: a penalty fact for the same car and matter exists (penaltyIds);
 * - served / converted_post_race / unserved: status of a penalty the finding is about (penalty_service);
 * - none_found: the race has race-control data and nothing matches;
 * - not_available: the timing format carries no race-control messages (WRL).
 */
export type RaceControlStatus =
  | "penalised"
  | "served"
  | "converted_post_race"
  | "unserved"
  | "none_found"
  | "not_available";

export interface RaceControlLink {
  status: RaceControlStatus;
  penaltyIds: FactId[];
}

export interface EvidenceRef {
  /** Short machine label of the role this fact plays, e.g. 'passage', 'fcy_period', 'pits_open'. */
  label: string;
  factId: FactId;
}

/** One rule finding as computed by the engine. Claude adds `statement` (and `assessment`) later. */
export interface EngineRuleFinding {
  /** 'finding:<n>', in rule order then car order. */
  id: FactId;
  ruleId: string;
  ruleType: RuleType;
  title: string;
  /** null for a race-level finding. */
  car: CarId | null;
  class: ClassId | null;
  severity: Severity;
  /** Machine codes for every step that lowered the severity below the rule's (e.g. 'rule_unverified'). */
  severityNotes: string[];
  lap: number | null;
  clock: IsoDateTime | null;
  raceTimeS: number | null;
  measured: number | string | null;
  /** [lower, upper] when the data only bounds the quantity (WRL lap-crossing bounds). */
  measuredRange: [number, number] | null;
  threshold: number | [number, number] | string | null;
  /** measured - threshold, signed so negative = short of a minimum / positive = over a maximum. */
  marginS: number | null;
  unit: "s" | "laps" | "lap" | "count" | "fraction" | "clock" | null;
  evidence: EvidenceRef[];
  citation: Citation;
  provenance: CitationLayer[];
  /** false until the owner has verified every layer of the rule. */
  verified: false | true;
  seasonConfirmed: boolean;
  raceControl: RaceControlLink;
  confidence: Confidence;
  /** Machine-readable notes (snake_case codes), never prose. */
  notes: string[];
  /** Written by the Claude pass. */
  statement: null;
}

export interface RuleMarker {
  car: CarId;
  kind: "earliest_legal_pit";
  lap: number | null;
  clock: IsoDateTime | null;
  raceTimeS: number;
  ruleId: string;
  /** The car's pit-window finding, when one exists. */
  findingId: FactId | null;
  citation: Citation;
}

export interface NotEvaluatedSubject {
  car: CarId | null;
  factId?: FactId;
  reason: string;
}

export interface CheckRun {
  ruleId: string;
  ruleType: RuleType;
  classes: ClassId[];
  /** Subjects (cars, passages, drivers, penalties) the check evaluated. */
  evaluated: number;
  passed: number;
  findings: number;
  notEvaluated: NotEvaluatedSubject[];
  verified: boolean;
  notes: string[];
}

export type NotCheckableReason =
  | "tbd_value"
  | "unsourced_value"
  | "format_not_checkable"
  | "data_missing"
  | "context_only"
  | "evaluated_by_other_rule"
  | "not_implemented"
  | "disabled"
  | "no_cars_in_scope";

export interface NotCheckable {
  ruleId: string;
  ruleType: RuleType;
  classes: ClassId[];
  reason: NotCheckableReason;
  /** Machine-readable detail, e.g. 'params.value_s' or 'no flags file'. */
  detail: string;
  /** Open questions whose answers would make the rule checkable. */
  tbd: TbdEntry[];
}

export interface RulebookApplied {
  id: string;
  status: string;
  eventKey: string | null;
  sessionKey: string | null;
  sha256: string;
  verifiedRuleCount: number;
  unverifiedRuleCount: number;
}

export interface RuleCheckResult {
  ruleFindings: EngineRuleFinding[];
  ruleMarkers: RuleMarker[];
  checksRun: CheckRun[];
  notCheckable: NotCheckable[];
  rulebook: RulebookApplied;
}

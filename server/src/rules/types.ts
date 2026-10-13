/**
 * Rule-check outputs (schema 1.1.0 rule-check contract, 13 Oct 2026):
 * - the engine writes `ruleChecks[]` only: one check per rule and subject (car, stop, stint, driver) evaluated,
 *   passes included, in the schema's `RuleCheck` shape (citation, verified, severityCeiling, severityNotes,
 *   officialAction = race-control linkage);
 * - `ruleMarkers[]` (kind = earliest_legal_pit per car) and `ruleCoverage` (rules run, rules not checkable);
 * - `ruleFindings[]` are written later by the Claude pass from the checks, never here.
 *
 * The package types live in ../analysis/schema/package-types.ts (mirror: shared/race-analysis-package/types.ts).
 */
import type {
  CarId,
  Confidence,
  FactId,
  IsoDateTime,
  RuleCheck,
  RuleCoverage,
  RuleMarker,
} from "../analysis/schema/package-types.js";
import type { Severity } from "./rulebook-types.js";

export type { NotCheckableReason } from "../analysis/schema/package-types.js";
export type { Severity };

export type CheckStatus = RuleCheck["status"];
export type CheckUnit = NonNullable<RuleCheck["unit"]>;

/** Citation of one rulebook layer (internal; the check carries the main one as `rulebookRef`). */
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
 * Race-control status of the subject of a check (written to the check's notes as `race_control_<status>`;
 * the penalty ids are the check's `officialAction`).
 * - penalised: a penalty fact for the same car and matter exists (penaltyIds);
 * - served / converted_post_race / unserved: status of a penalty the check is about (penalty_service);
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

/**
 * One subject evaluated by a check handler, before the runner adds the rule's citation, severity cap and id.
 * A draft without `status` is a non-pass outcome whose status the runner derives from its severity notes
 * (fail, or unknown / not_applicable when the notes say the measurement or the rule's application is in doubt).
 */
export interface SubjectDraft {
  /** null for a race-level subject. */
  car: CarId | null;
  status?: CheckStatus;
  /** Severity the outcome may claim before the rule cap (passes: info). */
  severity: Severity;
  /** Machine codes for every step that lowered the severity below the rule's. */
  severityNotes: string[];
  lap: number | null;
  clock: IsoDateTime | null;
  raceTimeS: number | null;
  measured: number | null;
  /** [lower, upper] when the data only bounds the quantity (WRL lap-crossing bounds). */
  measuredRange: [number, number] | null;
  limit: number | null;
  /** Signed distance to the limit: negative = violation (below a minimum, above a maximum, outside a window). */
  margin: number | null;
  unit: CheckUnit | null;
  evidence: EvidenceRef[];
  /** Race-control link; null for passes (not looked up). */
  raceControl: RaceControlLink | null;
  confidence: Confidence;
  /** Machine-readable notes (snake_case codes), never prose. */
  notes: string[];
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
  ruleChecks: RuleCheck[];
  ruleMarkers: RuleMarker[];
  ruleCoverage: RuleCoverage;
  rulebook: RulebookApplied;
}

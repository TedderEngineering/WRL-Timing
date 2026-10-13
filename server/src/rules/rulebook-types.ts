/**
 * Types for a RaceTrace rulebook file (stage2/rules/RULEBOOK_FORMAT.md, schema racetrace-rulebook/0.1)
 * and for a rule after layered resolution (series -> class -> event -> event-class).
 */

export type Severity = "info" | "possible" | "likely";

export type TimingFormatKey =
  | "alkamel_imsa"
  | "alkamel_sro"
  | "alkamel_grcup"
  | "speedhive"
  | "wrl_website"
  | "wrl_redmist";

export type RuleType =
  | "pit_window"
  | "mandatory_stops"
  | "min_pit_time"
  | "min_drive_time_per_driver"
  | "max_drive_time_per_driver"
  | "max_stint"
  | "driver_change"
  | "refuel_tyre"
  | "fcy_pit_procedure"
  | "wave_by"
  | "penalty_service"
  | "penalty_catalogue"
  | "classification"
  | "min_pace"
  | "advisory";

/** The literal "TBD" marks an unknown value (RULEBOOK_FORMAT.md R4). */
export const TBD = "TBD" as const;
export type Tbd = typeof TBD;

export interface RulebookDocument {
  id: string;
  title: string;
  version: string;
  date: string;
  issuer: string;
  url?: string;
  local_path?: string;
  retrieved?: string;
  obtained: "yes" | "no" | "partial";
  season_of_document?: number;
  notes?: string;
}

export interface SourceRef {
  doc: string;
  section: string;
  page: number | string;
  field?: string;
}

export interface TbdEntry {
  field: string;
  question: string;
}

export interface AppliesTo {
  classes?: "all" | string[];
  sessions?: string[];
  driver_count?: number;
  stop?: "mandatory" | "any" | "refuel";
}

export interface RuleDef {
  id: string;
  type: RuleType;
  title: string;
  applies_to?: AppliesTo;
  params: Record<string, unknown>;
  source: SourceRef | SourceRef[];
  quote: string;
  verified: boolean;
  verified_by?: string;
  verified_on?: string;
  checkable_with: Partial<Record<TimingFormatKey, string[]>>;
  check: string;
  severity: Severity;
  penalty?: { kind?: string; value_s?: number | Tbd; text?: string };
  timing_signature?: string;
  tbd?: TbdEntry[];
  season_confirmed?: boolean;
  notes?: string;
}

export interface OverrideDef {
  rule: string;
  type?: RuleType;
  title?: string;
  params?: Record<string, unknown>;
  applies_to?: AppliesTo;
  disabled?: boolean;
  severity?: Severity;
  source: SourceRef | SourceRef[];
  quote: string;
  verified: boolean;
  verified_by?: string;
  verified_on?: string;
  checkable_with?: Partial<Record<TimingFormatKey, string[]>>;
  check?: string;
  tbd?: TbdEntry[];
  notes?: string;
}

export interface EventSession {
  key: string;
  date: string;
  scheduled_start?: string;
  duration_s?: number | Tbd;
  laps?: number;
  notes?: string;
}

export interface EventDef {
  name: string;
  track: string;
  dates: [string, string];
  sessions: EventSession[];
  match?: { track?: string; date_range?: string[]; event_name_contains?: string };
  documents?: RulebookDocument[];
  overrides: OverrideDef[];
  class_overrides?: Record<string, OverrideDef[]>;
  notes?: string;
}

export interface Rulebook {
  schema: "racetrace-rulebook/0.1";
  id: string;
  series: { id: string; name: string; timing_formats: TimingFormatKey[] };
  season: number;
  status: "draft" | "owner_reviewed" | "approved";
  documents: RulebookDocument[];
  classes: { id: string; name?: string; aliases?: string[] }[];
  defaults?: { tolerances?: Record<string, unknown>; [k: string]: unknown };
  rules: RuleDef[];
  class_overrides?: Record<string, OverrideDef[]>;
  events?: Record<string, EventDef>;
  open_questions?: {
    id: string;
    question: string;
    blocks?: string[];
    who?: string;
    where_to_get_it?: string;
  }[];
}

/** One layer that contributed to a resolved rule, outermost first. */
export interface ProvenanceLayer {
  layer: "series" | "class" | "event" | "event-class";
  eventKey?: string;
  class?: string;
  /** Param paths this layer set (dotted, e.g. "params.value_s"); empty for the series layer means "all". */
  setsParams: string[];
  source: SourceRef[];
  quote: string;
  verified: boolean;
  /** The params object this layer contributed (series layer: the full params). */
  params: Record<string, unknown>;
  tbd: TbdEntry[];
}

/** A rule after layering for one class (RULEBOOK_FORMAT.md §5.1). */
export interface ResolvedRule {
  id: string;
  type: RuleType;
  title: string;
  appliesTo: AppliesTo;
  params: Record<string, unknown>;
  severity: Severity;
  checkableWith: Partial<Record<TimingFormatKey, string[]>>;
  check: string;
  disabled: boolean;
  /** Verified only if every layer is verified (§5.1). */
  verified: boolean;
  /** false when carried from an older season's document; findings then cap at "possible". */
  seasonConfirmed: boolean;
  provenance: ProvenanceLayer[];
  /** Every open TBD question of every layer, still relevant after resolution. */
  tbd: TbdEntry[];
  penalty?: RuleDef["penalty"];
  notes?: string;
}

/** The rule set for one race: rules resolved per rulebook class. */
export interface ResolvedRulebook {
  rulebook: Rulebook;
  eventKey: string | null;
  sessionKey: string | null;
  /** class id (rulebook id) -> rule id -> resolved rule */
  byClass: Map<string, Map<string, ResolvedRule>>;
  /** SHA-256 of the resolved rule set (canonical JSON), RULEBOOK_FORMAT.md §5.2 step 2. */
  hash: string;
  documents: Map<string, RulebookDocument>;
}

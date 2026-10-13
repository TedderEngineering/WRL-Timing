/**
 * RaceTrace Race Analysis Package, schema v1.0.0: TypeScript types.
 * Mirrors schema/race-analysis-package.schema.json (JSON Schema draft 2020-12), which is authoritative.
 * Definitions of every quantity: stage2/core/DEFINITIONS.md. Design notes: SCHEMA_NOTES.md.
 *
 * Conventions: seconds are numbers (ms precision); wall clock is ISO 8601 with offset; race dates are
 * 'YYYY-MM-DD'; car identity is always a string ('007' !== '7').
 */

// ─── primitives ────────────────────────────────────────────────────────────

/** Car number exactly as exported. Leading zeros are significant. Pattern ^[0-9A-Za-z]{1,8}$ */
export type CarId = string;
/** Class slug, matches metadata.classes[].id. */
export type ClassId = string;
/**
 * Stable human-readable fact id. Grammar (SCHEMA_NOTES.md §3):
 * car:007 · result:007 · lap:007:12 · pit:007:2 · pitgroup:11:1 · pen:77:1 · ret:72 · flag:4 · fcy:3 ·
 * stint:7:2 · drive:7:1 · cycle:Silver:1 · cycres:Silver:1:007 · pass:24:12:007 · lapdown:11:21 ·
 * rule:min-pit-lane-time:77:1 · finding:3 · story:7 · summary · dq:5
 */
export type FactId = string;
/** ISO 8601 date-time with explicit offset, e.g. '2026-10-10T10:01:39.998-04:00'. */
export type IsoDateTime = string;
/** Calendar date 'YYYY-MM-DD'. Never a timestamp. */
export type IsoDate = string;
export type Sha256 = string;
export type SemVer = string;
/** Seconds, millisecond precision. */
export type Seconds = number;
/** sourceFiles[].fileId, e.g. 'f1'. */
export type FileId = string;

export type Confidence = 'high' | 'medium' | 'low';
/** Machine-readable reason codes (FACT_ENGINE_SPEC.md §5), e.g. 'fcy_reconstructed_boundary'. */
export type ConfidenceNotes = string[];
export type SectionState = 'complete' | 'partial' | 'absent';

export interface Source {
  kind: 'official' | 'derived' | 'reconstructed' | 'inferred' | 'manual';
  files?: FileId[];
  /** e.g. 'f1:L119', 'f2:card:11:1' */
  refs?: string[];
  /** Definition id from DEFINITIONS.md, e.g. 'D-LOSS-GREEN'. */
  method?: string;
}

/** Common provenance block carried by every fact. */
export interface Provenance {
  source: Source;
  confidence: Confidence;
  confidenceNotes?: ConfidenceNotes;
}

export interface TimePoint {
  /** Seconds since metadata.timeOrigin. */
  raceTimeS: Seconds;
  /** Absent when the source has no time of day (WRL website export). */
  clock?: IsoDateTime;
}

// ─── prose ─────────────────────────────────────────────────────────────────

export type RefUnit = 's' | 'laps' | 'lap' | 'pos' | 'places' | 'count' | 'pct' | 'km/h' | 'text';

/** A number stated in prose and the fact it comes from. */
export interface FactRef {
  /** The value as written (numbers rounded to the shown precision). */
  value: number | string;
  factId: FactId;
  /** Dotted path in the fact ('timeLost.valueS', 'stats.nMembers'); for lap facts a laps column name. */
  field: string;
  unit?: RefUnit;
  /** Rendering, e.g. 'P3' or '1:50.554'. */
  display?: string;
  /** Prose may state |x| or -x. */
  transform?: 'abs' | 'neg';
}

/**
 * Text with placeholders: '{n}' = refs[n]; entity tokens '{car:007}', '{class:Silver}', '{driver:7:2}'.
 * After removing tokens and metadata.lexicon terms the text may contain no digit (validator V4).
 */
export interface Prose {
  text: string;
  refs: FactRef[];
}

// ─── package ───────────────────────────────────────────────────────────────

export interface RaceAnalysisPackage {
  schemaVersion: '1.0.0';
  packageId: string;
  status: 'draft' | 'review' | 'published';
  completeness: Completeness;
  engineVersion: SemVer;
  /** 'rulebook-file@version', or null when the series has no v1 rule checks (D2). */
  rulebookVersion: string | null;
  rulebook: RulebookRef;
  generatedAt: IsoDateTime;
  analysis?: AnalysisInfo;
  sourceFiles: SourceFile[];
  metadata: Metadata;
  entries: Entry[];
  laps: LapTable;
  fcyPeriods: FcyPeriod[];
  events: Events;
  stints: Stint[];
  driveTimes: DriveTime[];
  pitCycles: PitCycle[];
  cycleResults: CycleResult[];
  positionChanges: PositionChangeTable;
  ruleChecks: RuleCheck[];
  ruleFindings: RuleFinding[];
  carStories: CarStory[];
  raceSummary: RaceSummary | null;
  dataQuality: DataQualityNote[];
}

export interface Completeness {
  entries: SectionState;
  laps: SectionState;
  fcyPeriods: SectionState;
  events: SectionState;
  stints: SectionState;
  pitCycles: SectionState;
  cycleResults: SectionState;
  positionChanges: SectionState;
  ruleChecks: SectionState;
  ruleFindings: SectionState;
  carStories: SectionState;
  raceSummary: SectionState;
}

export interface AnalysisInfo {
  author?: 'claude' | 'engine' | 'owner';
  skill?: string;
  model?: string;
  completedAt?: IsoDateTime;
  reviewedBy?: string;
  reviewedAt?: IsoDateTime;
}

export interface RulebookRef {
  status: 'applied' | 'partial' | 'absent';
  fileId?: string;
  version?: string;
  sha256?: Sha256;
  eventOverrides?: string[];
  missingFields?: string[];
}

export type SourceFileRole =
  | 'laps' | 'time_cards' | 'summary' | 'results' | 'results_by_class' | 'pit_cards_json' | 'pit_cards_pdf'
  | 'drive_time' | 'flags' | 'control_log' | 'lap_chart' | 'weather' | 'other';

export interface SourceFile {
  fileId: FileId;
  role: SourceFileRole;
  name: string;
  sha256: Sha256;
  bytes: number;
  reportMark?: 'unofficial' | 'provisional' | 'official' | 'unknown';
  archive: { path: string; archivedAt: IsoDateTime };
}

// ─── metadata, entries ─────────────────────────────────────────────────────

export interface ClassDef {
  id: ClassId;
  name: string;
  order: number;
  /** D-REF-PACE class median clean green lap. */
  medianCleanGreenLapS?: Seconds | null;
}

export type SourceFormat = 'speedhive' | 'wrl-website' | 'alkamel-sro' | 'alkamel-grcup' | 'alkamel-imsa';
export type ResultsStatus = 'official' | 'provisional' | 'unofficial';

export interface Metadata {
  series: string;
  seriesId?: string;
  season: number;
  event: string;
  session: string;
  track: {
    id: string;
    name: string;
    layout?: string;
    lengthM?: number;
    /** D-TRANSIT; null when not configured. */
    pitLaneTransitS?: Seconds | null;
  };
  /** D-DATE local calendar date. */
  raceDate: IsoDate;
  /** IANA zone. */
  timezone: string;
  /** D-TIME origin of raceTimeS. */
  timeOrigin: IsoDateTime;
  timeOriginSource?: 'flags_green' | 'first_lap_start' | 'manual';
  scheduledDurationS?: Seconds | null;
  scheduledLaps?: number | null;
  chequeredFlag?: TimePoint | null;
  sourceFormat: SourceFormat;
  adapterVersion?: SemVer;
  resultsStatus: ResultsStatus | 'none';
  classes: ClassDef[];
  /** Proper names that may contain digits and may appear verbatim in prose. */
  lexicon: string[];
}

export interface Driver {
  number: number;
  name: string;
  shortName?: string;
  license?: string;
  country?: string;
}

export interface Result extends Provenance {
  /** 'result:<car>' */
  id: FactId;
  status: 'classified' | 'not_classified' | 'dnf' | 'dns' | 'dsq' | 'excluded';
  rawStatus?: string;
  positionOverall: number | null;
  positionClass: number | null;
  laps: number;
  totalTimeS?: Seconds | null;
  gapFirst?: string | null;
  bestLapS?: Seconds | null;
  bestLapNumber?: number | null;
  /** totalTimeS - elapsed at last crossing, when > 0 (D-FINISH / D-PENALTY). */
  postRacePenaltyS?: Seconds | null;
  prePenaltyPositionOverall?: number | null;
  prePenaltyPositionClass?: number | null;
  resultsStatus: ResultsStatus;
}

export interface Entry extends Provenance {
  /** 'car:<car>' */
  id: FactId;
  car: CarId;
  class: ClassId;
  team: string;
  /** Normalised make (D-MAKE): 'BMW', 'Ford', 'Toyota', 'McLaren', 'Mercedes-AMG', … or 'TBD'. */
  make: string;
  makeBasis: 'make_column' | 'results_json' | 'vehicle_alias' | 'entry_list' | 'none';
  /** Source value before normalisation. */
  makeRaw?: string | null;
  /** Full model string as published, or 'TBD'. */
  vehicle: string;
  drivers: Driver[];
  startPosition?: number | null;
  result: Result | null;
}

// ─── laps (columnar) ───────────────────────────────────────────────────────

/** 0 green, 1 partial, 2 full (D-FCY-LAP). */
export type FcyState = 0 | 1 | 2;
export type LineFlag = 'G' | 'Y' | 'R' | 'C' | 'S' | null;

/**
 * One car's laps as parallel arrays of equal length, ascending lap. Row i is fact 'lap:<car>:<lap[i]>'.
 */
export interface LapColumns {
  lap: number[];
  /** null when blank in the source (never 0.001). */
  lapTimeS: (number | null)[];
  /** raceTimeS of the crossing ending the lap. */
  endS: number[];
  /** Laps covered by the row (>1 when lap numbers were skipped). Omitted when all 1. */
  span?: number[];
  flag: LineFlag[];
  fcy: FcyState[];
  fcyFrac: number[];
  /** Bitmask: 1 in-lap, 2 out-lap, 4 interior lap of a passage. */
  pit: number[];
  /** Overall position at this crossing (lap-chart convention). */
  pos: number[];
  /** Class position at this crossing. */
  cpos: number[];
  /** Laps behind the class leader at this crossing. */
  lapsDown: number[];
  /** 1 = clean green lap (D-REF-PACE). */
  clean: (0 | 1)[];
  /** Driver slot number or null. */
  driver?: (number | null)[];
  speedKph?: (number | null)[];
  topSpeedKph?: (number | null)[];
}

export type LapColumnName = keyof LapColumns;

export interface LapTable {
  layout: 'columnar-per-car/1';
  columnSources: Partial<Record<LapColumnName, { source: Source; confidence: Confidence }>>;
  exceptions?: { car: CarId; lap: number; column: LapColumnName; confidence: Confidence; note: string }[];
  cars: Record<CarId, LapColumns>;
}

// ─── FCY ───────────────────────────────────────────────────────────────────

export interface FcyPeriod extends Provenance {
  /** 'fcy:<n>' */
  id: FactId;
  type: 'fcy' | 'safety_car' | 'code_60' | 'red';
  start: TimePoint;
  end: TimePoint;
  endsAtFinish: boolean;
  /** [first, last] overall-leader laps overlapping the period. */
  leaderLaps: [number, number];
  durationS: Seconds;
  pitsOpen?: { flagId: FactId; classes: string[] }[];
  reconstruction?: {
    lastGreenCrossingS?: number | null;
    firstFcyCrossingS?: number;
    lastFcyCrossingS?: number;
    firstGreenCrossingS?: number | null;
  };
}

// ─── events ────────────────────────────────────────────────────────────────

export interface Events {
  pitPassages: PitPassage[];
  /** Back-to-back passages sharing a lap; time lost reported once per group. */
  pitGroups: PitGroup[];
  penalties: Penalty[];
  retirements: Retirement[];
  flags: FlagEvent[];
}

export type PassageKind =
  | 'stop' | 'drive_through' | 'stop_and_go' | 'penalty_served' | 'garage' | 'retirement' | 'pit_lane_start';

export type KindBasis =
  | 'drive_time_pit_type' | 'rc_penalty_match' | 'rc_penalty_served' | 'transit_time' | 'duration_only'
  | 'loss_fraction_fallback' | 'garage_threshold' | 'no_later_lap' | 'pit_lane_start_time' | 'default_stop';

export type TimeLostMethod = 'green_reference' | 'fcy_neighbours' | 'fcy_lap_field' | 'see_group' | 'none';

export interface TimeLost {
  valueS: Seconds | null;
  method: TimeLostMethod;
  groupId?: FactId;
  nLaps?: number;
  lapSumS?: Seconds | null;
  refLapS?: Seconds | null;
  refLapCount?: number;
  refWindowLaps?: 5 | 10 | 15 | 20;
  anchorS?: Seconds | null;
  elapsedS?: Seconds | null;
  neighbourMedianS?: Seconds | null;
  neighbourCars?: CarId[];
  neighbourScope?: 'class' | 'all';
  neighbourWindowS?: 30 | 60;
  /** Audit only for FCY passages; never displayed as time lost. */
  greenReferenceValueS?: Seconds | null;
}

export type SwapCause = 'pit_cycle' | 'own_pit' | 'on_track' | 'rival_pit' | 'penalty' | 'retirement';

export interface Counterparty {
  car: CarId;
  /** From the subject car's perspective (D-CAUSE). */
  cause: SwapCause;
  /** 'pass:<winner>:<lap>:<loser>' of the last swap between the two inside the window. */
  passId?: FactId;
}

export interface PositionEffect {
  beforeLap: number | null;
  afterLap: number | null;
  classPosBefore: number | null;
  classPosAfter: number | null;
  netClass: number | null;
  lostTo?: Counterparty[];
  gainedOn?: Counterparty[];
}

export interface PitPassage extends Provenance {
  /** 'pit:<car>:<ordinal>' */
  id: FactId;
  car: CarId;
  ordinal: number;
  kind: PassageKind;
  kindBasis: KindBasis[];
  outcome: 'rejoined' | 'retired' | 'finished_in_pit_lane';
  /** null when the source has no pit-lane timestamps (WRL). */
  pitIn: TimePoint | null;
  pitOut: TimePoint | null;
  inLap: number;
  inLapCompleted: boolean;
  outLap: number | null;
  /** D-PITLANE; null when there is no official record. */
  officialPitLaneTimeS: Seconds | null;
  pitLaneTimeReliable?: boolean;
  fcyContext: 'green' | 'fcy' | 'mixed';
  fcyPeriodIds?: FactId[];
  timeLost: TimeLost;
  groupId?: FactId;
  /** 'Stop N' ordinal among stop/garage passages; null for other kinds. */
  stopNumber: number | null;
  cycleId: FactId | null;
  driverIn?: number | null;
  driverOut?: number | null;
  driverChange?: boolean | null;
  penaltiesServed: FactId[];
  lapDown?: boolean | null;
  /** For rejoined passages that are not cycle members. */
  positionEffect?: PositionEffect;
  notes?: string[];
}

export interface PitGroup extends Provenance {
  /** 'pitgroup:<car>:<n>' */
  id: FactId;
  car: CarId;
  passageIds: FactId[];
  laps: [number, number];
  timeLost: TimeLost;
  officialPitLaneTimeSumS?: Seconds | null;
}

export type PenaltyType =
  | 'warning' | 'drive_through' | 'stop_and_go' | 'stop_plus' | 'time_at_stop' | 'post_race_time'
  | 'position' | 'lap' | 'grid' | 'disqualification' | 'other';

export type PenaltyStatus =
  | 'issued' | 'served' | 'applied_post_race' | 'converted_post_race' | 'unserved' | 'rescinded' | 'warning_only';

export interface Penalty extends Provenance {
  /** 'pen:<car>:<n>' */
  id: FactId;
  car: CarId;
  issued?: TimePoint | null;
  issuedLeaderLap?: number | null;
  reason: string;
  penaltyType: PenaltyType;
  amountS?: Seconds | null;
  status: PenaltyStatus;
  servedByPassageId?: FactId | null;
  servedConfirmed?: TimePoint | null;
  appliedInResults?: boolean | null;
  resultsEffectS?: Seconds | null;
  convertedFromId?: FactId;
  rawText?: string;
}

export interface Retirement extends Provenance {
  /** 'ret:<car>' */
  id: FactId;
  car: CarId;
  lastCompletedLap: number;
  at?: TimePoint | null;
  where: 'pit_lane' | 'garage' | 'on_track' | 'did_not_start' | 'unknown';
  passageId?: FactId | null;
  classPosAtRetirement?: number | null;
}

export interface FlagEvent {
  /** 'flag:<n>' */
  id: FactId;
  type: 'green' | 'fcy' | 'safety_car' | 'red' | 'chequered' | 'pits_open' | 'pits_closed' | 'message';
  at: TimePoint;
  leaderLap?: number | null;
  /** pits_open scope; empty = all classes. */
  classes?: string[];
  message?: string;
  source: Source;
}

// ─── stints, drive time ────────────────────────────────────────────────────

export interface Stint extends Provenance {
  /** 'stint:<car>:<n>' */
  id: FactId;
  car: CarId;
  ordinal: number;
  driver: number | null;
  start: TimePoint;
  end: TimePoint;
  startReason: 'race_start' | 'pit_out' | 'pit_lane_start';
  endReason: 'pit_in' | 'chequered' | 'retired';
  startLap: number;
  endLap: number;
  laps: number;
  /** D-DRIVETIME */
  driveTimeS: Seconds;
  penaltyPassageIds?: FactId[];
  fcyTimeS?: Seconds | null;
}

export interface DriveTime extends Provenance {
  /** 'drive:<car>:<driverNumber>' */
  id: FactId;
  car: CarId;
  driver: number;
  driveTimeS: Seconds;
  officialDriveTimeS?: Seconds | null;
  stintIds: FactId[];
}

// ─── cycles ────────────────────────────────────────────────────────────────

export interface PitCycle extends Provenance {
  /** 'cycle:<class>:<n>' */
  id: FactId;
  class: ClassId;
  ordinal: number;
  model: 'rounds' | 'windows' | 'singleton';
  trigger: 'green' | 'fcy' | 'mixed';
  fcyPeriodIds?: FactId[];
  opens: TimePoint;
  closes: TimePoint;
  closeBasis: 'pit_out' | 'out_lap_end';
  splitRule?: {
    gapThresholdS?: Seconds | null;
    windowS?: Seconds | null;
    maxGapS?: Seconds | null;
    nearestSplitMarginPct?: number | null;
  };
  members: { car: CarId; passageId: FactId }[];
  overlappingPassageIds?: FactId[];
  stats: {
    nMembers: number;
    meanTimeLostS?: Seconds | null;
    medianTimeLostS?: Seconds | null;
    bestTimeLostS?: Seconds | null;
    bestTimeLostPassageId?: FactId | null;
    meanPitLaneS?: Seconds | null;
    bestPitLaneS?: Seconds | null;
    bestPitLanePassageId?: FactId | null;
  };
}

export interface CycleResult extends Provenance {
  /** 'cycres:<class>:<n>:<car>' */
  id: FactId;
  cycleId: FactId;
  car: CarId;
  passageId: FactId;
  beforeLap: number | null;
  afterLap: number | null;
  classPosBefore: number | null;
  classPosAfter: number | null;
  /** classPosBefore - classPosAfter; positive = gained. */
  netClass: number | null;
  /** Context only; always labelled 'overall' when shown. */
  overallPosBefore?: number | null;
  overallPosAfter?: number | null;
  netOverall?: number | null;
  gainedOn: Counterparty[];
  lostTo: Counterparty[];
  lapsDownBefore?: number | null;
  lapsDownAfter?: number | null;
  lapDown?: boolean | null;
  timeLostRank?: number | null;
  deltaToCycleMeanS?: Seconds | null;
}

// ─── position changes (columnar) ───────────────────────────────────────────

export type SwapMechanism = 'on_track' | 'both_pitted' | 'winner_pitted' | 'loser_pitted' | 'penalty' | 'retirement';

/** Row i is fact 'pass:<winner[i]>:<lap[i]>:<loser[i]>'. Same-class swaps only. */
export interface PositionChangeTable {
  layout: 'columnar/1';
  scope: 'class';
  rows: {
    lap: number[];
    winner: CarId[];
    loser: CarId[];
    mechanism: SwapMechanism[];
    fcy?: (0 | 1)[];
  };
  /** Row i is fact 'lapdown:<car[i]>:<lap[i]>'. */
  lapDowns?: {
    car: CarId[];
    lap: number[];
    lapsDown: number[];
    cause: ('pit' | 'on_track' | 'fcy_pit' | 'unknown')[];
  };
  source?: Source;
  confidence?: Confidence;
}

// ─── rules, prose ──────────────────────────────────────────────────────────

export interface RuleCheck extends Provenance {
  /** 'rule:<ruleKey>:<car>:<n>' */
  id: FactId;
  ruleKey: string;
  rulebookRef: { field: string; section: string; eventOverride?: string };
  car: CarId;
  subjectFactIds: FactId[];
  status: 'pass' | 'fail' | 'not_applicable' | 'unknown';
  measured?: number | null;
  limit?: number | null;
  unit?: 's' | 'laps' | 'count' | 'lap';
  /** measured - limit, signed so negative = violation. */
  margin?: number | null;
  officialAction?: FactId[];
}

export interface RuleFinding {
  /** 'finding:<n>' */
  id: FactId;
  ruleCheckIds: FactId[];
  car?: CarId;
  assessment: 'compliant' | 'penalised_consistent' | 'possible_unpenalised' | 'data_insufficient' | 'not_assessable';
  statement: Prose;
  /** Required when any cited fact is low confidence (validator V7). */
  judgementOnLowConfidence?: Prose;
}

export interface CarStory {
  /** 'story:<car>' */
  id: FactId;
  car: CarId;
  headline: Prose;
  paragraphs: Prose[];
  keyFactIds: FactId[];
  lowConfidenceJudgements?: { factId: FactId; judgement: Prose }[];
}

export interface RaceSummary {
  id: 'summary';
  headline: Prose;
  paragraphs: Prose[];
  classSummaries?: { class: ClassId; text: Prose }[];
}

export interface DataQualityNote {
  /** 'dq:<n>' */
  id: FactId;
  /** blocker prevents publishing (FACT_ENGINE_SPEC.md §6). */
  severity: 'blocker' | 'warning' | 'note';
  code: string;
  message: string;
  factIds?: FactId[];
  files?: FileId[];
}

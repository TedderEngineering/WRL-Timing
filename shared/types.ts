import type { RacePackageFields } from "./race-analysis-package/api";

// ─── User ─────────────────────────────────────────────────────────────────────

export type UserRole = "USER" | "ADMIN";

export interface UserPublic {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  emailVerified: boolean;
  onboardingDone: boolean;
  createdAt: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName?: string;
}

// ─── Subscription ─────────────────────────────────────────────────────────────

export type SubscriptionPlan = "FREE" | "PRO" | "TEAM";
export type SubscriptionStatus =
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "TRIALING"
  | "INCOMPLETE";

export interface SubscriptionInfo {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

// ─── Event ────────────────────────────────────────────────────────────────────

export interface EventSummary {
  id: string;
  name: string;
  series: string;
  sanctioningBody: string;
  track: string;
  date: string;
  season: string;
  raceCount: number;
  startDate: string;
  endDate: string;
  raceIds?: string[];
}

/** A race row on the Events page (GET /api/events/weekends). */
export interface WeekendRace {
  id: string;
  eventId: string | null;
  name: string;
  /** "Pilot Challenge", "GR Cup"…; null when the name and source don't say. */
  championship: string | null;
  /** "Race 1", "Saturday 8 Hour", "Fox Factory 120". */
  title: string;
  family: "IMSA" | "SRO" | "GR Cup" | "WRL" | "Other";
  /** YYYY-MM-DD */
  date: string;
  cars: number | null;
  laps: number | null;
  status: RaceStatus;
  resultsStatus: string | null;
  /** A published analysis package (stories) exists. */
  hasStory: boolean;
}

/** Every race at one track within a few days, whatever event rows they were filed under. */
export interface Weekend {
  key: string;
  track: string;
  title: string | null;
  startDate: string;
  endDate: string;
  season: string;
  families: WeekendRace["family"][];
  races: WeekendRace[];
}

export interface WeekendsResponse {
  weekends: Weekend[];
  /** Admins only: events with no race at all, to clean up. */
  emptyEvents: { id: string; name: string; track: string; date: string }[];
}

export interface EventRace {
  id: string;
  name: string;
  date: string;
  status: RaceStatus;
  series: string;
  subSeries: string | null;
  roundNumber: number | null;
  accessible?: boolean;
}

export interface EventQualifyingSession {
  id: string;
  name: string;
  sessionName: string;
  date: string;
  series: string;
}

export interface EventWithRaces extends EventSummary {
  races: EventRace[];
  qualifyingSessions?: EventQualifyingSession[];
}

export type SearchMatchedOn = "track" | "series" | "race" | "sub_series" | "name";

export interface SearchResult extends EventWithRaces {
  matchedOn: SearchMatchedOn;
}

// ─── Race ─────────────────────────────────────────────────────────────────────

export type RaceStatus = "DRAFT" | "PUBLISHED";

export interface RaceSummary {
  id: string;
  name: string;
  date: string;
  track: string;
  series: string;
  season: number;
  status: RaceStatus;
  premium: boolean;
  maxLap: number | null;
  totalCars: number | null;
  subSeries: string | null;
  roundNumber: number | null;
  entryCount?: number;
  favoriteCount?: number;
  isFavorited?: boolean;
  createdAt: string;
}

export interface RaceEntry {
  carNumber: string;
  teamName: string;
  carClass: string;
  finishPos: number | null;
  finishPosClass: number | null;
  lapsCompleted: number | null;
  driverNames?: string;
  carColor?: string | null;
}

export interface RaceDetail extends RaceSummary, Partial<RacePackageFields> {
  entries: RaceEntry[];
}

// ─── Chart Data (matches embedded JSON structure from source HTML) ────────────

export interface LapData {
  l: number;       // lap number
  p: number;       // overall position
  cp: number;      // class position
  lt: string;      // lap time "M:SS.mmm"
  ltSec: number;   // lap time in seconds
  flag: string;    // "GF" | "FCY"
  pit: number;     // 0 | 1
  spd?: number;    // speed mph
  hr?: number;     // S/F crossing clock time (seconds from midnight)
}

export interface CarData {
  num: number;
  /** The car number as published when it differs from String(num): "4A", "007" (server utils/carNumbers.ts). Show this, never num. */
  label?: string;
  team: string;
  /** Driver names as the source gives them (newer imports; IMSA also puts surnames in team). */
  drivers?: string[];
  cls: string;
  make?: string;
  vehicle?: string;
  status?: string;
  finishPos: number;
  finishPosClass: number;
  laps: LapData[];
}

export interface RaceChartData {
  maxLap: number;
  totalCars: number;
  greenPaceCutoff: number;
  cars: Record<string, CarData>;
  fcy: [number, number][];
  classGroups: Record<string, number[]>;
  classCarCounts: Record<string, number>;
  makeGroups?: Record<string, number[]>;
}

export interface PitTimingData {
  pitInTime: number | null;
  pitRoadTime: number | null;
  pitOutTime: number | null;
  isDriveThrough: boolean;
  /** Seconds; null when it can't be measured (the analysis package says so). */
  totalPitLoss: number | null;
  inLapTime: number | null;
  outLapTime: number | null;
  /** The green-flag lap the loss is measured against; null under a caution. */
  avgGreenLapTime: number | null;
  /** From the analysis package: when the stop happened. Under a caution, time lost is against cars on track. */
  context?: "green" | "fcy" | "mixed";
  /** From the analysis package: how time lost was measured (D-LOSS). */
  lossMethod?: "green_reference" | "fcy_neighbours" | "fcy_lap_field" | "see_group" | "none";
  /** "facts" when the race's analysis package supplied this stop. */
  source?: "facts";
  splitReliable: boolean;
  decompositionLevel: "total_only" | "full_segments";
  spcAnalysis?: {
    totalLoss: SPCClassificationData;
    pitIn?: SPCClassificationData;
    pitRoad?: SPCClassificationData;
    pitOut?: SPCClassificationData;
  };
  cycleComparison?: {
    cycleId: number;
    compAvgPitInTime: number | null;
    compAvgPitRoadTime: number | null;
    compAvgPitOutTime: number | null;
    compAvgTotalPitLoss: number;
    deltaPitIn: number | null;
    deltaPitRoad: number | null;
    deltaPitOut: number | null;
    deltaTotalLoss: number;
    compCarCount: number;
  };
}

export interface SPCClassificationData {
  value: number;
  teamMean: number;
  teamStdDev: number;
  zScore: number;
  classification: "normal" | "warning" | "outlier";
  direction: "fast" | "slow";
  confidence: "provisional" | "established";
}

export interface PitMarker {
  l: number;
  lb: string;
  c: string;
  yo: number;
  da: number;
  outDriver?: string;
  inDriver?: string;
  driverChanged?: boolean;
  stintNumber?: number;
  pitTiming?: PitTimingData;
  strategyType?: "undercut" | "overcut" | "cover" | "scheduled";
  alsoPittingCars?: number[];
  isGarage?: boolean;
  /** From the analysis package: what the car did in the pit lane. */
  kind?: "stop" | "drive_through" | "stop_and_go" | "penalty_served" | "garage" | "retirement";
  /** From the analysis package: the class pit cycle this stop belongs to (alsoPittingCars = its other members). */
  cycle?: { id: string; ordinal: number; cls: string };
}

export interface SettleMarker {
  l: number;
  p: number;
  lb: string;
  su: string;
  c: string;
  /** From the analysis package: class position before the stop and when its pit cycle closed. */
  cpBefore?: number;
  cpAfter?: number;
  cycle?: string;
  /** The in-lap of the stop this cycle result belongs to. */
  stopLap?: number | null;
}

export interface CarAnnotations {
  reasons: Record<string, string>;
  pits: PitMarker[];
  settles: SettleMarker[];
}

export type AnnotationData = Record<string, CarAnnotations>;

/** Response from GET /api/races/:id/chart-data */
export interface ChartDataResponse {
  race: {
    id: string;
    name: string;
    date: string;
    track: string;
    series: string;
    season: number;
    eventId?: string;
  };
  data: RaceChartData;
  annotations: AnnotationData;
  /** Set when the pit facts come from the race's analysis package (server packages/pit-facts.ts). */
  pitFacts?: { version: number; status: "published" | "draft" | "superseded" | "rejected"; engineVersion: string; matched: number } | null;
}

// ─── Qualifying Session Data ─────────────────────────────────────────────────

/** One lap attempt in a qualifying session */
export interface QualifyingLap {
  l: number;           // lap number
  lt: string;          // formatted lap time "M:SS.mmm"
  ltSec: number;       // lap time in seconds
  s1: number;          // S1 seconds
  s2: number;          // S2 seconds
  s3: number;          // S3 seconds
  s1f: string;         // formatted S1 "M:SS.mmm"
  s2f: string;         // formatted S2
  s3f: string;         // formatted S3
  s1imp: number;       // 0/1/2 improvement flag
  s2imp: number;
  s3imp: number;
  flag: string;        // "GF" | "FCY" | "SC" | "FF"
  pit: boolean;        // true if CROSSING_FINISH_LINE_IN_PIT
  kph?: number;
  lapImp: number;      // 0/1/2 lap improvement flag
}

/** One car's entry in a qualifying session */
export interface QualifyingCar {
  num: string;         // car number as string
  team: string;
  driver: string;
  cls: string;         // class
  mfr: string;         // manufacturer
  laps: QualifyingLap[];
  bestLap: number;           // best ltSec across all laps
  bestLapNum: number;        // lap number of best lap
  theoreticalBest: number;   // min(s1) + min(s2) + min(s3)
  bestS1: number;
  bestS2: number;
  bestS3: number;
}

/** Top-level qualifying session data blob */
export interface QualifyingChartData {
  sessionName: string;
  track: string;
  series: string;
  date: string;
  cars: QualifyingCar[];
  classes: string[];          // sorted unique class list
  totalLaps: number;          // total lap rows parsed
}

// ─── Race Admin ──────────────────────────────────────────────────────────────

export interface RaceAdminSummary extends RaceSummary {
  lapCount?: number;
  createdBy: string;
  updatedAt: string;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: Array<{ field: string; message: string }>;
}

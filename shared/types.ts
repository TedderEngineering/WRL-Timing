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
  track: string;
  date: string;
  season: string;
  raceCount: number;
  startDate: string;
  endDate: string;
}

export interface EventRace {
  id: string;
  name: string;
  date: string;
  status: RaceStatus;
  series: string;
  subSeries: string | null;
  roundNumber: number | null;
}

export interface EventWithRaces extends EventSummary {
  races: EventRace[];
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

export interface RaceDetail extends RaceSummary {
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
  team: string;
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
  totalPitLoss: number;
  inLapTime: number;
  outLapTime: number;
  avgGreenLapTime: number;
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
}

export interface SettleMarker {
  l: number;
  p: number;
  lb: string;
  su: string;
  c: string;
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

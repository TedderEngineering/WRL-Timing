/**
 * Engine-internal types (FACT_ENGINE_SPEC.md §4). Package types live in ./schema/package-types.ts,
 * a byte-identical copy of shared/race-analysis-package/types.ts.
 */
import type {
  CarId,
  ClassId,
  Driver,
  LineFlag,
  SourceFileRole,
  SourceFormat,
  Sha256,
} from "./schema/package-types.js";

export type { CarId, ClassId, LineFlag, SourceFormat };

export type Severity = "blocker" | "warning" | "note";

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  factIds?: string[];
  files?: string[];
}

/** A parsed PDF text item with page coordinates (pdf.js getTextContent). */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfTextItem[];
}

/** One input file as handed to the engine. PDFs carry pre-extracted text items (see loadPdfPages). */
export interface InputFile {
  name: string;
  role: SourceFileRole;
  /** Text content (CSV / JSON). */
  text?: string;
  /** Extracted PDF pages (pit-card PDFs). */
  pdf?: PdfPage[];
  sha256: Sha256;
  bytes: number;
  archive: { path: string; archivedAt: string };
  reportMark?: "unofficial" | "provisional" | "official" | "unknown";
}

export interface SourceFileInfo extends InputFile {
  fileId: string;
}

export interface CanonLap {
  lap: number;
  /** 1-based source line incl. header. */
  row: number;
  fileId: string;
  /** Official lap time; null when blank. */
  lapTimeS: number | null;
  /** Crossing instant on the race's absolute axis: clock seconds since local midnight of the
   *  race date (rollover-corrected), or Total_Race_Time for the WRL website export. */
  tS: number;
  /** ELAPSED column (Alkamel), cross-check only. */
  elapsedS: number | null;
  /** Laps covered by the row (>1 when lap numbers were skipped). */
  span: number;
  flag: LineFlag;
  inPit?: boolean;
  lastInPit?: boolean;
  /** Alkamel CROSSING_FINISH_LINE_IN_PIT = B. */
  crossedInPit?: boolean;
  pitTimeS?: number | null;
  driverNumber?: number | null;
  driverName?: string | null;
  speedKph?: number | null;
  topSpeedKph?: number | null;
}

export interface CanonEntry {
  car: CarId;
  className: string;
  team: string;
  makeRaw: string | null;
  makeBasis: "make_column" | "results_json" | "entry_list" | null;
  vehicle: string | null;
  drivers: Driver[];
}

export interface CanonPitRecord {
  car: CarId;
  source: "pit_json" | "pdf_card" | "drive_time";
  fileId: string;
  ref: string;
  nr?: number | null;
  inClockS: number;
  outClockS: number | null;
  pitTimeS: number | null;
  inDriver?: string | null;
  outDriver?: string | null;
  inDriverNumber?: number | null;
  outDriverNumber?: number | null;
  pitType?: "NORMAL" | "PENALTY" | null;
  /** Drive Time row that was merged into this card (|START - in| <= 1.5 s). */
  driveTimeRef?: string | null;
}

export interface CanonDriveStint {
  car: CarId;
  fileId: string;
  row: number;
  stintNumber: number | null;
  driver: string;
  startClockS: number | null;
  endClockS: number | null;
  type: "TRACK" | "PIT" | string;
  pitType: string;
  timeS: number | null;
  totalTrackTimeS: number | null;
  totalDriverTimeS: number | null;
}

export interface CanonFlagRecord {
  tS: number;
  recType: string;
  flag: string;
  message: string;
  lap: number | null;
  fileId: string;
  row: number;
}

export interface CanonMessage {
  tS: number | null;
  text: string;
  fileId: string;
  row: number;
}

export interface CanonResultRow {
  car: CarId;
  position: number | null;
  positionClass: number | null;
  positionClassSource: "by_class_file" | "class_column" | null;
  rawStatus: string;
  laps: number | null;
  totalTimeS: number | null;
  gapFirst: string | null;
  bestLapS: number | null;
  bestLapNumber: number | null;
  className: string | null;
  team: string | null;
  vehicle: string | null;
  makeRaw: string | null;
  drivers: Driver[];
  fileId: string;
  row: number;
  refs: string[];
}

export interface CanonResults {
  mark: "official" | "provisional" | "unofficial" | "unknown";
  fileIds: string[];
  rows: CanonResultRow[];
  /** Post-race decision lines (IMSA session.report_message), one per line. */
  postRaceLines: { text: string; fileId: string }[];
}

export interface CanonicalRace {
  format: SourceFormat;
  adapterVersion: string;
  files: SourceFileInfo[];
  /** 'clock': tS = local clock seconds; 'elapsed': tS = race elapsed (no time of day). */
  timeBase: "clock" | "elapsed";
  session: {
    series?: string;
    event?: string;
    session?: string;
    trackName?: string;
    trackLengthM?: number;
    dateCandidates: { date: string; source: string; ambiguous?: boolean }[];
    utcOffsetCandidates: { offsetMinutes: number; source: string }[];
    scheduledDurationS?: number | null;
    scheduledLaps?: number | null;
  };
  entries: CanonEntry[];
  laps: Record<CarId, CanonLap[]>;
  pitRecords: CanonPitRecord[];
  driveStints: CanonDriveStint[];
  flagRecords: CanonFlagRecord[];
  raceControl: CanonMessage[];
  results: CanonResults | null;
}

export interface AdapterResult {
  race: CanonicalRace;
  issues: Issue[];
}

/** Rulebook values the engine reads (FACT_ENGINE_SPEC.md §2.3). Every field optional = unknown. */
export interface EngineRulebook {
  id?: string;
  version?: string;
  pitCycleModel?: "rounds" | "windows" | "singleton";
  pitLaneTransitS?: number | null;
  garageThresholdS?: number | null;
  /** Penalty serve window after issue, seconds. */
  serveWindowS?: number | null;
  scheduledDurationS?: number | null;
  /** Drive time ends when the published time expires (default) or at the leader's finish. */
  driveTimeEndsAt?: "time_expiry" | "leader_finish";
}

export interface BuildOptions {
  series?: string;
  seriesId?: string;
  season?: number;
  event?: string;
  session?: string;
  track?: { id: string; name: string; timezone: string; layout?: string; lengthM?: number };
  /** Required for the WRL website export (no date in the files). */
  raceDate?: string;
  /** Local wall-clock start for the WRL website export, 'HH:MM:SS' (default: none; origin at midnight is flagged). */
  startClock?: string;
  rulebook?: EngineRulebook | null;
  packageId?: string;
  generatedAt?: string;
  engineVersion?: string;
}

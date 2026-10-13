/**
 * Shared types for the Claude-run race intake pipeline (RaceTrace 2.0, G4).
 *
 * The intake pulls raw timing files from the timing sites, keeps them in a
 * work folder with a manifest, and pushes them to the RaceTrace API. Nothing
 * in src/intake touches the database or the server config, so the CLI
 * (scripts/intake.ts) can run on the owner's laptop without server secrets.
 */

/** Timing site a session comes from. */
export type SiteId = "imsa" | "sro" | "speedhive";

/** Legacy parser id (src/utils/parsers): the format the admin import uses. */
export type LegacyFormat = "imsa" | "sro" | "grcup" | "speedhive" | "wrl-website";

/** Fact-engine format id (G2 build-facts). */
export type FactFormat = "alkamel-imsa" | "alkamel-sro" | "alkamel-grcup" | "speedhive" | "wrl-website";

/** The mark a results file carries. "unknown" = a results file without a mark. */
export type ResultsMark = "official" | "provisional" | "unofficial" | "unknown";

/** Results status of a whole session; "none" = no results file at all. */
export type ResultsStatus = ResultsMark | "none";

export type SessionType = "race" | "qualify" | "practice" | "other";

/**
 * File roles. These are the fact engine's roles (G2 SourceFileRole) so the
 * manifest can drive build-facts without guessing from file names.
 */
export type FileRole =
  | "laps"
  | "time_cards"
  | "summary"
  | "results"
  | "results_by_class"
  | "pit_cards_json"
  | "pit_cards_pdf"
  | "drive_time"
  | "flags"
  | "control_log"
  | "lap_chart"
  | "weather"
  | "other";

/** A file the site offers for a session. */
export interface RemoteFile {
  /** Absolute URL (path segments percent-encoded). */
  url: string;
  /** Original file name on the site. */
  name: string;
  /** Sub-folder of the session folder it sits in, e.g. "24_Hour 24". */
  subdir?: string;
  /** "Last modified" column of an Apache index, when the site shows one. */
  listedModified?: string;
  /** "Size" column of an Apache index, when the site shows one. */
  listedSize?: string;
}

/** One race session on a timing site. */
export interface RaceSession {
  /** Stable identity; see source-key.ts. */
  sourceKey: string;
  site: SiteId;
  /** Catalogue id, e.g. "imsa-mpc" (series.ts). */
  seriesId: string;
  /** Display label, e.g. "IMSA Michelin Pilot Challenge". */
  seriesLabel: string;
  /** Raw championship / sub-series folder or organisation name on the site. */
  championship: string;
  season: number;
  /** Event name for display, e.g. "Road Atlanta". */
  event: string;
  track: string;
  sessionName: string;
  sessionType: SessionType;
  /** Local start "YYYY-MM-DDTHH:MM" (Alkamel folder timestamp) or ISO from the API. */
  startTime: string;
  /** Local calendar date of the start, YYYY-MM-DD. */
  raceDate: string;
  /** Candidate files (Alkamel). Speedhive sessions download from the API instead. */
  files: RemoteFile[];
  resultsStatus: ResultsStatus;
  /** Fingerprint of what the site offers; changes when files change. */
  version: string;
  legacyFormat: LegacyFormat;
  factFormat: FactFormat;
  /** Source-specific ids (Speedhive). */
  ids?: Record<string, string | number>;
}

/** One file in a work folder. */
export interface ManifestFile {
  /** File name inside the work folder. */
  name: string;
  /** Name on the site (or API endpoint description). */
  sourceName: string;
  url: string;
  role: FileRole;
  /** Key sent to the API: a legacy parser slot or an archive-only key. */
  key: string;
  /** True when `key` is a slot the legacy parser reads. */
  parserSlot: boolean;
  /** Results mark for results files. */
  mark?: ResultsMark;
  sha256: string;
  bytes: number;
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
  listedModified?: string;
  listedSize?: string;
  /** Added by hand (e.g. a Redmist flags export), not fetched. */
  manual?: boolean;
  /** Generated locally from fetched data (Speedhive CSVs built from API JSON). */
  derivedFrom?: string[];
}

export interface IntakeMetadata {
  /** Race name shown on the site (owner can rename later). */
  name: string;
  raceDate: string;
  track: string;
  /** Race.series value ("IMSA", "SRO", "GR_CUP", "WRL"). */
  series: string;
  subSeries?: string;
  season: number;
  event: string;
  sessionName: string;
  startTime: string;
  championship: string;
}

export interface Manifest {
  manifestVersion: 1;
  sourceKey: string;
  site: SiteId;
  seriesId: string;
  seriesLabel: string;
  legacyFormat: LegacyFormat;
  factFormat: FactFormat;
  metadata: IntakeMetadata;
  resultsStatus: ResultsStatus;
  version: string;
  createdAt: string;
  updatedAt: string;
  files: ManifestFile[];
  /** Roles the formats use that the site did not offer. */
  missing: { role: FileRole; note: string }[];
  warnings: string[];
  ids?: Record<string, string | number>;
}

export interface DiscoverOptions {
  season: number;
  /** Only sessions starting on or after this date (YYYY-MM-DD). */
  since?: string;
  /** Include qualifying/practice sessions too (default: races only). */
  allSessions?: boolean;
  /** Progress lines (stderr). */
  log?: (msg: string) => void;
}

export interface DownloadOptions {
  /** Refetch everything even when unchanged. */
  force?: boolean;
  log?: (msg: string) => void;
  /** Clock, for tests. */
  now?: () => Date;
}

export interface DownloadReport {
  dir: string;
  manifest: Manifest;
  downloaded: string[];
  unchanged: string[];
  failed: { name: string; error: string }[];
}

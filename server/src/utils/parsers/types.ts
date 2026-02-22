/**
 * Shared types for all race data parsers.
 *
 * Every new data source (SpeedHive, IMSA, SRO, etc.) implements
 * the RaceDataParser interface. The parser registry maps format IDs
 * to their parser + metadata.
 */

import type { RaceDataJson } from "../race-validators.js";

/** Result returned by every parser */
export interface ParsedResult {
  data: RaceDataJson;
  annotations: Record<string, any>;
  warnings: string[];
}

/** Describes what CSV files a format expects */
export interface FileSlot {
  key: string;        // field name sent in the request body (e.g. "summaryCsv")
  label: string;      // UI label (e.g. "Summary CSV")
  description: string; // Help text for the upload zone
  required: boolean;
  accept?: string;    // file extension filter (e.g. ".csv" or ".json"), defaults to ".csv"
}

/** Every parser format must provide this */
export interface RaceDataParser {
  /** Unique ID used in API calls */
  id: string;

  /** Display name */
  name: string;

  /** Series this parser is intended for */
  series: string;

  /** Description shown in the upload wizard */
  description: string;

  /** What files this parser expects */
  fileSlots: FileSlot[];

  /**
   * Parse the provided CSV strings into the internal RaceDataJson format.
   * The `files` keys correspond to the `fileSlot.key` values.
   * Throws on fatal errors, returns warnings for non-fatal issues.
   */
  parse(files: Record<string, string>): ParsedResult;
}

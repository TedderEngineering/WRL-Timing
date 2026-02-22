/**
 * Parser Registry
 *
 * Central registry of all supported race data formats.
 * To add a new format:
 *   1. Create a new file in this directory implementing RaceDataParser
 *   2. Import it here and add to the PARSERS array
 *   3. That's it — the upload wizard and API will pick it up automatically
 */

import type { RaceDataParser } from "./types.js";
import { speedhiveParser } from "./speedhive.js";
import { imsaParser } from "./imsa.js";
import { sroParser } from "./sro.js";

const PARSERS: RaceDataParser[] = [
  speedhiveParser,
  imsaParser,
  sroParser,
];

/** Get a parser by its format ID */
export function getParser(formatId: string): RaceDataParser | undefined {
  return PARSERS.find((p) => p.id === formatId);
}

/** Get all registered parsers (for the upload wizard format selector) */
export function getAllParsers(): Array<{
  id: string;
  name: string;
  series: string;
  description: string;
  implemented: boolean;
  fileSlots: RaceDataParser["fileSlots"];
}> {
  return PARSERS.map((p) => {
    // A parser is "implemented" if calling parse doesn't immediately throw "not yet implemented"
    let implemented = true;
    try {
      // Try with empty files — if it throws "not yet implemented", it's a placeholder
      p.parse({});
    } catch (err: any) {
      if (err.message?.includes("not yet implemented")) {
        implemented = false;
      }
      // Other errors (like "missing CSV") mean it IS implemented, just needs valid input
    }

    return {
      id: p.id,
      name: p.name,
      series: p.series,
      description: p.description,
      implemented,
      fileSlots: p.fileSlots,
    };
  });
}

export type { RaceDataParser, ParsedResult, FileSlot } from "./types.js";

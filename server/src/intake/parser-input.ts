/**
 * The legacy parser's input for a set of pushed files (no database, no server
 * config), shared by the intake service and the CLI's re-import planner.
 */
import type { RaceDataParser } from "../utils/parsers/types.js";

/**
 * Files some parsers require but a machine intake cannot always supply. The
 * Speedhive and WRL-website parsers throw without the Redmist flags CSV and
 * control log, which are not on Speedhive. A header-only table makes the
 * parser fall back to lap-status FCY detection (its own documented path,
 * speedhive.ts "Flags CSV produced no valid flag periods"). Placeholders go to
 * the parser only; they are never archived.
 */
export const PARSER_PLACEHOLDERS: Record<string, Record<string, string>> = {
  speedhive: {
    flagsCsv: "Flag,Start,End,Duration\r\n",
    controlLogCsv: "Sequence,Timestamp,Car_1,Car_2,Description,Action,Status\r\n",
  },
  "wrl-website": {
    flagsCsv: "Flag,Start,End,Duration\r\n",
    controlLogCsv: "Sequence,Timestamp,Car_1,Car_2,Description,Action,Status\r\n",
  },
};

/** Parser input: declared slots only, plus placeholders for missing intake-optional slots. */
export function parserInput(
  parser: Pick<RaceDataParser, "id" | "fileSlots">,
  files: Record<string, string>
): { input: Record<string, string>; placeholders: string[]; missing: string[] } {
  const input: Record<string, string> = {};
  const placeholders: string[] = [];
  const missing: string[] = [];
  const ph = PARSER_PLACEHOLDERS[parser.id] ?? {};
  for (const slot of parser.fileSlots) {
    const v = files[slot.key];
    if (typeof v === "string" && v.length > 0) input[slot.key] = v;
    else if (ph[slot.key]) {
      input[slot.key] = ph[slot.key];
      placeholders.push(slot.key);
    } else if (slot.required) missing.push(`${slot.label} (key: ${slot.key})`);
  }
  return { input, placeholders, missing };
}


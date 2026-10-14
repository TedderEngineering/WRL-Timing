import type { SourceFileRole, SourceFormat } from "../schema/package-types.js";
import type { AdapterResult, SourceFileInfo } from "../types.js";
import { adaptAlkamel } from "./alkamel.js";
import { adaptRedmist } from "./redmist.js";
import { adaptSpeedhive, adaptWrlWebsite } from "./wrl.js";

export { AdapterBlocker } from "./errors.js";
export { loadPdfPages } from "./pdf.js";
export { parsePitCardsPdf } from "./pit-cards-pdf.js";

export const SOURCE_FORMATS: SourceFormat[] = ["speedhive", "wrl-website", "alkamel-sro", "alkamel-grcup", "alkamel-imsa", "redmist"];

/** Adapter dispatch (FACT_ENGINE_SPEC.md §4). */
export function adapt(format: SourceFormat, files: SourceFileInfo[]): AdapterResult {
  switch (format) {
    case "speedhive":
      return adaptSpeedhive(files);
    case "wrl-website":
      return adaptWrlWebsite(files);
    case "alkamel-sro":
    case "alkamel-grcup":
    case "alkamel-imsa":
      return adaptAlkamel(format, files);
    case "redmist":
      return adaptRedmist(files);
    default:
      throw new Error(`unknown format ${String(format)}`);
  }
}

/** Role of a file from its name (timing-provider naming conventions). */
export function detectRole(name: string): SourceFileRole {
  const n = name.toLowerCase();
  // RedMist exports (redmist_<event>_<session>_<kind>.json, or <event>_<session>_<kind>.json).
  if (/_laps\.json$/.test(n)) return "laps";
  if (/_pits\.json$/.test(n)) return "pit_cards_json";
  if (/_control\.json$/.test(n)) return "control_log";
  if (/_all_laps\.csv$/.test(n)) return "laps";
  if (/_summary\.csv$/.test(n)) return "summary";
  if (/analysisendurance/.test(n)) return "laps";
  if (/23_time[ _]cards/.test(n)) return "time_cards";
  if (/pit[ _]stops?[ _]time[ _]cards/.test(n)) return /\.json$/.test(n) ? "pit_cards_json" : "pit_cards_pdf";
  if (/drive[ _]time/.test(n)) return "drive_time";
  if (/flags/.test(n)) return "flags";
  if (/results[ _]by[ _]class/.test(n)) return "results_by_class";
  if (/(^|[^a-z])0[03]_.*results|results/.test(n)) return "results";
  if (/lap[ _]chart/.test(n)) return "lap_chart";
  if (/weather/.test(n)) return "weather";
  if (/control[ _-]?log/.test(n)) return "control_log";
  return "other";
}

/**
 * Builds a RaceSession from an Alkamel session's file list (IMSA and SRO).
 */
import { selectAlkamelFiles } from "../file-select.js";
import { sha256, stripNumberPrefix } from "../names.js";
import { classifySession, type SeriesDef } from "../series.js";
import { parseSessionFolder, seasonYear } from "../source-key.js";
import type { RaceSession, RemoteFile, SiteId } from "../types.js";

/** Session fingerprint: the selected files' names, folders, index dates and sizes, plus the results mark. */
export function alkamelVersion(format: "imsa" | "sro" | "grcup", files: RemoteFile[]): { version: string; resultsStatus: RaceSession["resultsStatus"] } {
  const sel = selectAlkamelFiles(format, files);
  const rows = sel.files
    .map((s) => [s.key, s.file.subdir ?? "", s.file.name, s.file.listedModified ?? "", s.file.listedSize ?? ""].join("|"))
    .sort();
  return { version: sha256(JSON.stringify([sel.resultsStatus, rows])).slice(0, 16), resultsStatus: sel.resultsStatus };
}

export function buildAlkamelSession(args: {
  site: Exclude<SiteId, "speedhive">;
  sourceKey: string;
  def: SeriesDef;
  championship: string;
  seasonFolder: string;
  eventFolder: string;
  sessionFolder: string;
  files: RemoteFile[];
}): RaceSession | null {
  const sf = parseSessionFolder(args.sessionFolder);
  const year = seasonYear(args.seasonFolder) ?? (sf ? Number(sf.date.slice(0, 4)) : NaN);
  if (!sf || !Number.isFinite(year)) return null;
  const format = args.def.legacyFormat as "imsa" | "sro" | "grcup";
  const { version, resultsStatus } = alkamelVersion(format, args.files);
  const event = stripNumberPrefix(args.eventFolder);
  return {
    sourceKey: args.sourceKey,
    site: args.site,
    seriesId: args.def.id,
    seriesLabel: args.def.label,
    championship: args.championship,
    season: year,
    event,
    track: event,
    sessionName: sf.name,
    sessionType: classifySession(sf.name),
    startTime: `${sf.date}T${sf.time}`,
    raceDate: sf.date,
    files: args.files,
    resultsStatus,
    version,
    legacyFormat: args.def.legacyFormat,
    factFormat: args.def.factFormat,
  };
}

/** Session start date passes the --since filter. */
export function onOrAfter(raceDate: string, since?: string): boolean {
  return !since || raceDate >= since;
}

/**
 * Which files of an Alkamel session (IMSA, SRO, GR Cup) the intake fetches,
 * and which API key each one is sent under.
 *
 * Two consumers read the files:
 *  - the legacy parser (src/utils/parsers), through its `fileSlots` keys, so
 *    the current charts keep working;
 *  - the fact engine (G2 build-facts), through file roles, which also wants
 *    Drive Time, weather, flags and results-by-class.
 * Every selected file is archived. Keys that are not parser slots are
 * archive-only (the parser never sees them).
 *
 * Results: the best mark wins, official › provisional › unofficial ›
 * unmarked. The session's `resultsStatus` records which one was taken.
 */
import type { FileRole, LegacyFormat, RemoteFile, ResultsMark, ResultsStatus } from "./types.js";

export type FileExt = "csv" | "json" | "pdf";

export interface ClassifiedFile {
  role: FileRole;
  ext: FileExt;
  mark?: ResultsMark;
  /** Lower is better among files of the same role and extension. */
  rank: number;
}

const MARK_RANK: Record<ResultsMark, number> = { official: 0, provisional: 1, unofficial: 2, unknown: 3 };

export function resultsMarkOf(name: string): ResultsMark {
  const n = name.toLowerCase();
  if (/unofficial/.test(n)) return "unofficial";
  if (/official/.test(n)) return "official";
  if (/provisional/.test(n)) return "provisional";
  return "unknown";
}

/** Rank of a results status for "never replace better results with worse". */
export function resultsStatusRank(s: ResultsStatus | string | null | undefined): number {
  switch (s) {
    case "official":
      return 3;
    case "provisional":
      return 2;
    case "unofficial":
      return 1;
    default:
      return 0; // unknown, none, null
  }
}

/**
 * Classify one Alkamel file name. Returns null for files no consumer reads
 * (grids, points, best laps, "by hour" splits, classification PDFs, …).
 */
export function classifyAlkamelFile(name: string): ClassifiedFile | null {
  const base = name.trim();
  const m = base.match(/\.(csv|json|pdf)$/i);
  if (!m) return null;
  const ext = m[1].toLowerCase() as FileExt;
  const n = base.toLowerCase();
  if (/by\s*hour|by\s*number|grid|points|standings|best\s*(lap|sector)|fastest|speed\s*trap|top\s*speed|lap\s*times\s*by/.test(n)) return null;

  // Lap data
  if (/^23_analysis\s*endurance/.test(n) && ext === "csv") return { role: "laps", ext, rank: /with\s*sections/.test(n) ? 0 : 1 };
  if (/^23_time[ _]?cards/.test(n) && ext !== "pdf") return { role: "time_cards", ext, rank: 0 };

  // Pit stops
  if (/^20_pit[ _]?stops?([ _]?time[ _]?cards)?/.test(n) && ext !== "csv") {
    return { role: ext === "json" ? "pit_cards_json" : "pit_cards_pdf", ext, rank: /time[ _]?cards/.test(n) ? 0 : 1 };
  }
  if (/^20_drive[ _]?time/.test(n) && ext === "csv") return { role: "drive_time", ext, rank: 0 };

  // Flags and race control
  if (/^(25|99)_flags[ _]?analysis/.test(n)) {
    return { role: "flags", ext, rank: (/with\s*rc\s*messages/.test(n) ? 0 : 2) + (n.startsWith("25_") ? 0 : 1) };
  }

  // Results
  if (/^0[0-5]_.*results/.test(n) && ext !== "pdf") {
    const mark = resultsMarkOf(n);
    const role: FileRole = /by\s*class/.test(n) ? "results_by_class" : "results";
    // 03_Results is the main classification; 00_Results is GR Cup's; 05 is by class.
    const prefixRank = n.startsWith("03_") ? 0 : n.startsWith("00_") ? 1 : 2;
    return { role, ext, mark, rank: MARK_RANK[mark] * 10 + prefixRank };
  }

  if (/^12_lap[ _]?chart/.test(n) && ext === "json") return { role: "lap_chart", ext, rank: 0 };
  if (/^26_weather/.test(n) && ext === "csv") return { role: "weather", ext, rank: 0 };
  return null;
}

/** A file chosen for download, with the key it is sent to the API under. */
export interface SelectedFile {
  file: RemoteFile;
  role: FileRole;
  key: string;
  parserSlot: boolean;
  mark?: ResultsMark;
}

export interface Selection {
  files: SelectedFile[];
  resultsStatus: ResultsStatus;
  /** Roles the format uses that the session does not offer. */
  missing: { role: FileRole; note: string }[];
}

/** Archive-only key for a role and extension (fileTypeForKey picks the extension from the key). */
function archiveKey(role: FileRole, ext: FileExt): string {
  const base: Record<FileRole, string> = {
    laps: "laps",
    time_cards: "timeCards",
    summary: "summary",
    results: "results",
    results_by_class: "resultsByClass",
    pit_cards_json: "pitStop",
    pit_cards_pdf: "pitStop",
    drive_time: "driveTime",
    flags: "flags",
    control_log: "controlLog",
    lap_chart: "lapChart",
    weather: "weather",
    other: "other",
  };
  return base[role] + ext[0].toUpperCase() + ext.slice(1);
}

/**
 * Legacy parser slot for (format, role, ext), or null when that parser has
 * no slot for it (the file is then archived only).
 */
export function parserSlotFor(format: LegacyFormat, role: FileRole, ext: FileExt): string | null {
  switch (format) {
    case "imsa":
      if (role === "time_cards") return ext === "json" ? "timeCardsJson" : "timeCardsCsv";
      if (role === "pit_cards_json") return "pitStopJson";
      if (role === "pit_cards_pdf") return "pitStopPdf";
      // The IMSA flags slot takes JSON or the 2025+ flags PDF; the CSV has its own slot.
      if (role === "flags") return ext === "csv" ? "flagsCsv" : "flagsJson";
      if (role === "results" && ext === "csv") return "resultsCsv";
      return null;
    case "sro":
      if (role === "laps") return "lapsCsv";
      if (role === "results" && ext === "csv") return "resultsCsv";
      if (role === "pit_cards_pdf") return "pitStopPdf";
      return null;
    case "grcup":
      if (role === "laps") return "lapsCsv";
      if (role === "results" && ext === "csv") return "resultsCsv";
      return null;
    default:
      return null;
  }
}

/** What each Alkamel format needs, for the `missing` report. */
const WANTED: Record<"imsa" | "sro" | "grcup", { role: FileRole; required: boolean; note: string }[]> = {
  imsa: [
    { role: "time_cards", required: true, note: "23_Time Cards (lap data) — required" },
    { role: "results", required: true, note: "03_Results — finishing order comes only from results (D-FINISH)" },
    { role: "pit_cards_json", required: false, note: "20_Pit Stops Time Cards (JSON, else PDF)" },
    { role: "flags", required: false, note: "25_FlagsAnalysisWithRCMessages — FCY is reconstructed without it" },
    { role: "drive_time", required: false, note: "20_Drive Time" },
    { role: "weather", required: false, note: "26_Weather (UTC cross-check for the race date)" },
  ],
  sro: [
    { role: "laps", required: true, note: "23_AnalysisEnduranceWithSections — required" },
    { role: "results", required: true, note: "03_Results — finishing order comes only from results (D-FINISH)" },
    { role: "pit_cards_pdf", required: false, note: "20_Pit Stops Time Cards PDF" },
    { role: "flags", required: false, note: "25_FlagsAnalysisWithRCMessages" },
    { role: "drive_time", required: false, note: "20_Drive Time" },
    { role: "weather", required: false, note: "26_Weather" },
  ],
  grcup: [
    { role: "laps", required: true, note: "23_AnalysisEnduranceWithSections — required" },
    { role: "results", required: true, note: "00_Results / 03_Results — required by the GR Cup parser" },
    { role: "pit_cards_pdf", required: false, note: "20_Pit Stops Time Cards PDF" },
    { role: "flags", required: false, note: "25_FlagsAnalysisWithRCMessages" },
  ],
};

/** Hour number of an endurance "Hour" sub-folder ("24_Hour 24", "06_HOUR 6"), else null. */
export function hourOfSubdir(subdir: string | undefined): number | null {
  if (!subdir) return null;
  const m = subdir.match(/^\d+_hour[ _]?(\d+)$/i);
  return m ? Number(m[1]) : null;
}

/**
 * Choose the files to fetch for one Alkamel session.
 *
 * - Endurance races publish cumulative files per hour: only the last hour
 *   folder is used, plus files at the session root.
 * - Per role and extension the best-ranked file wins (results: best mark).
 * - IMSA: the pit PDF only when there is no pit JSON; the flags PDF only when
 *   there is neither flags JSON nor CSV. SRO/GR Cup laps fall back to the
 *   23_Time Cards CSV (same columns) when 23_AnalysisEndurance is missing.
 */
export function selectAlkamelFiles(format: "imsa" | "sro" | "grcup", files: RemoteFile[]): Selection {
  const hours = files.map((f) => hourOfSubdir(f.subdir)).filter((h): h is number => h !== null);
  const lastHour = hours.length ? Math.max(...hours) : null;

  const best = new Map<string, { f: RemoteFile; c: ClassifiedFile; hour: number }>();
  for (const f of files) {
    const h = hourOfSubdir(f.subdir);
    if (h !== null && h !== lastHour) continue;
    const c = classifyAlkamelFile(f.name);
    if (!c) continue;
    const slotKey = `${c.role}.${c.ext}`;
    const cur = best.get(slotKey);
    // Prefer the last-hour copy over a root copy of the same role (it is complete), then the rank.
    const hourScore = h ?? -1;
    if (!cur || hourScore > cur.hour || (hourScore === cur.hour && c.rank < cur.c.rank)) {
      best.set(slotKey, { f, c, hour: hourScore });
    }
  }

  const has = (role: FileRole, ext?: FileExt) =>
    [...best.values()].some((b) => b.c.role === role && (!ext || b.c.ext === ext));
  const drop = (role: FileRole, ext: FileExt) => best.delete(`${role}.${ext}`);

  if (has("pit_cards_json")) drop("pit_cards_pdf", "pdf");
  if (has("flags", "json") || has("flags", "csv")) drop("flags", "pdf");
  // Results JSON/CSV: keep both formats only when they carry the same mark as the best one.
  const results = [...best.values()].filter((b) => b.c.role === "results");
  if (results.length > 1) {
    const top = Math.min(...results.map((b) => MARK_RANK[b.c.mark ?? "unknown"]));
    for (const b of results) if (MARK_RANK[b.c.mark ?? "unknown"] > top) drop("results", b.c.ext);
  }
  if (format !== "imsa" && !has("laps") && has("time_cards", "csv")) {
    // Same columns as the AnalysisEndurance CSV (DEFINITIONS §0.1): use it as the laps file.
    const tc = best.get("time_cards.csv")!;
    best.delete("time_cards.csv");
    best.set("laps.csv", { ...tc, c: { ...tc.c, role: "laps" } });
  }

  const out: SelectedFile[] = [];
  for (const { f, c } of best.values()) {
    const slot = parserSlotFor(format, c.role, c.ext);
    out.push({
      file: f,
      role: c.role,
      key: slot ?? archiveKey(c.role, c.ext),
      parserSlot: slot !== null,
      ...(c.mark ? { mark: c.mark } : {}),
    });
  }
  // SRO/GR Cup: with no main results CSV, the by-class results CSV feeds the
  // parser's results slot (the SRO parser accepts 05_… Results by Class).
  if (format !== "imsa" && !out.some((s) => s.key === "resultsCsv")) {
    const byClass = out.find((s) => s.role === "results_by_class" && s.file.name.toLowerCase().endsWith(".csv"));
    if (byClass) {
      byClass.key = "resultsCsv";
      byClass.parserSlot = true;
    }
  }
  out.sort((a, b) => a.key.localeCompare(b.key));

  const mainResults = out.filter((s) => s.role === "results");
  const marks = (mainResults.length ? mainResults : out.filter((s) => s.role === "results_by_class")).map(
    (s) => s.mark ?? "unknown"
  );
  const resultsStatus: ResultsStatus = marks.length
    ? (["official", "provisional", "unofficial", "unknown"] as ResultsMark[]).find((m) => marks.includes(m))!
    : "none";

  const missing = WANTED[format]
    .filter((w) => {
      if (w.role === "pit_cards_json" || w.role === "pit_cards_pdf") return !has("pit_cards_json") && !has("pit_cards_pdf");
      if (w.role === "results") return !has("results") && !has("results_by_class");
      return !has(w.role);
    })
    .map((w) => ({ role: w.role, note: w.note }));

  return { files: out, resultsStatus, missing };
}

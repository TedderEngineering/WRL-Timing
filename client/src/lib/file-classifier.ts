// ─── Types ───────────────────────────────────────────────────────────────────

export type FileType =
  | "timeCardsJson"
  | "flagsJson"
  | "pitStopJson"
  | "timeCardsCsv"
  | "summaryCsv"
  | "lapsCsv"
  | "flagsPdf"
  | "sroResultsCsv"
  | "grResultsCsv"
  | "alkamelLapsCsv"
  | "unsupportedPdf"
  | "unknown";

export type FormatId = "imsa" | "speedhive" | "wrl-website" | "sro" | "grcup";

export interface DetectedFile {
  file: File;
  content: string;
  type: FileType;
  format: FormatId | null;
  groupKey: string | null;
  metadata: Partial<RaceGroupMetadata>;
  warning?: string;
}

export interface RaceGroupMetadata {
  name: string;
  date: string;
  track: string;
  series: string;
  season: string;
}

export interface RaceGroup {
  id: string;
  format: FormatId;
  metadata: RaceGroupMetadata;
  files: Map<FileType, DetectedFile>;
  complete: boolean;
  missingRequired: string[];
  validation: ValidationState | null;
  importStatus: "idle" | "importing" | "success" | "error";
  importResult?: { raceId: string; entriesCreated: number; lapsCreated: number };
  importError?: string;
}

export interface ValidationState {
  status: "validating" | "valid" | "warning" | "invalid";
  errors: string[];
  warnings: string[];
  stats: ValidationStats | null;
  duplicate: boolean;
}

export interface ValidationStats {
  totalCars: number;
  maxLap: number;
  totalLapRecords: number;
  classes: string[];
  classCarCounts: Record<string, number>;
  fcyPeriods: number;
  greenPaceCutoff: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const REQUIRED_SLOTS: Record<FormatId, FileType[]> = {
  imsa: ["timeCardsJson"],
  speedhive: ["summaryCsv", "lapsCsv"],
  "wrl-website": ["summaryCsv", "lapsCsv"],
  sro: ["sroResultsCsv", "alkamelLapsCsv"],
  grcup: ["grResultsCsv", "alkamelLapsCsv"],
};

/** Maps internal FileType to the server-side slot key */
export const FILE_TYPE_TO_SLOT: Record<FileType, string> = {
  timeCardsJson: "timeCardsJson",
  flagsJson: "flagsJson",
  pitStopJson: "pitStopJson",
  timeCardsCsv: "timeCardsCsv",
  summaryCsv: "summaryCsv",
  lapsCsv: "lapsCsv",
  flagsPdf: "flagsJson", // PDF flags map to flagsJson slot (server handles base64)
  sroResultsCsv: "resultsCsv",
  grResultsCsv: "resultsCsv",
  alkamelLapsCsv: "lapsCsv",
  unsupportedPdf: "unknown",
  unknown: "unknown",
};

export const FILE_TYPE_LABELS: Record<FileType, string> = {
  timeCardsJson: "Time Cards JSON",
  flagsJson: "Flags & RC Messages JSON",
  pitStopJson: "Pit Stops JSON",
  timeCardsCsv: "Time Cards CSV",
  summaryCsv: "Summary CSV",
  lapsCsv: "All Laps CSV",
  flagsPdf: "Flags PDF",
  sroResultsCsv: "Results CSV",
  grResultsCsv: "Results CSV",
  alkamelLapsCsv: "Laps CSV",
  unsupportedPdf: "Unsupported PDF",
  unknown: "Unknown",
};

// ─── File reading ────────────────────────────────────────────────────────────

export async function readFileContent(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read PDF"));
      reader.readAsDataURL(file);
    });
  }
  return file.text();
}

// ─── Single-file classification ──────────────────────────────────────────────

export function classifyFile(file: File, content: string): DetectedFile {
  const clean = content.replace(/^\uFEFF/, "");
  const result: DetectedFile = {
    file,
    content,
    type: "unknown",
    format: null,
    groupKey: null,
    metadata: {},
  };

  // PDF detection
  if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
    const fn = file.name.toLowerCase();
    const isSroGrcupAdjacent =
      /grcup|gr_cup|sro|gt4/.test(fn) ||
      /^0[05]_/.test(fn) ||
      (/^20_/.test(fn) && !/time_?cards|imsa|weathertech/.test(fn));

    if (isSroGrcupAdjacent) {
      result.type = "unsupportedPdf";
      result.format = null;
      return result;
    }

    result.type = "flagsPdf";
    result.format = "imsa";
    // Group with any existing IMSA group (resolved later in classifyFiles)
    result.groupKey = "__pdf_pending__";
    return result;
  }

  // JSON detection — use string peek instead of full JSON.parse (avoids parsing multi-MB files)
  if (file.name.toLowerCase().endsWith(".json")) {
    // 0-byte JSON: accept into timeCardsJson slot with a warning so CSV fallback can work
    if (file.size === 0 || clean.trim().length === 0) {
      result.type = "timeCardsJson";
      result.format = "imsa";
      result.groupKey = "__imsa_csv_pending__";
      result.warning =
        "File is empty — import will use Time Cards CSV as fallback. Drop 23_Time_Cards_Race.csv to enable import.";
      return result;
    }

    const peek = clean.slice(0, 4000);

    // IMSA JSONs with "participants" array — use filename to distinguish:
    //   23_Time Cards  → timeCardsJson (has participants + per-lap timing)
    //   12_Lap Chart   → skip (roster only, no laps)
    //   03_Results / 05_Results by Class → skip (roster only)
    //   Unknown name   → timeCardsJson fallback (won't overwrite Time Cards)
    if (/"participants"\s*:\s*\[/.test(peek)) {
      const fn = file.name.toLowerCase();

      // Skip roster-only and results files
      if (/lap[_\s]chart/i.test(fn) || /^0[35]_/.test(fn)) {
        return result; // stays "unknown"
      }

      result.type = "timeCardsJson";
      result.format = "imsa";
      const meta = extractImsaMetadataFromPeek(peek);
      result.metadata = meta;
      if (meta.name || meta.date) {
        result.groupKey = `${meta.name || ""}|${meta._sessionDate || ""}`;
      }
      return result;
    }

    // IMSA Flags/RC Messages JSON: has "flags" array
    if (/"flags"\s*:\s*\[/.test(peek)) {
      result.type = "flagsJson";
      result.format = "imsa";
      const meta = extractImsaMetadataFromPeek(peek);
      result.metadata = meta;
      if (meta.name || meta.date) {
        result.groupKey = `${meta.name || ""}|${meta._sessionDate || ""}`;
      }
      return result;
    }

    // IMSA Pit Stops JSON: has "pit_stop_analysis" array
    if (/"pit_stop_analysis"\s*:\s*\[/.test(peek)) {
      result.type = "pitStopJson";
      result.format = "imsa";
      const meta = extractImsaMetadataFromPeek(peek);
      result.metadata = meta;
      if (meta.name || meta.date) {
        result.groupKey = `${meta.name || ""}|${meta._sessionDate || ""}`;
      }
      return result;
    }
  }

  // CSV detection
  if (file.name.toLowerCase().endsWith(".csv")) {
    const headerLine = clean.split("\n")[0] || "";
    const headerLower = headerLine.toLowerCase();

    // IMSA Time Cards CSV: semicolon-delimited with NUMBER, DRIVER_NUMBER, LAP_NUMBER, ELAPSED
    if (
      headerLower.includes("number") &&
      headerLower.includes("driver_number") &&
      headerLower.includes("lap_number") &&
      headerLower.includes("elapsed")
    ) {
      result.type = "timeCardsCsv";
      result.format = "imsa";
      // Group with any existing IMSA group (resolved later like PDFs)
      result.groupKey = "__imsa_csv_pending__";
      return result;
    }

    // WRL Website CSVs: underscore-separated headers like Overall_Position, Car_Number
    if (headerLower.includes("overall_position") || headerLower.includes("car_number,team_name,sponsor")) {
      const isSummary = headerLower.includes("overall_position") && headerLower.includes("laps_completed");
      const isLaps = headerLower.includes("lap_number") && headerLower.includes("lap_time");

      if (isSummary || isLaps) {
        result.type = isSummary ? "summaryCsv" : "lapsCsv";
        result.format = "wrl-website";
        result.metadata = extractWrlWebsiteMetadata(file.name, content);
        result.groupKey = `wrl_${result.metadata.date || file.name.replace(/_(summary|all_laps)\.csv$/i, "")}`;
        return result;
      }
    }

    // SRO Results CSV: semicolon-delimited with CLASS_TYPE and DRIVERS columns
    if (
      headerLower.includes(";") &&
      headerLower.includes("class_type") &&
      headerLower.includes("drivers")
    ) {
      result.type = "sroResultsCsv";
      result.format = "sro";
      const sroKey = extractAlkamelEventKey(file.name);
      const sroMeta = extractAlkamelMetadata(sroKey, "SRO");
      result.metadata = sroMeta;
      result.groupKey = `sro_${sroKey}`;
      return result;
    }

    // GR Cup Results CSV: semicolon-delimited with DRIVER_FIRSTNAME column
    if (
      headerLower.includes(";") &&
      headerLower.includes("driver_firstname") &&
      headerLower.includes("position")
    ) {
      result.type = "grResultsCsv";
      result.format = "grcup";
      const grKey = extractAlkamelEventKey(file.name);
      const grMeta = extractAlkamelMetadata(grKey, "GR_CUP");
      result.metadata = grMeta;
      result.groupKey = `grcup_${grKey}`;
      return result;
    }

    // Alkamel Laps CSV: semicolon-delimited with CROSSING_FINISH_LINE_IN_PIT
    if (
      headerLower.includes(";") &&
      headerLower.includes("crossing_finish_line_in_pit")
    ) {
      result.type = "alkamelLapsCsv";
      // Format determined during pending resolution (SRO or GR Cup)
      result.format = "sro"; // default, will be corrected during resolution
      result.groupKey = extractAlkamelEventKey(file.name);
      return result;
    }

    // SpeedHive CSVs: filename pattern or space-separated headers like "Start Number"
    const fn = file.name.toLowerCase();
    const shSummary = fn.match(/(\d+)_summary\.csv$/);
    const shLaps = fn.match(/(\d+)_all_laps\.csv$/);

    if (shSummary) {
      result.type = "summaryCsv";
      result.format = "speedhive";
      result.groupKey = `sh_${shSummary[1]}`;
      result.metadata = extractSpeedhiveMetadata(file.name, content);
      return result;
    }

    if (shLaps) {
      result.type = "lapsCsv";
      result.format = "speedhive";
      result.groupKey = `sh_${shLaps[1]}`;
      result.metadata = extractSpeedhiveMetadata(file.name, content);
      return result;
    }
  }

  return result;
}

// ─── Batch classification ────────────────────────────────────────────────────

export async function classifyFiles(
  files: File[],
  existingGroups: Map<string, RaceGroup>,
  existingUnmatched: DetectedFile[],
  existingUnsupported: DetectedFile[] = []
): Promise<{ groups: Map<string, RaceGroup>; unmatched: DetectedFile[]; unsupported: DetectedFile[] }> {
  const groups = new Map(existingGroups);
  const unmatched = [...existingUnmatched];
  const unsupported = [...existingUnsupported];
  const pendingImsa: DetectedFile[] = [];

  for (const file of files) {
    try {
      const content = await readFileContent(file);
      const detected = classifyFile(file, content);

      if (detected.type === "unsupportedPdf") {
        unsupported.push(detected);
        continue;
      }

      if (detected.type === "unknown" || !detected.format) {
        unmatched.push(detected);
        continue;
      }

      // PDFs, IMSA CSVs, and Alkamel laps wait for group resolution
      if (
        detected.groupKey === "__pdf_pending__" ||
        detected.groupKey === "__imsa_csv_pending__" ||
        detected.type === "alkamelLapsCsv"
      ) {
        pendingImsa.push(detected);
        continue;
      }

      if (!detected.groupKey) {
        unmatched.push(detected);
        continue;
      }

      mergeIntoGroup(groups, detected);
    } catch {
      unmatched.push({
        file,
        content: "",
        type: "unknown",
        format: null,
        groupKey: null,
        metadata: {},
      });
    }
  }

  // Resolve pending files: attach to matching group, or leave unmatched
  for (const pending of pendingImsa) {
    if (pending.type === "alkamelLapsCsv") {
      // Alkamel laps → match to SRO/GR Cup group by race number + venue code
      const lapsKey = pending.groupKey!; // already normalized by extractAlkamelEventKey
      const lapsSig = extractRaceSignature(lapsKey);
      const lapsIsGrcup = lapsKey.includes("GRCUP");
      const candidates = lapsSig
        ? Array.from(groups.values()).filter((g) => {
            if (g.format !== "sro" && g.format !== "grcup") return false;
            const groupSig = extractRaceSignature(normalizeEventKey(g.id));
            return groupSig !== null &&
              groupSig.raceNum === lapsSig.raceNum &&
              groupSig.venue === lapsSig.venue;
          })
        : [];
      // Prefer format-matching candidate, fall back to first match
      const matchingGroup =
        candidates.find((g) => lapsIsGrcup ? g.format === "grcup" : g.format === "sro") ||
        candidates[0] ||
        null;
      if (matchingGroup) {
        pending.groupKey = matchingGroup.id;
        pending.format = matchingGroup.format;
        mergeIntoGroup(groups, pending);
      } else {
        unmatched.push(pending);
      }
    } else {
      // IMSA PDFs and CSVs → attach to first IMSA group
      const imsaGroup = Array.from(groups.values()).find((g) => g.format === "imsa");
      if (imsaGroup) {
        pending.groupKey = imsaGroup.id;
        mergeIntoGroup(groups, pending);
      } else {
        unmatched.push(pending);
      }
    }
  }

  // Recalculate completeness for all groups
  for (const [id, group] of groups) {
    const { complete, missingRequired } = checkCompleteness(group);
    groups.set(id, { ...group, complete, missingRequired });
  }

  return { groups, unmatched, unsupported };
}

// ─── Build files payload for API ─────────────────────────────────────────────

export function buildFilesPayload(group: RaceGroup): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [fileType, df] of group.files) {
    const slotKey = FILE_TYPE_TO_SLOT[fileType];
    if (slotKey && slotKey !== "unknown") {
      files[slotKey] = df.content;
    }
  }
  return files;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function mergeIntoGroup(groups: Map<string, RaceGroup>, detected: DetectedFile) {
  const gKey = detected.groupKey!;
  if (!groups.has(gKey)) {
    const defaultMeta: RaceGroupMetadata = {
      name: detected.metadata.name || "",
      date: detected.metadata.date || "",
      track: detected.metadata.track || "",
      series: detected.metadata.series || "",
      season: detected.metadata.season || String(new Date().getFullYear()),
    };
    groups.set(gKey, {
      id: gKey,
      format: detected.format!,
      metadata: defaultMeta,
      files: new Map(),
      complete: false,
      missingRequired: [],
      validation: null,
      importStatus: "idle",
    });
  }

  const group = groups.get(gKey)!;

  // For timeCardsJson, Time Cards files take priority — don't let a
  // fallback (unknown-name) file overwrite a Time Cards file
  if (detected.type === "timeCardsJson" && group.files.has("timeCardsJson")) {
    const fn = detected.file.name.toLowerCase();
    if (!/time[_\s]cards/i.test(fn)) {
      return; // don't overwrite with a lower-priority file
    }
  }

  group.files.set(detected.type, detected);

  // Merge metadata (fill in missing fields)
  for (const [k, v] of Object.entries(detected.metadata)) {
    if (v && !(group.metadata as any)[k]) {
      (group.metadata as any)[k] = v;
    }
  }
}

function checkCompleteness(group: RaceGroup): { complete: boolean; missingRequired: string[] } {
  const required = REQUIRED_SLOTS[group.format] || [];
  const missingRequired: string[] = [];
  const hasCsv = group.files.has("timeCardsCsv" as FileType);
  for (const slot of required) {
    if (!group.files.has(slot)) {
      // timeCardsJson is satisfied when timeCardsCsv is present instead
      if (slot === "timeCardsJson" && hasCsv) continue;
      missingRequired.push(FILE_TYPE_LABELS[slot]);
    }
  }
  // Empty timeCardsJson (has warning) requires timeCardsCsv as fallback
  const tcJson = group.files.get("timeCardsJson" as FileType);
  if (tcJson?.warning && !hasCsv) {
    missingRequired.push(FILE_TYPE_LABELS["timeCardsCsv" as FileType]);
  }
  return { complete: missingRequired.length === 0, missingRequired };
}

/** Extract IMSA session metadata from a string peek (first ~2000 chars) using regex.
 *  The session object always appears at the start of every IMSA JSON file. */
function extractImsaMetadataFromPeek(peek: string): Partial<RaceGroupMetadata> & { _sessionDate?: string } {
  const meta: Partial<RaceGroupMetadata> & { _sessionDate?: string } = {};

  const eventName = peek.match(/"event_name"\s*:\s*"([^"]+)"/);
  if (eventName) meta.name = eventName[1];

  const circuit = peek.match(/"circuit"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
  if (circuit) meta.track = circuit[1];

  const championship = peek.match(/"championship_name"\s*:\s*"([^"]+)"/);
  if (championship) {
    meta.series = /imsa/i.test(championship[1]) ? "IMSA" : championship[1];
  }

  const sessionDate = peek.match(/"session_date"\s*:\s*"([^"]+)"/);
  if (sessionDate) {
    meta._sessionDate = sessionDate[1]; // raw value for groupKey
    const dm = sessionDate[1].match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (dm) {
      meta.date = `${dm[3]}-${dm[2]}-${dm[1]}`;
      meta.season = dm[3];
    }
  }

  return meta;
}

function extractSpeedhiveMetadata(filename: string, content: string): Partial<RaceGroupMetadata> {
  const meta: Partial<RaceGroupMetadata> = { series: "WRL" };
  const fn = filename.replace(/\.csv$/i, "");

  const shMatch = fn.match(/speedhive_(\w+?)_(\d+)_hour_/i);
  if (shMatch) {
    const day = shMatch[1].charAt(0).toUpperCase() + shMatch[1].slice(1).toLowerCase();
    meta.name = `${day} ${shMatch[2]}-Hour`;
  }

  const segments = fn.split(/_-_/);
  if (segments.length >= 3) {
    const trackName = segments[1].replace(/_/g, " ").trim();
    if (trackName) meta.track = trackName;
  }

  const dateInFn = fn.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateInFn) {
    meta.date = dateInFn[1];
    meta.season = dateInFn[1].split("-")[0];
  }

  if (!meta.date) {
    const lines = content.split("\n");
    const header = lines[0] || "";
    const cols = header.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const todIdx = cols.findIndex((c) => /time\s*of\s*day/i.test(c));
    if (todIdx >= 0 && lines.length > 1) {
      const firstRow = lines[1].split(",");
      const todVal = (firstRow[todIdx] || "").replace(/^"|"$/g, "").trim();
      const isoMatch = todVal.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        meta.date = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
        meta.season = isoMatch[1];
      }
    }
  }

  return meta;
}

/** Derive display metadata from an Alkamel event key.
 *  e.g. key "RACE_1_COTA", series "SRO" → { series: "SRO", track: "COTA", name: "SRO Race 1 — COTA" }
 *  Track is the trailing all-caps token(s). Race number from "RACE_N". */
function extractAlkamelMetadata(eventKey: string, series: string): Partial<RaceGroupMetadata> {
  const meta: Partial<RaceGroupMetadata> = { series };

  // Extract track: last underscore-separated token(s) that are all-caps (skip RACE and digits)
  const tokens = eventKey.split("_");
  const capsTokens: string[] = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^[A-Z][A-Z0-9]*$/.test(tokens[i]) && tokens[i] !== "RACE") {
      capsTokens.unshift(tokens[i]);
    } else {
      break;
    }
  }
  const track = capsTokens.length > 0 ? capsTokens.join(" ") : "";
  if (track) meta.track = track;

  // Extract race number from "Race_N"
  const raceNum = eventKey.match(/Race_(\d+)/i);
  const seriesLabel = series === "GR_CUP" ? "GR Cup" : series;
  if (raceNum && track) {
    meta.name = `${seriesLabel} Race ${raceNum[1]} — ${track}`;
  } else if (raceNum) {
    meta.name = `${seriesLabel} Race ${raceNum[1]}`;
  }

  return meta;
}

/** Normalize an Alkamel event key to a canonical form for comparison.
 *  Trims, replaces whitespace with underscores, collapses runs, uppercases. */
function normalizeEventKey(raw: string): string {
  return raw.trim().replace(/\s+/g, "_").replace(/_+/g, "_").toUpperCase();
}

/** Extract the race number and trailing venue code from a normalized event key.
 *  e.g. "RACE_1_OFFICIAL_COTA" → { raceNum: "1", venue: "COTA" }
 *  e.g. "RACE_1_GRCUP_COTA"   → { raceNum: "1", venue: "COTA" }
 *  Venue is always the last token. Returns null if no Race_N pattern found. */
function extractRaceSignature(key: string): { raceNum: string; venue: string } | null {
  const m = key.match(/RACE_(\d+)/);
  if (!m) return null;
  const tokens = key.split("_");
  const venue = tokens[tokens.length - 1];
  return { raceNum: m[1], venue };
}

/** Extract a grouping key from Alkamel CSV filenames.
 *  e.g. "05_Provisional_Results_by_Class_Race_1_COTA.csv" → "RACE_1_COTA"
 *  Falls back to full filename (minus extension) if no pattern matches.
 *  Always returns a normalized uppercase key. */
function extractAlkamelEventKey(filename: string): string {
  const fn = filename.replace(/\.csv$/i, "");
  // Try to extract "Race_N_VENUE" or "Race N VENUE" pattern
  const raceMatch = fn.match(/(Race[\s_]\d+.*)/i);
  if (raceMatch) return normalizeEventKey(raceMatch[1]);
  // Strip leading number prefix (e.g. "05_" or "23_")
  return normalizeEventKey(fn.replace(/^\d+_/, ""));
}

function extractWrlWebsiteMetadata(filename: string, _content: string): Partial<RaceGroupMetadata> {
  const meta: Partial<RaceGroupMetadata> = { series: "WRL" };
  const fn = filename.replace(/\.csv$/i, "");

  // Date: YYYY-MM-DD or YYYYMMDD before _summary/_all_laps
  const isoDate = fn.match(/(\d{4})-(\d{2})-(\d{2})/);
  const compactDate = fn.match(/(\d{4})(\d{2})(\d{2})(?:_(?:summary|all_laps))/);
  if (isoDate) {
    meta.date = isoDate[0];
    meta.season = isoDate[1];
  } else if (compactDate) {
    meta.date = `${compactDate[1]}-${compactDate[2]}-${compactDate[3]}`;
    meta.season = compactDate[1];
  }

  // Race name: extract Day and N from "{Day}_{N}_hour" → "Saturday 8-Hour"
  const dayHourMatch = fn.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)_(\d+)_hour/i);
  if (dayHourMatch) {
    const dayMatch = fn.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i)!;
    const day = dayMatch[1].charAt(0).toUpperCase() + dayMatch[1].slice(1).toLowerCase();
    meta.name = `${day} ${dayHourMatch[1]}-Hour`;
  }

  // Track: everything between "World_Racing_League_" and the first day-of-week word
  const trackMatch = fn.match(
    /World_Racing_League_(.+?)_(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i
  );
  if (trackMatch) {
    let track = trackMatch[1];
    // Strip trailing year (_2026), _Championship, _Endurance
    track = track.replace(/(_\d{4}|_Championship|_Endurance)+$/i, "");
    // Strip trailing duplicate short venue word (e.g. _Barber when "Barber" already appears earlier)
    const parts = track.split("_");
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (parts.slice(0, -1).some((p) => p.toLowerCase() === last.toLowerCase())) {
        parts.pop();
        track = parts.join("_");
      }
    }
    meta.track = track.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  }

  return meta;
}

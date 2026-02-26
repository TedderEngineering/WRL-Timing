// ─── Types ───────────────────────────────────────────────────────────────────

export type FileType =
  | "lapChartJson"
  | "flagsJson"
  | "pitStopJson"
  | "summaryCsv"
  | "lapsCsv"
  | "flagsPdf"
  | "unknown";

export type FormatId = "imsa" | "speedhive" | "wrl-website";

export interface DetectedFile {
  file: File;
  content: string;
  type: FileType;
  format: FormatId | null;
  groupKey: string | null;
  metadata: Partial<RaceGroupMetadata>;
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
  imsa: ["lapChartJson"],
  speedhive: ["summaryCsv", "lapsCsv"],
  "wrl-website": ["summaryCsv", "lapsCsv"],
};

/** Maps internal FileType to the server-side slot key */
export const FILE_TYPE_TO_SLOT: Record<FileType, string> = {
  lapChartJson: "lapChartJson",
  flagsJson: "flagsJson",
  pitStopJson: "pitStopJson",
  summaryCsv: "summaryCsv",
  lapsCsv: "lapsCsv",
  flagsPdf: "flagsJson", // PDF flags map to flagsJson slot (server handles base64)
  unknown: "unknown",
};

export const FILE_TYPE_LABELS: Record<FileType, string> = {
  lapChartJson: "Lap Chart JSON",
  flagsJson: "Flags & RC Messages JSON",
  pitStopJson: "Pit Stops JSON",
  summaryCsv: "Summary CSV",
  lapsCsv: "All Laps CSV",
  flagsPdf: "Flags PDF",
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
    result.type = "flagsPdf";
    result.format = "imsa";
    // Group with any existing IMSA group (resolved later in classifyFiles)
    result.groupKey = "__pdf_pending__";
    return result;
  }

  // JSON detection
  if (file.name.toLowerCase().endsWith(".json")) {
    try {
      const json = JSON.parse(clean);

      if (json.participants && Array.isArray(json.participants) && json.participants[0]?.laps) {
        result.type = "lapChartJson";
        result.format = "imsa";
        if (json.session) {
          result.groupKey = `${json.session.event_name || ""}|${json.session.session_date || ""}`;
          result.metadata = extractImsaMetadata(json.session);
        }
        return result;
      }

      if (json.flags && Array.isArray(json.flags)) {
        result.type = "flagsJson";
        result.format = "imsa";
        if (json.session) {
          result.groupKey = `${json.session.event_name || ""}|${json.session.session_date || ""}`;
          result.metadata = extractImsaMetadata(json.session);
        }
        return result;
      }

      if (json.pit_stop_analysis && Array.isArray(json.pit_stop_analysis)) {
        result.type = "pitStopJson";
        result.format = "imsa";
        if (json.session) {
          result.groupKey = `${json.session.event_name || ""}|${json.session.session_date || ""}`;
          result.metadata = extractImsaMetadata(json.session);
        }
        return result;
      }
    } catch {
      // Not valid JSON
    }
  }

  // CSV detection — check headers to distinguish WRL Website vs SpeedHive
  if (file.name.toLowerCase().endsWith(".csv")) {
    const headerLine = clean.split("\n")[0] || "";
    const headerLower = headerLine.toLowerCase();

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
  existingUnmatched: DetectedFile[]
): Promise<{ groups: Map<string, RaceGroup>; unmatched: DetectedFile[] }> {
  const groups = new Map(existingGroups);
  const unmatched = [...existingUnmatched];
  const pendingPdfs: DetectedFile[] = [];

  for (const file of files) {
    try {
      const content = await readFileContent(file);
      const detected = classifyFile(file, content);

      if (detected.type === "unknown" || !detected.format) {
        unmatched.push(detected);
        continue;
      }

      // PDFs wait for IMSA group resolution
      if (detected.groupKey === "__pdf_pending__") {
        pendingPdfs.push(detected);
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

  // Resolve pending PDFs: attach to first IMSA group, or leave unmatched
  for (const pdf of pendingPdfs) {
    const imsaGroup = Array.from(groups.values()).find((g) => g.format === "imsa");
    if (imsaGroup) {
      pdf.groupKey = imsaGroup.id;
      mergeIntoGroup(groups, pdf);
    } else {
      unmatched.push(pdf);
    }
  }

  // Recalculate completeness for all groups
  for (const [id, group] of groups) {
    const { complete, missingRequired } = checkCompleteness(group);
    groups.set(id, { ...group, complete, missingRequired });
  }

  return { groups, unmatched };
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
  for (const slot of required) {
    if (!group.files.has(slot)) {
      missingRequired.push(FILE_TYPE_LABELS[slot]);
    }
  }
  return { complete: missingRequired.length === 0, missingRequired };
}

function extractImsaMetadata(session: any): Partial<RaceGroupMetadata> {
  const meta: Partial<RaceGroupMetadata> = {};
  if (session.event_name) meta.name = session.event_name;
  if (session.circuit?.name) meta.track = session.circuit.name;
  if (session.championship_name) {
    meta.series = /imsa/i.test(session.championship_name) ? "IMSA" : session.championship_name;
  }
  if (session.session_date) {
    const dm = session.session_date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
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

  // Track: text between "World_Racing_League_" and the day/hour portion
  // Handles both _-_ separator and __ (double underscore)
  const trackMatch = fn.match(/World_Racing_League_(.+?)(?:_-_|__)/i);
  if (trackMatch) {
    meta.track = trackMatch[1].replace(/_/g, " ");
  }

  return meta;
}

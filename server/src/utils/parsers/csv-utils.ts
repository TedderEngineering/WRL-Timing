/**
 * Shared CSV parsing utilities for all data format parsers.
 */

/**
 * Parse a CSV string into rows. Handles quoted fields and CRLF.
 * Returns [headers, ...dataRows] where each row is a string array.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        current.push(field.trim());
        field = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        current.push(field.trim());
        field = "";
        if (current.length > 1 || current[0] !== "") {
          rows.push(current);
        }
        current = [];
        if (ch === "\r") i++;
      } else {
        field += ch;
      }
    }
  }

  current.push(field.trim());
  if (current.length > 1 || current[0] !== "") {
    rows.push(current);
  }

  return rows;
}

/**
 * Map header names to column indices, case-insensitive and trimmed.
 */
export function mapHeaders(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    map.set(headers[i].trim().toLowerCase(), i);
  }
  return map;
}

/**
 * Get a column value from a row by header name (case-insensitive).
 */
export function col(row: string[], hdr: Map<string, number>, name: string): string {
  const idx = hdr.get(name.toLowerCase());
  if (idx === undefined || idx >= row.length) return "";
  return row[idx].trim();
}

/**
 * Parse a delimited CSV/TSV string with auto-detected delimiter.
 * Strips BOM, handles trailing delimiters, trims whitespace from all values.
 * Returns [headers, ...dataRows] where each row is a string array.
 *
 * Delimiter detection order: semicolon (;), tab (\t), comma (,).
 */
export function parseDelimitedCSV(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/)[0] || "";

  // Auto-detect delimiter from first line
  const delim =
    delimiter ||
    (firstLine.includes(";") ? ";" : firstLine.includes("\t") ? "\t" : ",");

  const lines = clean.split(/\r?\n/);
  const rows: string[][] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // Split on delimiter, handle quoted fields
    const fields: string[] = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    // Push last field (but skip if empty from trailing delimiter)
    const trimmed = field.trim();
    if (trimmed || fields.length === 0) {
      fields.push(trimmed);
    }

    if (fields.length > 1 || fields[0] !== "") {
      rows.push(fields);
    }
  }

  return rows;
}

/**
 * Parse a "M:SS.mmm", "H:MM:SS.mmm", or "SS.mmm" lap time string into seconds.
 */
export function parseLapTime(lt: string): number {
  if (!lt || lt.trim() === "") return 0;
  const clean = lt.trim();

  const parts = clean.split(":");
  if (parts.length === 3) {
    // H:MM:SS.mmm
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    if (isNaN(h) || isNaN(m) || isNaN(s)) return 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    // M:SS.mmm
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    if (isNaN(m) || isNaN(s)) return 0;
    return m * 60 + s;
  }

  // SS.mmm
  const val = parseFloat(clean);
  return isNaN(val) ? 0 : val;
}

// ─── Pit Stop Detection (flags-based for WRL) ───────────────────────────────

/**
 * Flags-based pit detection for WRL races.
 *
 * Uses authoritative flag period data from Redmist flags CSV to classify
 * each lap into its true flag condition (Green/Yellow/Red/Checkered).
 *
 * GREEN period:     ltSec > carGreenMedian * 1.42 → pit stop (definitive)
 * YELLOW period:    ltSec > yellowP25 * 1.40 → pit stop under yellow
 * RED period:       excluded — never a pit
 * CHECKERED period: excluded — race over
 * Any period:       ltSec > 900 (non-RED, non-Checkered) → garage stay
 *
 * Falls back to per-car threshold detection when no flag data is available.
 */

// ─── Thresholds ─────────────────────────────────────────────────────────────

export const GREEN_PIT_THRESHOLD = 1.42;
export const YELLOW_PIT_THRESHOLD = 1.40;     // multiplier against P25 caution floor
export const YELLOW_P25_PERCENTILE = 0.25;    // 25th percentile for caution floor
export const GREEN_MEDIAN_OUTLIER_CAP = 400;  // exclude laps > 400s from green median
export const GARAGE_THRESHOLD_SECONDS = 900;
export const PIT_GROUP_GAP = 2;

// Legacy constant kept for backward-compat wrapper (findSlowGroups)
const FCY_PIT_THRESHOLD = 1.50;

// ─── Flag Period Types ──────────────────────────────────────────────────────

export type FlagType = "Green" | "Yellow" | "Red" | "Checkered" | "Unknown";

export interface FlagPeriod {
  flag: FlagType;
  startSec: number;   // elapsed seconds from race start
  endSec: number;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type PitDetectLapRow = {
  l: number;
  ltSec: number;
  flag: string;
  p: number;
  pit?: number;
};

export interface PitDetectionResult {
  pitLaps: Set<number>;
  garageLaps: Set<number>;
}

// ─── Core Helpers ───────────────────────────────────────────────────────────

export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Build per-car cumulative time maps (seconds). */
function buildCumulativeTime(
  allCarLaps: Map<string, PitDetectLapRow[]>
): Map<string, Map<number, number>> {
  const result = new Map<string, Map<number, number>>();
  for (const [carNum, laps] of allCarLaps) {
    const map = new Map<number, number>();
    let cumSec = 0;
    for (const r of laps) {
      cumSec += r.ltSec;
      map.set(r.l, cumSec);
    }
    result.set(carNum, map);
  }
  return result;
}

// ─── Flags CSV Parser ───────────────────────────────────────────────────────

/**
 * Parse the Redmist flags CSV into FlagPeriod list.
 * Race start = Start of first Green row.
 * Rows with empty or unrecognized Flag are discarded.
 */
export interface FlagsParseResult {
  periods: FlagPeriod[];
  raceStartMs: number;  // wall-clock ms of first Green start (for timestamp conversion)
}

export function parseFlagsCSV(csvText: string): FlagsParseResult {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return { periods: [], raceStartMs: 0 };

  const hdr = mapHeaders(rows[0]);
  const flagIdx = hdr.get("flag");
  const startIdx = hdr.get("start");
  const endIdx = hdr.get("end");
  if (flagIdx === undefined || startIdx === undefined || endIdx === undefined) {
    return { periods: [], raceStartMs: 0 };
  }

  const raw: Array<{ flag: FlagType; startMs: number; endMs: number }> = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const flagStr = (row[flagIdx] ?? "").trim();
    if (!flagStr) continue;
    const flag = normalizeFlagName(flagStr);
    if (flag === "Unknown") continue;
    const startMs = parseDateTimeMs(row[startIdx] ?? "");
    const endMs = parseDateTimeMs(row[endIdx] ?? "");
    if (startMs === 0 || endMs === 0) continue;
    raw.push({ flag, startMs, endMs });
  }

  if (raw.length === 0) return { periods: [], raceStartMs: 0 };

  const firstGreen = raw.find(r => r.flag === "Green");
  const raceStartMs = firstGreen ? firstGreen.startMs : raw[0].startMs;

  const periods = raw.map(r => ({
    flag: r.flag,
    startSec: (r.startMs - raceStartMs) / 1000,
    endSec: (r.endMs - raceStartMs) / 1000,
  }));

  return { periods, raceStartMs };
}

function normalizeFlagName(s: string): FlagType {
  const lower = s.toLowerCase().trim();
  if (lower === "green") return "Green";
  if (lower === "yellow" || lower === "caution" || lower === "fcy") return "Yellow";
  if (lower === "red") return "Red";
  if (lower === "checkered" || lower === "finish") return "Checkered";
  return "Unknown";
}

function parseDateTimeMs(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  const ms = new Date(trimmed).getTime();
  return isNaN(ms) ? 0 : ms;
}

/**
 * Given a lap's cumulative crossing time (seconds from race start),
 * return the authoritative flag at that moment.
 */
export function flagAtElapsed(
  elapsedSec: number,
  periods: FlagPeriod[]
): FlagType {
  for (const p of periods) {
    if (elapsedSec >= p.startSec && elapsedSec <= p.endSec) return p.flag;
  }
  let closest: FlagPeriod | null = null;
  for (const p of periods) {
    if (p.endSec < elapsedSec) {
      if (!closest || p.endSec > closest.endSec) closest = p;
    }
  }
  return closest?.flag ?? "Unknown";
}

/**
 * For a yellow period, compute the P25 caution floor pace.
 * Collects all laps from all cars whose crossing time falls in this window.
 * Takes the 25th percentile (< 600s only). Returns null if < 5 laps.
 */
export function yellowP25Pace(
  period: FlagPeriod,
  allCarLaps: Map<string, PitDetectLapRow[]>,
  cumTimes: Map<string, Map<number, number>>
): number | null {
  const times: number[] = [];
  for (const [carNum, laps] of allCarLaps) {
    const ct = cumTimes.get(carNum);
    if (!ct) continue;
    for (const r of laps) {
      if (r.ltSec <= 1 || r.ltSec >= 600) continue;
      const cumSec = ct.get(r.l) ?? 0;
      if (cumSec >= period.startSec && cumSec <= period.endSec) {
        times.push(r.ltSec);
      }
    }
  }
  if (times.length < 5) return null;
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length * YELLOW_P25_PERCENTILE)];
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Detect pit stops for all WRL cars using authoritative flag periods.
 * When flagPeriods is absent or empty, falls back to per-car threshold detection.
 */
export function detectAllCarPitStops(
  allCarLaps: Map<string, PitDetectLapRow[]>,
  classes: Map<string, string>,
  flagPeriods?: FlagPeriod[]
): Map<string, PitDetectionResult> {
  // Fallback: no flag data → per-car threshold detection
  if (!flagPeriods || flagPeriods.length === 0) {
    const result = new Map<string, PitDetectionResult>();
    for (const [carNum, laps] of allCarLaps) {
      result.set(carNum, detectPitStopsWRL(laps));
    }
    return result;
  }

  const result = new Map<string, PitDetectionResult>();
  const cumTimes = buildCumulativeTime(allCarLaps);

  // Pre-compute per-car green medians using authoritative flag periods
  const allGreenMedians = new Map<string, number>();
  for (const [carNum, laps] of allCarLaps) {
    const ct = cumTimes.get(carNum);
    if (!ct) { allGreenMedians.set(carNum, 0); continue; }
    const greenTimes = laps
      .filter(r => {
        if (r.ltSec <= 1 || r.ltSec > GREEN_MEDIAN_OUTLIER_CAP) return false;
        const cumSec = ct.get(r.l) ?? 0;
        return flagAtElapsed(cumSec, flagPeriods) === "Green";
      })
      .map(r => r.ltSec);
    allGreenMedians.set(carNum, greenTimes.length > 0 ? medianOf(greenTimes) : 0);
  }

  // Pre-compute P25 caution pace for each yellow period
  const yellowPeriods = flagPeriods.filter(p => p.flag === "Yellow");
  const yellowP25Map = new Map<FlagPeriod, number | null>();
  for (const yp of yellowPeriods) {
    yellowP25Map.set(yp, yellowP25Pace(yp, allCarLaps, cumTimes));
  }

  // Process each car
  for (const [carNum, laps] of allCarLaps) {
    const greenMed = allGreenMedians.get(carNum) ?? 0;
    if (greenMed === 0) {
      result.set(carNum, { pitLaps: new Set(), garageLaps: new Set() });
      continue;
    }

    const ct = cumTimes.get(carNum)!;
    const slowSet = new Set<number>();

    for (const r of laps) {
      if (r.ltSec <= 1) continue;
      const cumSec = ct.get(r.l) ?? 0;
      const lapFlag = flagAtElapsed(cumSec, flagPeriods);

      if (lapFlag === "Red" || lapFlag === "Checkered") continue;

      if (lapFlag === "Green" || lapFlag === "Unknown") {
        if (r.ltSec > greenMed * GREEN_PIT_THRESHOLD) slowSet.add(r.l);
      } else if (lapFlag === "Yellow") {
        const yp = yellowPeriods.find(p => cumSec >= p.startSec && cumSec <= p.endSec);
        if (yp) {
          const p25 = yellowP25Map.get(yp);
          if (p25 != null && r.ltSec > p25 * YELLOW_PIT_THRESHOLD) slowSet.add(r.l);
        }
      }
    }

    // Group consecutive slow laps
    const sorted = [...slowSet].sort((a, b) => a - b);
    const groups: number[][] = [];
    if (sorted.length > 0) {
      groups.push([sorted[0]]);
      for (const lap of sorted.slice(1)) {
        const lastGroup = groups[groups.length - 1];
        if (lap <= lastGroup[lastGroup.length - 1] + PIT_GROUP_GAP) {
          lastGroup.push(lap);
        } else {
          groups.push([lap]);
        }
      }
    }

    const pitLaps = new Set<number>();
    const garageLaps = new Set<number>();
    const lapByNum = new Map(laps.map(r => [r.l, r]));

    for (const group of groups) {
      const pitLapNum = group[0];
      const r = lapByNum.get(pitLapNum);
      if (!r) continue;
      pitLaps.add(pitLapNum);
      if (r.ltSec > GARAGE_THRESHOLD_SECONDS) {
        const cumSec = ct.get(r.l) ?? 0;
        const lapFlag = flagAtElapsed(cumSec, flagPeriods);
        if (lapFlag !== "Red" && lapFlag !== "Checkered") garageLaps.add(pitLapNum);
      }
    }

    result.set(carNum, { pitLaps, garageLaps });
  }

  return result;
}

// ─── Backward-compatible wrapper (legacy races without flags CSV) ───────────

/**
 * Single-car threshold-only pit detection. Used when no flag period data
 * is available (legacy uploads, reparse of old races).
 */
export function detectPitStopsWRL(
  laps: Array<{ l: number; ltSec: number; flag: string }>
): PitDetectionResult {
  const greenTimes = laps.filter(r => r.flag === "GREEN" && r.ltSec > 1).map(r => r.ltSec);
  if (greenTimes.length === 0) return { pitLaps: new Set(), garageLaps: new Set() };
  const greenMed = medianOf(greenTimes);

  const withPos = laps.map(r => ({ ...r, p: 1 }));
  const { groups } = findSlowGroups(withPos, greenMed);

  const pitLaps = new Set<number>();
  const garageLaps = new Set<number>();
  const lapByNum = new Map(laps.map(r => [r.l, r]));

  for (const group of groups) {
    const pitLapNum = group[0];
    const r = lapByNum.get(pitLapNum);
    if (!r) continue;
    pitLaps.add(pitLapNum);
    if (r.ltSec > GARAGE_THRESHOLD_SECONDS && r.flag !== "RED") {
      garageLaps.add(pitLapNum);
    }
  }

  return { pitLaps, garageLaps };
}

/**
 * Find slow-lap candidates for one car and group them (legacy fallback).
 * GREEN: no upper cap. YELLOW: 600s cap. RED: excluded.
 */
function findSlowGroups(
  laps: PitDetectLapRow[],
  greenMedian: number
): { groups: number[][]; slowSet: Set<number> } {
  const FCY_UPPER_CAP = 600;
  const slowSet = new Set<number>();
  for (const r of laps) {
    if (r.flag === "RED") continue;
    if (r.ltSec <= 1) continue;
    const threshold = r.flag === "GREEN"
      ? greenMedian * GREEN_PIT_THRESHOLD
      : greenMedian * FCY_PIT_THRESHOLD;
    if (r.flag === "GREEN" && r.ltSec > threshold) {
      slowSet.add(r.l);
    } else if (r.flag !== "RED" && r.ltSec > threshold && r.ltSec < FCY_UPPER_CAP) {
      slowSet.add(r.l);
    }
  }

  const sorted = [...slowSet].sort((a, b) => a - b);
  if (sorted.length === 0) return { groups: [], slowSet };

  const groups: number[][] = [[sorted[0]]];
  for (const lap of sorted.slice(1)) {
    const lastGroup = groups[groups.length - 1];
    if (lap <= lastGroup[lastGroup.length - 1] + PIT_GROUP_GAP) {
      lastGroup.push(lap);
    } else {
      groups.push([lap]);
    }
  }
  return { groups, slowSet };
}

// ─── Control Log Parser ─────────────────────────────────────────────────────

export interface ControlLogEvent {
  sequence: number;
  timestampMs: number;       // wall-clock ms
  elapsedSec: number;        // seconds from race start (computed from raceStartMs)
  carNumbers: number[];      // extracted car numbers (from Car_1, Car_2)
  description: string;
  action: string;
  status: string;
  type: "penalty" | "garage_context" | "other";
}

const PENALTY_ACTIONS = new Set([
  "1 lap", "drive through penalty", "stop and go",
  "drive through", "stop & go", "black flag",
]);

/**
 * Parse the Redmist control log CSV into structured events.
 * Filters to actionable events: penalties and garage stop context.
 */
export function parseControlLogCSV(
  csvText: string,
  raceStartMs: number
): ControlLogEvent[] {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];

  const hdr = mapHeaders(rows[0]);
  const seqIdx = hdr.get("sequence");
  const tsIdx = hdr.get("timestamp");
  const car1Idx = hdr.get("car_1");
  const car2Idx = hdr.get("car_2");
  const descIdx = hdr.get("description");
  const actionIdx = hdr.get("action");
  const statusIdx = hdr.get("status");

  if (tsIdx === undefined || descIdx === undefined) return [];

  // Find the control log's own race start time (Green Flag event).
  // The control log may use a different date than the flags CSV (data export quirk),
  // so we compute elapsed time relative to the control log's own Green Flag timestamp.
  let controlLogStartMs = raceStartMs;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const desc = descIdx !== undefined ? (row[descIdx] ?? "").trim().toLowerCase() : "";
    if (desc === "green flag") {
      const ts = parseDateTimeMs((row[tsIdx] ?? "").trim());
      if (ts > 0) { controlLogStartMs = ts; break; }
    }
  }

  const events: ControlLogEvent[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const tsStr = (row[tsIdx] ?? "").trim();
    const timestampMs = parseDateTimeMs(tsStr);
    if (timestampMs === 0) continue;

    const desc = (row[descIdx] ?? "").trim();
    const action = actionIdx !== undefined ? (row[actionIdx] ?? "").trim() : "";
    const status = statusIdx !== undefined ? (row[statusIdx] ?? "").trim() : "";

    // Extract car numbers from Car_1, Car_2 (format: "#120 Team Name" or just "#120")
    const carNumbers: number[] = [];
    for (const idx of [car1Idx, car2Idx]) {
      if (idx === undefined) continue;
      const val = (row[idx] ?? "").trim();
      const match = val.match(/^#?(\d+)/);
      if (match) carNumbers.push(parseInt(match[1], 10));
    }

    // Classify event type
    const actionLower = action.toLowerCase().trim();
    const descLower = desc.toLowerCase();

    let type: ControlLogEvent["type"] = "other";
    if (PENALTY_ACTIONS.has(actionLower)) {
      type = "penalty";
    } else if (descLower.includes("contact") && actionLower !== "no penalty" && PENALTY_ACTIONS.has(actionLower)) {
      type = "penalty";
    } else if (descLower.includes("stopped") && actionLower === "no action needed") {
      type = "garage_context";
    }

    if (type === "other") continue; // skip non-actionable events

    events.push({
      sequence: seqIdx !== undefined ? parseInt((row[seqIdx] ?? "0"), 10) : i,
      timestampMs,
      elapsedSec: controlLogStartMs > 0 ? (timestampMs - controlLogStartMs) / 1000 : 0,
      carNumbers,
      description: desc,
      action,
      status,
      type,
    });
  }

  return events;
}

/**
 * Find the lap number a car was on at a given elapsed time.
 * Returns the lap whose cumulative time first exceeds elapsedSec.
 */
function lapAtElapsedSec(
  laps: Array<{ l: number; ltSec: number }>,
  elapsedSec: number
): number | null {
  let cumSec = 0;
  for (const lap of laps) {
    cumSec += lap.ltSec;
    if (cumSec >= elapsedSec) return lap.l;
  }
  return laps.length > 0 ? laps[laps.length - 1].l : null;
}

/**
 * Enrich annotations with control log events.
 * Adds penalty text to the reasons dict and enriches garage marker labels.
 *
 * @param annotations - mutable annotation dict (modified in place)
 * @param events - parsed control log events
 * @param cars - race data cars (for lap lookup)
 */
export function enrichAnnotationsFromControlLog(
  annotations: Record<string, { reasons: Record<string, string>; pits: any[]; settles: any[] }>,
  events: ControlLogEvent[],
  cars: Record<string, { laps: Array<{ l: number; ltSec: number; pit: number }> }>
): void {
  for (const evt of events) {
    for (const carNum of evt.carNumbers) {
      const carStr = String(carNum);
      const car = cars[carStr];
      const ann = annotations[carStr];
      if (!car || !ann) continue;

      const lapNum = lapAtElapsedSec(car.laps, evt.elapsedSec);
      if (lapNum == null) continue;

      if (evt.type === "penalty") {
        // Find the nearest pit lap at or after the event (within +15 laps).
        // WRL penalties (Drive Through, 1 Lap) are always served during a pit stop.
        let servingLap = lapNum;
        const pitLap = car.laps.find(l => l.l >= lapNum && l.l <= lapNum + 15 && l.pit === 1);
        if (pitLap) {
          servingLap = pitLap.l;
        }

        const lapKey = String(servingLap);
        const penaltyText = `Penalty: ${evt.action}` +
          (evt.description && evt.description.toLowerCase() !== evt.action.toLowerCase()
            ? ` — ${evt.description}` : "");
        const existing = ann.reasons[lapKey];
        ann.reasons[lapKey] = existing
          ? `${existing}; ${penaltyText}`
          : penaltyText;
      } else if (evt.type === "garage_context") {
        // Enrich existing garage marker label with reason text
        const pitMarker = ann.pits.find(
          (p: any) => p.isGarage && Math.abs(p.l - lapNum) <= 3
        );
        if (pitMarker) {
          const reason = evt.description.replace(/\.$/, "").trim();
          if (reason && !pitMarker.lb.includes(reason)) {
            pitMarker.lb = `${pitMarker.lb} — ${reason}`;
          }
        }
      }
    }
  }
}

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

// ─── Pit Stop Detection (lap-time anomaly for WRL) ──────────────────────────

/**
 * Detects pit stops for WRL/SpeedHive lap data using lap-time anomaly.
 *
 * The SpeedHive `In Pit` column is unreliable for WRL data:
 *  - Fires at normal lap times when car passes pit lane sensor (false +)
 *  - Misses pit stops that happen under yellow flag (false -)
 *
 * This function uses lap time relative to the car's green-flag median
 * as the primary signal. Green-flag laps use a lower threshold (1.42x)
 * because there is no caution pace to confuse things. Yellow-flag laps
 * use 1.50x because normal caution pace reaches up to 1.43x.
 * Yellow laps are NOT excluded — WRL teams pit under yellow constantly.
 */
export const GREEN_PIT_THRESHOLD = 1.42; // green flag: any 42%+ slowdown = pit
export const FCY_PIT_THRESHOLD   = 1.50; // yellow flag: keep 1.50x (caution pace reaches 1.43x)
export const GARAGE_THRESHOLD_SECONDS = 900; // > 15 min = extended garage stay
export const PIT_GROUP_GAP             = 2;  // consecutive laps within gap = 1 stop

export interface PitDetectionResult {
  pitLaps: Set<number>;     // all pit laps (normal + garage)
  garageLaps: Set<number>;  // subset: laps > GARAGE_THRESHOLD_SECONDS
}

export function detectPitStopsWRL(
  laps: Array<{ l: number; ltSec: number; flag: string }>
): PitDetectionResult {
  const empty: PitDetectionResult = { pitLaps: new Set(), garageLaps: new Set() };

  // Step 1: baseline = median of GREEN-flag lap times
  const greenTimes = laps
    .filter(r => r.flag === "GREEN" && r.ltSec > 1)
    .map(r => r.ltSec);

  if (greenTimes.length === 0) return empty;

  const greenMedian = medianOf(greenTimes);

  // Step 2: flag slow laps across ALL flag conditions (including Yellow)
  // GREEN: no upper cap — long green laps are car-specific garage stays.
  // YELLOW: 600s cap — long yellow laps are field-wide extended cautions, not pits.
  // RED: excluded entirely (race-wide halt).
  const FCY_UPPER_CAP = 600;
  const slowLaps = new Set<number>();
  for (const r of laps) {
    if (r.flag === "RED") continue;      // red flag = race halt, not pit
    if (r.ltSec <= 1) continue;          // missing/invalid time
    const threshold = r.flag === "GREEN"
      ? greenMedian * GREEN_PIT_THRESHOLD
      : greenMedian * FCY_PIT_THRESHOLD;
    if (r.flag === "GREEN" && r.ltSec > threshold) {
      slowLaps.add(r.l);               // no upper cap for green
    } else if (r.flag !== "RED" && r.ltSec > threshold && r.ltSec < FCY_UPPER_CAP) {
      slowLaps.add(r.l);               // 600s cap for yellow (extended FCY filter)
    }
  }

  // Step 3: group consecutive slow laps → one pit stop event
  const sorted = [...slowLaps].sort((a, b) => a - b);
  if (sorted.length === 0) return empty;

  const groups: number[][] = [[sorted[0]]];
  for (const lap of sorted.slice(1)) {
    const lastGroup = groups[groups.length - 1];
    if (lap <= lastGroup[lastGroup.length - 1] + PIT_GROUP_GAP) {
      lastGroup.push(lap);
    } else {
      groups.push([lap]);
    }
  }

  // Step 4: pit stop lap = first lap of each group
  const pitLaps = new Set(groups.map(g => g[0]));

  // Step 5: identify garage stays (laps exceeding GARAGE_THRESHOLD_SECONDS)
  const lapByNum = new Map(laps.map(r => [r.l, r]));
  const garageLaps = new Set<number>();
  for (const lapNum of pitLaps) {
    const r = lapByNum.get(lapNum);
    if (r && r.ltSec > GARAGE_THRESHOLD_SECONDS) {
      garageLaps.add(lapNum);
    }
  }

  return { pitLaps, garageLaps };
}

export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

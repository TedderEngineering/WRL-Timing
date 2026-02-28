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

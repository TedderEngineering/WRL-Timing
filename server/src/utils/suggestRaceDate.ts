/**
 * Suggest a race date from an Alkamel pit stop PDF.
 *
 * The event header on these PDFs — event name, circuit, date range — is a single
 * embedded raster banner, so none of it is extractable as text. The page footer
 * is real text, however, and carries the moment the report was produced:
 *
 *   "8/22/2026 4:24 PM Page 1 / 2"
 *
 * That is an export timestamp, not a race date, so it is corroborated rather
 * than trusted: the Time Cards CSV's HOUR column gives the clock time of the
 * last recorded lap, and an export made shortly after that puts both on the same
 * day. Observed across IMSA, SRO and GR Cup exports, the report is generated
 * within hours of the checkered flag — but a report re-run days later would be
 * wrong, which is why this returns a suggestion with a confidence rather than an
 * answer, and the caller only ever pre-fills an empty field with it.
 */

import { parseDelimitedCSV, mapHeaders, col } from "./parsers/csv-utils.js";

export interface ExportStamp {
  /** ISO date, YYYY-MM-DD */
  date: string;
  /** Seconds from midnight */
  timeSec: number;
  /** The matched footer text, for display */
  raw: string;
}

export type DateConfidence = "high" | "low" | "none";

export interface DateSuggestion {
  date: string | null;
  exportedAt: string | null;
  sessionEnd: string | null;
  confidence: DateConfidence;
  note: string;
}

const FOOTER = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatClock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${pad(h)}:${pad(m)}`;
}

/** Pull the export timestamp out of an Alkamel PDF's page footer. */
export function extractPdfExportStamp(pdfText: string): ExportStamp | null {
  const m = pdfText.match(FOOTER);
  if (!m) return null;

  const [, mo, day, year, hourRaw, minute, second, meridiem] = m;
  let hour = parseInt(hourRaw, 10);
  if (meridiem) {
    const isPm = meridiem.toUpperCase() === "PM";
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  }
  if (hour > 23) return null;

  const month = parseInt(mo, 10);
  const dayNum = parseInt(day, 10);
  if (month < 1 || month > 12 || dayNum < 1 || dayNum > 31) return null;

  return {
    date: `${year}-${pad(month)}-${pad(dayNum)}`,
    timeSec: hour * 3600 + parseInt(minute, 10) * 60 + (second ? parseInt(second, 10) : 0),
    raw: m[0].trim(),
  };
}

/**
 * Clock time of the last lap recorded in a Time Cards / Alkamel laps CSV,
 * as seconds from midnight. Returns null when the file has no usable HOUR column.
 */
export function latestSessionClock(timeCardsCsv: string): number | null {
  let rows: string[][];
  try {
    rows = parseDelimitedCSV(timeCardsCsv);
  } catch {
    return null;
  }
  if (rows.length < 2) return null;

  const hdr = mapHeaders(rows[0]);
  if (!hdr.has("hour")) return null;

  let latest: number | null = null;
  for (let i = 1; i < rows.length; i++) {
    const hour = col(rows[i], hdr, "hour");
    const m = hour.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    if (!m) continue;
    const sec =
      parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
    if (latest === null || sec > latest) latest = sec;
  }
  return latest;
}

/**
 * Suggest the race date, corroborating the PDF's export stamp against the
 * session's own clock where lap data is available.
 */
export function suggestRaceDate(
  pdfText: string,
  timeCardsCsv?: string
): DateSuggestion {
  const stamp = extractPdfExportStamp(pdfText);
  if (!stamp) {
    return {
      date: null,
      exportedAt: null,
      sessionEnd: null,
      confidence: "none",
      note: "No export timestamp found in the PDF footer.",
    };
  }

  const exportedAt = `${stamp.date} ${formatClock(stamp.timeSec)}`;
  const sessionEndSec = timeCardsCsv ? latestSessionClock(timeCardsCsv) : null;

  if (sessionEndSec === null) {
    return {
      date: stamp.date,
      exportedAt,
      sessionEnd: null,
      confidence: "low",
      note:
        "Taken from the PDF's export timestamp. No lap data was available to " +
        "confirm the report was produced on race day — please verify.",
    };
  }

  const sessionEnd = formatClock(sessionEndSec);

  if (stamp.timeSec >= sessionEndSec) {
    const gapMin = Math.round((stamp.timeSec - sessionEndSec) / 60);
    return {
      date: stamp.date,
      exportedAt,
      sessionEnd,
      confidence: "high",
      note:
        `The last lap was recorded at ${sessionEnd} and the report was exported ` +
        `at ${formatClock(stamp.timeSec)} the same day — ${gapMin} minute(s) later.`,
    };
  }

  return {
    date: stamp.date,
    exportedAt,
    sessionEnd,
    confidence: "low",
    note:
      `The report was exported at ${formatClock(stamp.timeSec)}, before the last ` +
      `lap at ${sessionEnd}, so it was produced on a later day than the race. ` +
      "Please set the date manually.",
  };
}

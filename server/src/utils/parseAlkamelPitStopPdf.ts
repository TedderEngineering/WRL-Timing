/**
 * Alkamel Pit Stop Time Cards PDF parser
 *
 * Parses text extracted from "20_Pit Stops Time Cards" PDFs used by
 * SRO GT4 America and Toyota GR Cup.
 *
 * PDF text layout per car:
 *   <carNumber> <teamName>
 *   <vehicle> <class>
 *   1 HH:MM:SS.mmm HH:MM:SS.mmm M:SS.mmm T:TT.ttt  <inDriver> <outDriver>
 *   2 ...
 *
 * Columns: Nr. | In Time | Out Time | Pit Time | T. Pit Time | In Driver | Out Driver
 * (In Time = pit entry clock time, Out Time = pit exit clock time)
 */

import type { PitStopTimeCard } from "./parsers/position-analysis.js";

interface AlkamelPitStopEntry {
  carNumber: number;
  stops: PitStopTimeCard[];
}

/**
 * Parse a clock timestamp "HH:MM:SS.mmm" into seconds from midnight.
 */
function parseClockTime(raw: string): number {
  const m = raw.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return 0;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
}

/**
 * Parse a pit duration "M:SS.mmm" or "MM:SS.mmm" into seconds.
 */
function parsePitDuration(raw: string): number {
  const m = raw.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return 0;
  return parseInt(m[1]) * 60 + parseFloat(m[2]);
}

/**
 * Parse extracted PDF text into pit stop time cards grouped by car number.
 */
export function parseAlkamelPitStopPdf(text: string): Map<number, PitStopTimeCard[]> {
  const result = new Map<number, PitStopTimeCard[]>();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let currentCarNum: number | null = null;
  let currentStops: PitStopTimeCard[] = [];

  for (const line of lines) {
    // Skip header line
    if (/^Nr\.\s+In Time/i.test(line)) continue;
    if (/^Race\s+\d+\s+Pit Stop/i.test(line)) continue;

    // Car header: starts with a car number followed by team name
    // e.g. "3 JMF Motorsports" or "007 ProSport Competition"
    const carHeaderMatch = line.match(/^(\d+)\s+([A-Z][\w\s&'.,-]+)$/i);
    if (carHeaderMatch) {
      // Check it's not a pit stop row (those start with a small number followed by timestamps)
      const possibleStopCheck = line.match(/^\d+\s+\d+:\d+:\d+/);
      if (!possibleStopCheck) {
        // Save previous car
        if (currentCarNum !== null && currentStops.length > 0) {
          result.set(currentCarNum, currentStops);
        }
        currentCarNum = parseInt(carHeaderMatch[1], 10);
        currentStops = [];
        continue;
      }
    }

    // Vehicle/class line: skip (e.g. "Aston Martin Vantage AMR GT4 EVO Silver")
    // These don't start with a digit followed by a timestamp

    // Pit stop row: <stopNum> <inTime> <outTime> <pitTime> <totalPitTime> <inDriver> <outDriver>
    // e.g. "1 17:30:33.280 17:33:09.732 2:36.452 2:36.452	J. Neudorf J. Webb"
    // The two driver names may be on the same line or separated by tab
    const stopMatch = line.match(
      /^(\d+)\s+(\d+:\d+:\d+\.\d+)\s+(\d+:\d+:\d+\.\d+)\s+(\d+:\d+\.\d+)\s+(\d+:\d+\.\d+)\s+(.+)$/
    );
    if (stopMatch && currentCarNum !== null) {
      const inTime = parseClockTime(stopMatch[2]);
      const outTime = parseClockTime(stopMatch[3]);
      const pitTime = parsePitDuration(stopMatch[4]);

      // Parse driver names from remaining text
      // Format: "J. Neudorf J. Webb" or "J. Webb\tJ. Webb"
      const driverText = stopMatch[6].trim();
      const drivers = parseDriverPair(driverText);

      currentStops.push({
        inTime,
        outTime,
        pitTime,
        inDriverSurname: drivers.inDriver || undefined,
        outDriverSurname: drivers.outDriver || undefined,
        driverChanged: drivers.inDriver !== drivers.outDriver,
      });
      continue;
    }
  }

  // Save last car
  if (currentCarNum !== null && currentStops.length > 0) {
    result.set(currentCarNum, currentStops);
  }

  return result;
}

/**
 * Parse a driver pair string like "J. Neudorf J. Webb" into in/out driver surnames.
 * Handles tab separation and "Initial. Surname Initial. Surname" patterns.
 */
function parseDriverPair(text: string): { inDriver: string; outDriver: string } {
  // Try tab-separated first
  const tabParts = text.split(/\t+/).map((s) => s.trim()).filter(Boolean);
  if (tabParts.length >= 2) {
    return {
      inDriver: extractSurname(tabParts[0]),
      outDriver: extractSurname(tabParts[1]),
    };
  }

  // Try splitting on pattern: "Initial. Surname Initial. Surname"
  // Match: "X. Name" repeated
  const driverPattern = /([A-Z]\.\s*\S+)/g;
  const matches = text.match(driverPattern);
  if (matches && matches.length >= 2) {
    return {
      inDriver: extractSurname(matches[0]),
      outDriver: extractSurname(matches[1]),
    };
  }

  // Fallback: split in half by spaces
  const words = text.split(/\s+/);
  if (words.length >= 4) {
    const mid = Math.floor(words.length / 2);
    return {
      inDriver: extractSurname(words.slice(0, mid).join(" ")),
      outDriver: extractSurname(words.slice(mid).join(" ")),
    };
  }

  return { inDriver: text, outDriver: text };
}

/**
 * Extract surname from a driver name like "J. Neudorf" → "Neudorf"
 */
function extractSurname(name: string): string {
  const trimmed = name.trim();
  // Remove leading initial(s) with dots: "J. ", "J.P. "
  // Require the dot to avoid stripping first letter of surname
  const withoutInitials = trimmed.replace(/^([A-Z]\.\s*)+/, "").trim();
  return withoutInitials || trimmed;
}

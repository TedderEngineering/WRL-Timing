/**
 * Shared Alkamel laps parser for SRO and GR Cup
 *
 * Handles the semicolon-delimited 23_AnalysisEnduranceWithSections CSV
 * used by both SRO GT4 America and Toyota GR Cup (BOM prefix, spaces
 * after semicolons in header).
 */

export interface AlkamelLap {
  carNumber: string;
  lapNumber: number;
  lapTimeSec: number;
  elapsedSec: number;
  flagStatus: string;
  isPit: boolean;
  pitTimeSec: number | null;
  driverName: string;
  carClass: string;
  team: string;
}

/**
 * Parse an "H:MM:SS.sss", "M:SS.sss", or "SS.sss" time string into total seconds.
 * Returns null if the input is empty or whitespace-only.
 */
function parseTimestamp(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  const parts = s.split(":");
  if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const sec = parseFloat(parts[2]);
    if (isNaN(h) || isNaN(m) || isNaN(sec)) return null;
    return h * 3600 + m * 60 + sec;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const sec = parseFloat(parts[1]);
    if (isNaN(m) || isNaN(sec)) return null;
    return m * 60 + sec;
  }

  const val = parseFloat(s);
  return isNaN(val) ? null : val;
}

const FLAG_MAP: Record<string, string> = {
  GF: "GREEN",
  FCY: "FCY",
  FF: "GREEN",
};

/**
 * Parse Alkamel 23_AnalysisEnduranceWithSections CSV into flat lap rows.
 *
 * Column indices (0-indexed after splitting on ";" and trimming):
 *   0:NUMBER  2:LAP_NUMBER  3:LAP_TIME  5:CROSSING_FINISH_LINE_IN_PIT
 *   13:ELAPSED  19:DRIVER_NAME  20:PIT_TIME  21:CLASS  23:TEAM
 *   24:MANUFACTURER  25:FLAG_AT_FL
 */
export function parseAlkamelLaps(csvText: string): AlkamelLap[] {
  const clean = csvText.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/);
  const laps: AlkamelLap[] = [];

  // Skip header row (index 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const cols = line.split(";").map((c) => c.trim());

    const carNumber = cols[0] || "";
    if (!carNumber) continue;

    const lapNumber = parseInt(cols[2], 10);
    if (isNaN(lapNumber) || lapNumber < 1) continue;

    const lapTimeSec = parseTimestamp(cols[3]) ?? 0;
    const elapsedSec = parseTimestamp(cols[13]) ?? 0;
    const flagRaw = (cols[25] || "").toUpperCase();
    const flagStatus = FLAG_MAP[flagRaw] || "GREEN";
    const pitField = (cols[5] || "").trim();
    const isPit = pitField.length > 0;
    const pitTimeSec = parseTimestamp(cols[20] || "");
    const driverName = cols[19] || "";
    const carClass = cols[21] || "";
    const team = cols[23] || "";

    laps.push({
      carNumber,
      lapNumber,
      lapTimeSec,
      elapsedSec,
      flagStatus,
      isPit,
      pitTimeSec,
      driverName,
      carClass,
      team,
    });
  }

  return laps;
}

/**
 * Derive overall and class positions from flat lap rows.
 *
 * For each unique lapNumber group, sort ascending by elapsedSec
 * to assign overallPosition 1..N. Then within each carClass subgroup
 * assign classPosition 1..M.
 *
 * Cars absent from a lap number are omitted (DNF).
 */
export function derivePositions(
  laps: AlkamelLap[]
): (AlkamelLap & { overallPosition: number; classPosition: number })[] {
  // Group by lapNumber
  const byLap = new Map<number, AlkamelLap[]>();
  for (const lap of laps) {
    if (!byLap.has(lap.lapNumber)) byLap.set(lap.lapNumber, []);
    byLap.get(lap.lapNumber)!.push(lap);
  }

  const result: (AlkamelLap & { overallPosition: number; classPosition: number })[] = [];

  for (const [, group] of byLap) {
    // Sort by elapsed time ascending for overall position
    group.sort((a, b) => a.elapsedSec - b.elapsedSec);

    // Assign overall positions
    const withPos = group.map((lap, idx) => ({
      ...lap,
      overallPosition: idx + 1,
      classPosition: 0,
    }));

    // Group by class for class positions
    const byClass = new Map<string, typeof withPos>();
    for (const lap of withPos) {
      if (!byClass.has(lap.carClass)) byClass.set(lap.carClass, []);
      byClass.get(lap.carClass)!.push(lap);
    }

    for (const [, classGroup] of byClass) {
      // Already sorted by elapsed (inherited from overall sort)
      for (let ci = 0; ci < classGroup.length; ci++) {
        classGroup[ci].classPosition = ci + 1;
      }
    }

    result.push(...withPos);
  }

  return result;
}

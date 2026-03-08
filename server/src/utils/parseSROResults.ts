/**
 * SRO GT4 America results CSV parser
 *
 * Auto-detects two Alkamel export formats:
 *
 * Format A — 05_Provisional_Results (CLASS_TYPE header):
 *   0:CLASS_TYPE  1:POS  2:PIC  3:NUMBER  4:TEAM  5:VEHICLE
 *   6:DRIVERS  7:LAPS  8:ELAPSED  12:BEST_LAP_TIME
 *
 * Format B — 03_Results (POSITION header, numbered driver columns):
 *   0:POSITION  1:NUMBER  2:STATUS  3:LAPS  8:FL_TIME
 *   10:TEAM  11:CLASS  14:VEHICLE
 *   26:DRIVER1_FIRSTNAME  27:DRIVER1_SECONDNAME  (11 cols per driver block)
 */

export interface SROEntry {
  carNumber: string;
  teamName: string;
  vehicle: string;
  driverNames: string[];
  carClass: string;
  lapsCompleted: number;
  bestLapTime: string;
  finishPosition: number;
  classPosition: number;
  status: string;
}

export function parseSROResults(csvText: string): SROEntry[] {
  const clean = csvText.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/);
  if (lines.length === 0) return [];

  const headerLower = lines[0].toLowerCase();

  if (headerLower.includes("class_type")) {
    return parseFormat05(lines);
  }
  if (headerLower.includes("position") && headerLower.includes("driver1_firstname")) {
    return parseFormat03(lines);
  }

  // Fallback: try 05_ format
  return parseFormat05(lines);
}

/** 05_Provisional_Results: CLASS_TYPE;POS;PIC;NUMBER;TEAM;VEHICLE;DRIVERS;LAPS;... */
function parseFormat05(lines: string[]): SROEntry[] {
  const entries: SROEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const cols = line.split(";").map((c) => c.trim());

    const carNumber = cols[3] || "";
    if (!carNumber) continue;

    const finishPosition = parseInt(cols[1], 10);
    if (isNaN(finishPosition)) continue;

    const classPosition = parseInt(cols[2], 10) || finishPosition;
    const lapsCompleted = parseInt(cols[7], 10) || 0;
    const driversRaw = cols[6] || "";
    const driverNames = driversRaw
      .split(" / ")
      .map((d) => d.trim())
      .filter(Boolean);

    entries.push({
      carNumber,
      teamName: cols[4] || `Car #${carNumber}`,
      vehicle: cols[5] || "",
      driverNames,
      carClass: cols[0] || "Unknown",
      lapsCompleted,
      bestLapTime: cols[12] || "",
      finishPosition,
      classPosition,
      status: lapsCompleted > 0 ? "Classified" : "DNS",
    });
  }

  return entries;
}

/** 03_Results: POSITION;NUMBER;STATUS;LAPS;...;TEAM;CLASS;...;VEHICLE;...;DRIVER1_FIRSTNAME;... */
function parseFormat03(lines: string[]): SROEntry[] {
  const entries: SROEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const cols = line.split(";").map((c) => c.trim());

    const carNumber = cols[1] || "";
    if (!carNumber) continue;

    const finishPosition = parseInt(cols[0], 10);
    if (isNaN(finishPosition)) continue;

    const lapsCompleted = parseInt(cols[3], 10) || 0;

    // Collect drivers from numbered blocks (11 columns each, starting at col 26)
    const driverNames: string[] = [];
    for (let d = 0; d < 6; d++) {
      const firstIdx = 26 + d * 11;
      const lastIdx = 27 + d * 11;
      const first = (cols[firstIdx] || "").trim();
      const last = (cols[lastIdx] || "").trim();
      if (!first && !last) break;
      const name = `${first} ${last}`.trim();
      if (name) driverNames.push(name);
    }

    entries.push({
      carNumber,
      teamName: cols[10] || `Car #${carNumber}`,
      vehicle: cols[14] || "",
      driverNames,
      carClass: cols[11] || "Unknown",
      lapsCompleted,
      bestLapTime: cols[8] || "",
      finishPosition,
      classPosition: 0, // derived below
      status: cols[2] || (lapsCompleted > 0 ? "Classified" : "DNS"),
    });
  }

  // Derive classPosition: group by class, rank by finishPosition
  const byClass = new Map<string, SROEntry[]>();
  for (const entry of entries) {
    if (!byClass.has(entry.carClass)) byClass.set(entry.carClass, []);
    byClass.get(entry.carClass)!.push(entry);
  }
  for (const [, classEntries] of byClass) {
    classEntries.sort((a, b) => a.finishPosition - b.finishPosition);
    for (let ci = 0; ci < classEntries.length; ci++) {
      classEntries[ci].classPosition = ci + 1;
    }
  }

  return entries;
}

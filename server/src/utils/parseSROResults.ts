/**
 * SRO GT4 America results CSV parser
 *
 * Parses the semicolon-delimited 05_Provisional_Results CSV
 * (BOM prefix, no spaces in header).
 *
 * Column indices (0-indexed):
 *   0:CLASS_TYPE  1:POS  2:PIC  3:NUMBER  4:TEAM  5:VEHICLE
 *   6:DRIVERS  7:LAPS  8:ELAPSED  9:GAP_FIRST  10:GAP_PREVIOUS
 *   11:BEST_LAP_NUM  12:BEST_LAP_TIME  13:BEST_LAP_KPH
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
}

export function parseSROResults(csvText: string): SROEntry[] {
  const clean = csvText.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/);
  const entries: SROEntry[] = [];

  // Skip header row (index 0)
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
    });
  }

  return entries;
}

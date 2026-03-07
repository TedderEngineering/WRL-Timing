/**
 * Toyota GR Cup results CSV parser
 *
 * Parses the semicolon-delimited 00_Results CSV
 * (BOM prefix, single-driver layout).
 *
 * Column indices (0-indexed):
 *   0:POSITION  1:NUMBER  2:STATUS  3:LAPS  4:TOTAL_TIME
 *   5:GAP_FIRST  6:GAP_PREVIOUS  7:FL_LAPNUM  8:FL_TIME  9:FL_KPH
 *   10:TEAM  11:CLASS  12:GROUP  13:DIVISION  14:VEHICLE
 *   26:DRIVER_FIRSTNAME  27:DRIVER_SECONDNAME
 */

export interface GRCupEntry {
  carNumber: string;
  teamName: string;
  vehicle: string;
  driverNames: string[];
  carClass: string;
  group: string;
  lapsCompleted: number;
  bestLapTime: string;
  finishPosition: number;
  classPosition: number;
  status: string;
}

export function parseGRCupResults(csvText: string): GRCupEntry[] {
  const clean = csvText.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/);
  const entries: GRCupEntry[] = [];

  // Skip header row (index 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const cols = line.split(";").map((c) => c.trim());

    const carNumber = cols[1] || "";
    if (!carNumber) continue;

    const finishPosition = parseInt(cols[0], 10);
    if (isNaN(finishPosition)) continue;

    const lapsCompleted = parseInt(cols[3], 10) || 0;
    const firstName = cols[26] || "";
    const lastName = cols[27] || "";
    const driverName = `${firstName} ${lastName}`.trim();

    entries.push({
      carNumber,
      teamName: cols[10] || `Car #${carNumber}`,
      vehicle: cols[14] || "",
      driverNames: driverName ? [driverName] : [],
      carClass: cols[11] || "Unknown",
      group: cols[12] || "",
      lapsCompleted,
      bestLapTime: cols[8] || "",
      finishPosition,
      classPosition: 0, // derived below
      status: cols[2] || "",
    });
  }

  // Derive classPosition: group by CLASS, rank by finishPosition ascending
  const byClass = new Map<string, GRCupEntry[]>();
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

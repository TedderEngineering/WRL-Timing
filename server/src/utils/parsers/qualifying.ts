/**
 * Qualifying session parser for Alkamel CSV (SRO, GR Cup, IMSA)
 *
 * Parses 23_Time Cards qualifying CSVs (semicolon-delimited, BOM-prefixed)
 * into a QualifyingChartData blob with per-car sector splits, best laps,
 * and theoretical best times.
 */

import { parseDelimitedCSV, mapHeaders, col, parseLapTime } from "./csv-utils.js";

// ─── Types (mirrored in shared/types.ts for client use) ─────────────────────

export interface QualifyingLap {
  l: number;
  lt: string;
  ltSec: number;
  s1: number;
  s2: number;
  s3: number;
  s1f: string;
  s2f: string;
  s3f: string;
  s1imp: number;
  s2imp: number;
  s3imp: number;
  flag: string;
  pit: boolean;
  kph?: number;
  lapImp: number;
}

export interface QualifyingCar {
  num: string;
  team: string;
  driver: string;
  cls: string;
  mfr: string;
  laps: QualifyingLap[];
  bestLap: number;
  bestLapNum: number;
  theoreticalBest: number;
  bestS1: number;
  bestS2: number;
  bestS3: number;
}

export interface QualifyingChartData {
  sessionName: string;
  track: string;
  series: string;
  date: string;
  cars: QualifyingCar[];
  classes: string[];
  totalLaps: number;
}

/**
 * Parse an Alkamel qualifying CSV into a QualifyingChartData blob.
 *
 * @param csvText  Raw CSV text (may include BOM)
 * @param sessionName  Session identifier, e.g. "Qualify 2"
 */
export function parseQualifyingCsv(
  csvText: string,
  sessionName: string
): QualifyingChartData {
  const rows = parseDelimitedCSV(csvText);
  if (rows.length < 2) {
    throw new Error("Qualifying CSV has no data rows");
  }

  const headers = rows[0];
  const hdr = mapHeaders(headers);

  // Verify required columns exist
  const required = ["number", "lap_number", "lap_time", "s1_seconds", "s2_seconds", "s3_seconds"];
  for (const name of required) {
    if (!hdr.has(name)) {
      throw new Error(`Missing required column: ${name.toUpperCase()}`);
    }
  }

  // ── Parse rows into laps grouped by car ────────────────────────
  const carLapsMap = new Map<string, QualifyingLap[]>();
  const carMeta = new Map<string, { team: string; driver: string; cls: string; mfr: string }>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const carNumber = col(row, hdr, "number");
    if (!carNumber) continue;

    const lapNumber = parseInt(col(row, hdr, "lap_number"), 10);
    if (isNaN(lapNumber) || lapNumber < 1) continue;

    const lapTimeStr = col(row, hdr, "lap_time");
    if (!lapTimeStr) continue; // skip incomplete/aborted laps

    const ltSec = parseLapTime(lapTimeStr);
    if (ltSec <= 0) continue;

    const s1 = parseFloat(col(row, hdr, "s1_seconds")) || 0;
    const s2 = parseFloat(col(row, hdr, "s2_seconds")) || 0;
    const s3 = parseFloat(col(row, hdr, "s3_seconds")) || 0;

    const s1f = col(row, hdr, "s1") || formatSectorTime(s1);
    const s2f = col(row, hdr, "s2") || formatSectorTime(s2);
    const s3f = col(row, hdr, "s3") || formatSectorTime(s3);

    const s1imp = parseInt(col(row, hdr, "s1_improvement"), 10) || 0;
    const s2imp = parseInt(col(row, hdr, "s2_improvement"), 10) || 0;
    const s3imp = parseInt(col(row, hdr, "s3_improvement"), 10) || 0;
    const lapImp = parseInt(col(row, hdr, "lap_improvement"), 10) || 0;

    const flagRaw = col(row, hdr, "flag_at_fl").toUpperCase();
    const flag = flagRaw === "FCY" ? "FCY" : flagRaw === "SC" ? "SC" : flagRaw === "FF" ? "FF" : "GF";

    const pitField = col(row, hdr, "crossing_finish_line_in_pit");
    const pit = pitField.length > 0 && pitField !== "0";

    const kphStr = col(row, hdr, "kph");
    const kph = kphStr ? parseFloat(kphStr) || undefined : undefined;

    const lap: QualifyingLap = {
      l: lapNumber,
      lt: lapTimeStr,
      ltSec,
      s1, s2, s3,
      s1f, s2f, s3f,
      s1imp, s2imp, s3imp,
      flag,
      pit,
      kph,
      lapImp,
    };

    if (!carLapsMap.has(carNumber)) carLapsMap.set(carNumber, []);
    carLapsMap.get(carNumber)!.push(lap);

    // Store first-seen metadata per car
    if (!carMeta.has(carNumber)) {
      carMeta.set(carNumber, {
        team: col(row, hdr, "team"),
        driver: col(row, hdr, "driver_name"),
        cls: col(row, hdr, "class"),
        mfr: col(row, hdr, "manufacturer"),
      });
    }
  }

  if (carLapsMap.size === 0) {
    throw new Error("No valid qualifying laps found in CSV");
  }

  // ── Build QualifyingCar array with computed stats ──────────────
  const cars: QualifyingCar[] = [];
  let totalLaps = 0;

  for (const [carNumber, laps] of carLapsMap) {
    laps.sort((a, b) => a.l - b.l);
    totalLaps += laps.length;

    const meta = carMeta.get(carNumber)!;

    // Find best lap
    let bestLap = Infinity;
    let bestLapNum = 1;
    for (const lap of laps) {
      if (lap.ltSec < bestLap) {
        bestLap = lap.ltSec;
        bestLapNum = lap.l;
      }
    }

    // Find best sectors (only from laps with valid sector times)
    let bestS1 = Infinity;
    let bestS2 = Infinity;
    let bestS3 = Infinity;
    for (const lap of laps) {
      if (lap.s1 > 0 && lap.s1 < bestS1) bestS1 = lap.s1;
      if (lap.s2 > 0 && lap.s2 < bestS2) bestS2 = lap.s2;
      if (lap.s3 > 0 && lap.s3 < bestS3) bestS3 = lap.s3;
    }

    // Handle edge case: no valid sectors found
    if (bestS1 === Infinity) bestS1 = 0;
    if (bestS2 === Infinity) bestS2 = 0;
    if (bestS3 === Infinity) bestS3 = 0;

    const theoreticalBest = bestS1 + bestS2 + bestS3;

    cars.push({
      num: carNumber,
      team: meta.team,
      driver: meta.driver,
      cls: meta.cls,
      mfr: meta.mfr,
      laps,
      bestLap,
      bestLapNum,
      theoreticalBest,
      bestS1,
      bestS2,
      bestS3,
    });
  }

  // Sort by best lap ascending (pole first)
  cars.sort((a, b) => a.bestLap - b.bestLap);

  // Extract unique classes sorted alphabetically
  const classSet = new Set<string>();
  for (const car of cars) {
    if (car.cls) classSet.add(car.cls);
  }
  const classes = [...classSet].sort();

  return {
    sessionName,
    track: "",   // filled by the route handler from upload metadata
    series: "",  // filled by the route handler from upload metadata
    date: "",    // filled by the route handler from upload metadata
    cars,
    classes,
    totalLaps,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSectorTime(sec: number): string {
  if (sec <= 0) return "0:00.000";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

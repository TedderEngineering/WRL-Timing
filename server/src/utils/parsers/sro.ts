/**
 * SRO GT4 America parser
 *
 * Uses Alkamel timing CSVs (semicolon-delimited):
 *   1. Results CSV (05_Provisional_Results): Entry list with classes, drivers, positions
 *   2. Laps CSV (23_AnalysisEnduranceWithSections): Lap-by-lap timing with elapsed times
 *
 * Pit timing tier: total_only (single mandatory stop in 60-min races)
 */

import type { RaceDataParser } from "./types.js";
import type { RaceDataJson } from "../race-validators.js";
import { generateAnnotations } from "./position-analysis.js";
import { parseSROResults } from "../parseSROResults.js";
import { parseAlkamelLaps, derivePositions } from "../parseAlkamelLaps.js";

export const sroParser: RaceDataParser = {
  id: "sro",
  name: "SRO GT4 America",
  series: "SRO",
  description:
    "Import from SRO Alkamel timing exports. Supports GT4 America results and lap data CSVs.",
  fileSlots: [
    {
      key: "resultsCsv",
      label: "Results CSV (05_Provisional_Results or 03_Results)",
      description:
        "SRO results export with final classification, car numbers, classes, and finishing positions. Preferred but optional — laps CSV carries sufficient data for import.",
      required: false,
    },
    {
      key: "lapsCsv",
      label: "Laps CSV (23_AnalysisEnduranceWithSections…)",
      description:
        "Alkamel lap-by-lap timing data with elapsed times, pit crossings, and flag status.",
      required: true,
    },
  ],

  parse(files) {
    const { resultsCsv, lapsCsv } = files;
    if (!lapsCsv) throw new Error("Missing SRO laps CSV");

    const warnings: string[] = [];

    // ── Parse results for entry metadata (optional — PDF-only imports skip this) ──
    let entryMap = new Map<string, import("../parseSROResults.js").SROEntry>();
    if (resultsCsv) {
      const entries = parseSROResults(resultsCsv);
      if (entries.length === 0) {
        warnings.push("Results CSV contained no entries — using laps data for metadata");
      } else {
        entryMap = new Map(entries.map((e) => [e.carNumber, e]));
      }
    } else {
      warnings.push("No results CSV — positions and metadata derived from laps data");
    }

    // ── Parse laps and derive positions ─────────────────────────
    const rawLaps = parseAlkamelLaps(lapsCsv);
    if (rawLaps.length === 0) throw new Error("No laps found in SRO laps CSV");

    const positionedLaps = derivePositions(rawLaps);

    // ── Build cars record ────────────────────────────────────────
    const cars: RaceDataJson["cars"] = {};
    const classGroups: Record<string, number[]> = {};
    const classCarCounts: Record<string, number> = {};
    let maxLap = 0;

    // Group laps by car
    const lapsByCar = new Map<string, typeof positionedLaps>();
    for (const lap of positionedLaps) {
      if (!lapsByCar.has(lap.carNumber)) lapsByCar.set(lap.carNumber, []);
      lapsByCar.get(lap.carNumber)!.push(lap);
      if (lap.lapNumber > maxLap) maxLap = lap.lapNumber;
    }

    for (const [carNum, carLaps] of lapsByCar) {
      carLaps.sort((a, b) => a.lapNumber - b.lapNumber);

      const entry = entryMap.get(carNum);
      const num = parseInt(carNum, 10);
      if (isNaN(num)) {
        warnings.push(`Non-numeric car number "${carNum}" — skipping`);
        continue;
      }

      const cls = entry?.carClass || carLaps[0]?.carClass || "Unknown";
      const team = entry?.teamName || carLaps[0]?.team || `Car #${num}`;

      cars[String(num)] = {
        num,
        team,
        cls,
        vehicle: entry?.vehicle,
        finishPos: entry?.finishPosition || carLaps[carLaps.length - 1].overallPosition,
        finishPosClass: entry?.classPosition || carLaps[carLaps.length - 1].classPosition,
        laps: carLaps.map((lap) => ({
          l: lap.lapNumber,
          p: lap.overallPosition,
          cp: lap.classPosition,
          lt: formatLapTime(lap.lapTimeSec),
          ltSec: lap.lapTimeSec > 0 ? lap.lapTimeSec : 0.001,
          flag: lap.flagStatus,
          pit: lap.isPit ? 1 : 0,
        })),
      };

      if (!classGroups[cls]) classGroups[cls] = [];
      classGroups[cls].push(num);
      classCarCounts[cls] = (classCarCounts[cls] || 0) + 1;
    }

    // Warn about entries with no laps
    for (const [carNum, entry] of entryMap) {
      const num = parseInt(carNum, 10);
      if (!isNaN(num) && !cars[String(num)]) {
        warnings.push(`Car #${carNum} (${entry.teamName}) in results but has no lap data`);
      }
    }

    const totalCars = Object.keys(cars).length;
    if (totalCars === 0) throw new Error("No valid car data found in SRO CSVs");

    // ── Detect FCY periods ───────────────────────────────────────
    const fcy = detectFcyPeriods(cars, maxLap);

    // ── Green pace cutoff ────────────────────────────────────────
    const greenPaceCutoff = computeGreenPaceCutoff(cars);

    const raceData: RaceDataJson = {
      maxLap,
      totalCars,
      greenPaceCutoff,
      cars,
      fcy,
      classGroups,
      classCarCounts,
    };

    const annotations = generateAnnotations(raceData);

    return { data: raceData, annotations, warnings };
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLapTime(sec: number): string {
  if (sec <= 0) return "0:00.000";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

function detectFcyPeriods(
  cars: RaceDataJson["cars"],
  maxLap: number
): Array<[number, number]> {
  const fcy: Array<[number, number]> = [];
  let fcyStart: number | null = null;

  for (let lap = 1; lap <= maxLap; lap++) {
    let fcyCount = 0;
    let totalCount = 0;

    for (const car of Object.values(cars)) {
      const lapData = car.laps.find((l) => l.l === lap);
      if (lapData) {
        totalCount++;
        if (lapData.flag === "FCY") fcyCount++;
      }
    }

    const isFcy = totalCount > 0 && fcyCount / totalCount > 0.5;
    if (isFcy && fcyStart === null) {
      fcyStart = lap;
    } else if (!isFcy && fcyStart !== null) {
      fcy.push([fcyStart, lap - 1]);
      fcyStart = null;
    }
  }
  if (fcyStart !== null) fcy.push([fcyStart, maxLap]);

  return fcy;
}

function computeGreenPaceCutoff(cars: RaceDataJson["cars"]): number {
  const greenLapTimes: number[] = [];
  for (const car of Object.values(cars)) {
    for (const lap of car.laps) {
      if (lap.flag === "GREEN" && lap.pit === 0 && lap.ltSec > 1) {
        greenLapTimes.push(lap.ltSec);
      }
    }
  }

  if (greenLapTimes.length > 10) {
    greenLapTimes.sort((a, b) => a - b);
    const p95Idx = Math.floor(greenLapTimes.length * 0.95);
    return greenLapTimes[p95Idx] * 1.1;
  }

  return 300;
}

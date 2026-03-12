/**
 * Toyota GR Cup parser
 *
 * Uses Alkamel timing CSVs (semicolon-delimited):
 *   1. Results CSV (00_Results): Entry list with single-driver layout
 *   2. Laps CSV (23_AnalysisEnduranceWithSections): Lap-by-lap timing (same schema as SRO)
 *
 * Pit timing tier: total_only (pit-stop-free format; incidental rows stored but not featured)
 */

import type { RaceDataParser } from "./types.js";
import type { RaceDataJson } from "../race-validators.js";
import type { PitMarker } from "./position-analysis.js";
import { generateAnnotations, enrichPitMarkersWithDrivers, buildKnownDrivers } from "./position-analysis.js";
import { parseGRCupResults } from "../parseGRCupResults.js";
import { parseAlkamelLaps, derivePositions } from "../parseAlkamelLaps.js";

export const grcupParser: RaceDataParser = {
  id: "grcup",
  name: "Toyota GR Cup",
  series: "GR_CUP",
  description:
    "Import from Toyota GR Cup Alkamel timing exports. Results and lap data CSVs.",
  fileSlots: [
    {
      key: "resultsCsv",
      label: "Results CSV (00_Results…)",
      description:
        "GR Cup results export with final classification, car numbers, and single-driver layout.",
      required: true,
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
    if (!resultsCsv) throw new Error("Missing GR Cup results CSV");
    if (!lapsCsv) throw new Error("Missing GR Cup laps CSV");

    const warnings: string[] = [];

    // ── Parse results for entry metadata ────────────────────────
    const entries = parseGRCupResults(resultsCsv);
    if (entries.length === 0) throw new Error("No entries found in GR Cup results CSV");

    const entryMap = new Map(entries.map((e) => [e.carNumber, e]));

    // ── Parse laps and derive positions ─────────────────────────
    const rawLaps = parseAlkamelLaps(lapsCsv);
    if (rawLaps.length === 0) throw new Error("No laps found in GR Cup laps CSV");

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

    // Add DNS/DNF entries to roster with empty laps
    for (const [carNum, entry] of entryMap) {
      const num = parseInt(carNum, 10);
      if (!isNaN(num) && !cars[String(num)]) {
        const rawStatus = entry.status?.toLowerCase() || "";
        const status = rawStatus.includes("not start") || rawStatus === "dns" || entry.lapsCompleted === 0
          ? "DNS" : "DNF";
        warnings.push(`Car #${carNum} (${entry.teamName}) — ${status} (${entry.lapsCompleted} laps completed)`);

        const cls = entry.carClass || "Unknown";
        cars[String(num)] = {
          num,
          team: entry.teamName,
          cls,
          vehicle: entry.vehicle,
          status,
          finishPos: entry.finishPosition,
          finishPosClass: entry.classPosition,
          laps: [],
        };

        if (!classGroups[cls]) classGroups[cls] = [];
        classGroups[cls].push(num);
        classCarCounts[cls] = (classCarCounts[cls] || 0) + 1;
      }
    }

    const totalCars = Object.keys(cars).length;
    if (totalCars === 0) throw new Error("No valid car data found in GR Cup CSVs");

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

    // ── Enrich pit markers with driver names from Alkamel CSV ───
    for (const [carNum, carLaps] of lapsByCar) {
      const num = parseInt(carNum, 10);
      const ann = annotations[String(num)];
      if (!ann?.pits?.length) continue;

      const driverLaps = carLaps.map((lap) => ({
        lap: lap.lapNumber,
        driverName: lap.driverName || undefined,
      }));
      const knownDrivers = buildKnownDrivers(
        carLaps.map((lap) => ({ driverName: lap.driverName || undefined }))
      );
      enrichPitMarkersWithDrivers(ann.pits as PitMarker[], driverLaps, knownDrivers);
    }

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

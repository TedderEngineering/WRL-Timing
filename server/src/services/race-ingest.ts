import { prisma } from "../models/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import {
  raceDataJsonSchema,
  annotationJsonSchema,
  type RaceDataJson,
  type AnnotationJson,
  type RaceMetadata,
} from "../utils/race-validators.js";

interface IngestResult {
  raceId: string;
  entriesCreated: number;
  lapsCreated: number;
  warnings: string[];
}

/**
 * Validate and ingest race data into the database.
 * Creates Race, RaceEntry, and RaceLap records, plus stores the raw JSON
 * for fast chart rendering.
 */
export async function ingestRaceData(
  metadata: RaceMetadata,
  rawData: unknown,
  rawAnnotations: unknown,
  createdBy: string
): Promise<IngestResult> {
  const warnings: string[] = [];

  // ── Validate DATA ────────────────────────────────────────────────
  const dataResult = raceDataJsonSchema.safeParse(rawData);
  if (!dataResult.success) {
    const issues = dataResult.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`
    );
    throw new AppError(
      400,
      `Race data validation failed:\n${issues.join("\n")}`,
      "INVALID_RACE_DATA"
    );
  }
  const data: RaceDataJson = dataResult.data;

  // ── Validate ANN (optional — can be empty) ───────────────────────
  let annotations: AnnotationJson = {};
  if (rawAnnotations && typeof rawAnnotations === "object" && Object.keys(rawAnnotations).length > 0) {
    const annResult = annotationJsonSchema.safeParse(rawAnnotations);
    if (!annResult.success) {
      // Annotations are non-critical — warn but continue
      warnings.push(
        `Annotation data had validation issues: ${annResult.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
      );
    } else {
      annotations = annResult.data;
    }
  }

  // ── Cross-validation ─────────────────────────────────────────────
  const carNums = Object.keys(data.cars);
  if (carNums.length !== data.totalCars) {
    warnings.push(
      `totalCars (${data.totalCars}) doesn't match actual car count (${carNums.length})`
    );
  }

  // Check class groups match cars
  for (const [cls, nums] of Object.entries(data.classGroups)) {
    for (const num of nums) {
      const car = data.cars[String(num)];
      if (!car) {
        warnings.push(`Car #${num} in classGroup "${cls}" not found in car data`);
      } else if (car.cls !== cls) {
        warnings.push(`Car #${num} class "${car.cls}" doesn't match classGroup "${cls}"`);
      }
    }
  }

  // ── Insert into DB (transactional) ───────────────────────────────
  const result = await prisma.$transaction(async (tx) => {
    // Create Race
    const race = await tx.race.create({
      data: {
        name: metadata.name,
        date: metadata.date,
        track: metadata.track,
        series: metadata.series,
        season: metadata.season,
        status: metadata.status,
        premium: metadata.premium,
        maxLap: data.maxLap,
        totalCars: carNums.length,
        createdBy,
        chartData: data as any,
        annotationData: annotations as any,
      },
    });

    // Create RaceEntry records
    const entryData = carNums.map((numStr) => {
      const car = data.cars[numStr];
      return {
        raceId: race.id,
        carNumber: String(car.num),
        teamName: car.team,
        driverNames: "", // not in source data
        carClass: car.cls,
        finishPos: car.finishPos,
        finishPosClass: car.finishPosClass,
        lapsCompleted: car.laps.length,
      };
    });

    await tx.raceEntry.createMany({ data: entryData });

    // Create RaceLap records in batches (can be thousands of rows)
    let totalLaps = 0;
    const BATCH_SIZE = 500;
    let lapBatch: Array<{
      raceId: string;
      carNumber: string;
      lapNumber: number;
      position: number;
      classPosition: number | null;
      lapTimeFormatted: string | null;
      lapTimeSec: number | null;
      lapTimeMs: number | null;
      flag: string | null;
      speed: number | null;
      pitStop: boolean;
    }> = [];

    for (const numStr of carNums) {
      const car = data.cars[numStr];
      for (const lap of car.laps) {
        lapBatch.push({
          raceId: race.id,
          carNumber: String(car.num),
          lapNumber: lap.l,
          position: lap.p,
          classPosition: lap.cp,
          lapTimeFormatted: lap.lt,
          lapTimeSec: lap.ltSec,
          lapTimeMs: Math.round(lap.ltSec * 1000),
          flag: lap.flag,
          speed: lap.spd ?? null,
          pitStop: lap.pit === 1,
        });

        if (lapBatch.length >= BATCH_SIZE) {
          await tx.raceLap.createMany({ data: lapBatch });
          totalLaps += lapBatch.length;
          lapBatch = [];
        }
      }
    }

    // Flush remaining
    if (lapBatch.length > 0) {
      await tx.raceLap.createMany({ data: lapBatch });
      totalLaps += lapBatch.length;
    }

    return {
      raceId: race.id,
      entriesCreated: entryData.length,
      lapsCreated: totalLaps,
    };
  });

  return { ...result, warnings };
}

/**
 * Re-process an existing race's chart data from stored JSON.
 */
export async function reprocessRace(raceId: string): Promise<IngestResult> {
  const race = await prisma.race.findUnique({ where: { id: raceId } });
  if (!race) throw new AppError(404, "Race not found", "RACE_NOT_FOUND");
  if (!race.chartData) {
    throw new AppError(400, "No stored chart data to reprocess", "NO_CHART_DATA");
  }

  // Delete existing entries and laps
  await prisma.$transaction([
    prisma.raceLap.deleteMany({ where: { raceId } }),
    prisma.raceEntry.deleteMany({ where: { raceId } }),
  ]);

  // Re-validate and re-insert
  const data = raceDataJsonSchema.parse(race.chartData);
  const annotations = race.annotationData
    ? annotationJsonSchema.parse(race.annotationData)
    : {};

  const carNums = Object.keys(data.cars);
  const result = await prisma.$transaction(async (tx) => {
    const entryData = carNums.map((numStr) => {
      const car = data.cars[numStr];
      return {
        raceId,
        carNumber: String(car.num),
        teamName: car.team,
        driverNames: "",
        carClass: car.cls,
        finishPos: car.finishPos,
        finishPosClass: car.finishPosClass,
        lapsCompleted: car.laps.length,
      };
    });

    await tx.raceEntry.createMany({ data: entryData });

    let totalLaps = 0;
    const BATCH_SIZE = 500;
    let batch: any[] = [];

    for (const numStr of carNums) {
      const car = data.cars[numStr];
      for (const lap of car.laps) {
        batch.push({
          raceId,
          carNumber: String(car.num),
          lapNumber: lap.l,
          position: lap.p,
          classPosition: lap.cp,
          lapTimeFormatted: lap.lt,
          lapTimeSec: lap.ltSec,
          lapTimeMs: Math.round(lap.ltSec * 1000),
          flag: lap.flag,
          speed: lap.spd ?? null,
          pitStop: lap.pit === 1,
        });

        if (batch.length >= BATCH_SIZE) {
          await tx.raceLap.createMany({ data: batch });
          totalLaps += batch.length;
          batch = [];
        }
      }
    }

    if (batch.length > 0) {
      await tx.raceLap.createMany({ data: batch });
      totalLaps += batch.length;
    }

    return { entriesCreated: entryData.length, lapsCreated: totalLaps };
  });

  return { raceId, ...result, warnings: [] };
}

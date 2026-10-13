/**
 * Machine intake of a raw race (RaceTrace 2.0, G4): idempotent upsert by
 * source key.
 *
 *  1. Same source key and same source version as stored → "unchanged"
 *     (nothing parsed, archived or written).
 *  2. Results never go backwards: provisional over official is refused (409)
 *     unless `force`.
 *  3. Parse with the legacy parser first (garbage is never archived), then
 *     archive every file (race-archive.ts: before any DB write; a failed
 *     archive stops the import), then write in one transaction.
 *  4. An existing race keeps its id (so its URL), name, status, premium flag,
 *     event and round; its chart data, entries, laps, archive paths, version
 *     and results status are replaced. A new race is created as DRAFT.
 */
import { z } from "zod";
import { prisma } from "../models/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import type { ArchiveResult } from "../lib/race-archive.js";
import type { RaceDataParser } from "../utils/parsers/types.js";
import { raceDataJsonSchema, raceMetadataSchema, type RaceDataJson } from "../utils/race-validators.js";
import { findOrCreateEvent, mapSeriesToSanctioningBody } from "./race-ingest.js";
import { canonicalSourceKey, SOURCE_KEY_PATTERN } from "../intake/source-key.js";
import { resultsStatusRank } from "../intake/file-select.js";

export const RESULTS_STATUSES = ["official", "provisional", "unofficial", "unknown", "none"] as const;

export const intakeBodySchema = z.object({
  sourceKey: z.string().max(500).regex(SOURCE_KEY_PATTERN, "Invalid source key"),
  sourceVersion: z.string().min(1).max(200),
  resultsStatus: z.enum(RESULTS_STATUSES),
  format: z.string().min(1).max(50),
  metadata: z.object({
    name: z.string().min(1).max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    track: z.string().min(1).max(200),
    series: z.string().min(1).max(100),
    subSeries: z.string().max(100).optional(),
    season: z.coerce.number().int().min(2000).max(2100),
  }),
  files: z.record(z.string()),
  manifest: z.unknown().optional(),
  force: z.boolean().optional(),
});

export type IntakeBody = z.infer<typeof intakeBodySchema>;

/**
 * Files some parsers require but a machine intake cannot always supply. The
 * Speedhive and WRL-website parsers throw without the Redmist flags CSV and
 * control log, which are not on Speedhive. A header-only table makes the
 * parser fall back to lap-status FCY detection (its own documented path,
 * speedhive.ts "Flags CSV produced no valid flag periods"). Placeholders go to
 * the parser only; they are never archived.
 */
export const PARSER_PLACEHOLDERS: Record<string, Record<string, string>> = {
  speedhive: {
    flagsCsv: "Flag,Start,End,Duration\r\n",
    controlLogCsv: "Sequence,Timestamp,Car_1,Car_2,Description,Action,Status\r\n",
  },
  "wrl-website": {
    flagsCsv: "Flag,Start,End,Duration\r\n",
    controlLogCsv: "Sequence,Timestamp,Car_1,Car_2,Description,Action,Status\r\n",
  },
};

/** Parser input: declared slots only, plus placeholders for missing intake-optional slots. */
export function parserInput(
  parser: Pick<RaceDataParser, "id" | "fileSlots">,
  files: Record<string, string>
): { input: Record<string, string>; placeholders: string[]; missing: string[] } {
  const input: Record<string, string> = {};
  const placeholders: string[] = [];
  const missing: string[] = [];
  const ph = PARSER_PLACEHOLDERS[parser.id] ?? {};
  for (const slot of parser.fileSlots) {
    const v = files[slot.key];
    if (typeof v === "string" && v.length > 0) input[slot.key] = v;
    else if (ph[slot.key]) {
      input[slot.key] = ph[slot.key];
      placeholders.push(slot.key);
    } else if (slot.required) missing.push(`${slot.label} (key: ${slot.key})`);
  }
  return { input, placeholders, missing };
}

export interface IntakeDeps {
  getParser: (format: string) => RaceDataParser | undefined;
  archive: (files: Record<string, unknown>) => Promise<ArchiveResult>;
}

export interface IntakeActor {
  userId: string;
  apiTokenId?: string;
}

export interface IntakeResult {
  action: "created" | "updated" | "unchanged";
  raceId: string;
  sourceKey: string;
  entriesCreated: number;
  lapsCreated: number;
  warnings: string[];
  archived: Record<string, string>;
}

/** The part of a Prisma transaction client the intake writes through. */
export interface IntakeTx {
  race: { update(args: any): Promise<any>; create(args: any): Promise<any> };
  raceEntry: { createMany(args: any): Promise<unknown>; deleteMany(args: any): Promise<unknown> };
  raceLap: { createMany(args: any): Promise<unknown>; deleteMany(args: any): Promise<unknown> };
}
type Tx = IntakeTx;

/** RaceEntry and RaceLap rows from parsed chart data (same mapping as race-ingest.ts). */
export async function insertEntriesAndLaps(tx: Tx, raceId: string, data: RaceDataJson): Promise<{ entries: number; laps: number }> {
  const carNums = Object.keys(data.cars);
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
      lapsCompleted: Array.isArray(car.laps) ? car.laps.length : 0,
    };
  });
  await tx.raceEntry.createMany({ data: entryData });

  let total = 0;
  let batch: any[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    await tx.raceLap.createMany({ data: batch });
    total += batch.length;
    batch = [];
  };
  for (const numStr of carNums) {
    const car = data.cars[numStr];
    if (!Array.isArray(car.laps)) continue;
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
      if (batch.length >= 500) await flush();
    }
  }
  await flush();
  return { entries: entryData.length, laps: total };
}

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";
}

export async function intakeRace(bodyIn: unknown, actor: IntakeActor, deps: IntakeDeps): Promise<IntakeResult> {
  const body = intakeBodySchema.parse(bodyIn);
  let sourceKey: string;
  try {
    sourceKey = canonicalSourceKey(body.sourceKey);
  } catch (e) {
    throw new AppError(400, e instanceof Error ? e.message : "Invalid source key", "INVALID_SOURCE_KEY");
  }
  const parser = deps.getParser(body.format);
  if (!parser) throw new AppError(400, `Unknown format: "${body.format}"`, "UNKNOWN_FORMAT");

  const existing = await prisma.race.findUnique({
    where: { sourceKey },
    select: { id: true, sourceVersion: true, resultsStatus: true, sourceFiles: true },
  });

  const previous = existing ? { resultsStatus: existing.resultsStatus ?? null, sourceFiles: (existing.sourceFiles as unknown) ?? null } : null;

  if (existing && !body.force && existing.sourceVersion === body.sourceVersion) {
    return { action: "unchanged", raceId: existing.id, sourceKey, entriesCreated: 0, lapsCreated: 0, warnings: [], archived: {} };
  }
  if (existing && !body.force && resultsStatusRank(body.resultsStatus) < resultsStatusRank(existing.resultsStatus)) {
    throw new AppError(
      409,
      `The site has ${existing.resultsStatus} results for this race; refusing to replace them with ${body.resultsStatus} results. Send force: true to override.`,
      "RESULTS_DOWNGRADE"
    );
  }

  const { input, placeholders, missing } = parserInput(parser, body.files);
  if (missing.length) throw new AppError(400, `Missing required file(s): ${missing.join("; ")}`, "MISSING_FILE");

  let parsed: Awaited<ReturnType<RaceDataParser["parse"]>>;
  try {
    parsed = await parser.parse(input);
  } catch (e) {
    throw new AppError(400, `Parse failed (${parser.name}): ${e instanceof Error ? e.message : String(e)}`, "PARSE_FAILED");
  }
  const dataResult = raceDataJsonSchema.safeParse(parsed.data);
  if (!dataResult.success) {
    const issues = dataResult.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new AppError(400, `Race data validation failed:\n${issues.join("\n")}`, "INVALID_RACE_DATA");
  }
  const data = dataResult.data;
  const warnings = [...parsed.warnings];
  for (const k of placeholders) warnings.push(`No ${k} supplied: the parser used an empty table (FCY from lap status).`);

  // Archive BEFORE any DB write (G1 / F7). Throws ARCHIVE_FAILED on any failure.
  const archived = await deps.archive(body.files);
  warnings.push(...archived.warnings);
  const sourceFiles = Object.keys(archived.paths).length > 0 ? archived.paths : undefined;
  const carCount = Object.keys(data.cars).length;

  let action: "created" | "updated";
  let raceId: string;
  let counts: { entries: number; laps: number };
  try {
    ({ action, raceId, counts } = await prisma.$transaction(
      async (tx: IntakeTx) => {
        if (existing) {
          await tx.race.update({
            where: { id: existing.id },
            data: {
              chartData: data as any,
              annotationData: parsed.annotations as any,
              maxLap: data.maxLap,
              totalCars: carCount,
              sourceVersion: body.sourceVersion,
              resultsStatus: body.resultsStatus,
              ...(sourceFiles ? { sourceFiles } : {}),
            },
          });
          await tx.raceLap.deleteMany({ where: { raceId: existing.id } });
          await tx.raceEntry.deleteMany({ where: { raceId: existing.id } });
          const c = await insertEntriesAndLaps(tx, existing.id, data);
          return { action: "updated" as const, raceId: existing.id, counts: c };
        }
        const meta = raceMetadataSchema.parse({
          name: body.metadata.name,
          date: body.metadata.date,
          track: body.metadata.track,
          series: body.metadata.series,
          season: body.metadata.season,
          premium: false,
          status: "DRAFT",
        });
        const eventId = await findOrCreateEvent(tx as never, meta);
        const race = await tx.race.create({
          data: {
            name: meta.name,
            date: meta.date,
            track: meta.track,
            series: meta.series,
            sanctioningBody: mapSeriesToSanctioningBody(meta.series),
            season: meta.season,
            status: "DRAFT",
            premium: false,
            maxLap: data.maxLap,
            totalCars: carCount,
            createdBy: actor.userId,
            eventId,
            ...(body.metadata.subSeries ? { subSeries: body.metadata.subSeries } : {}),
            chartData: data as any,
            annotationData: parsed.annotations as any,
            sourceKey,
            sourceVersion: body.sourceVersion,
            resultsStatus: body.resultsStatus,
            ...(sourceFiles ? { sourceFiles } : {}),
          },
        });
        const c = await insertEntriesAndLaps(tx, race.id, data);
        return { action: "created" as const, raceId: race.id, counts: c };
      },
      { timeout: 60000 }
    ));
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new AppError(409, "Another intake created this race at the same moment; run push again to update it.", "SOURCE_KEY_CONFLICT");
    }
    throw e;
  }

  await prisma.auditLog.create({
    data: {
      adminUserId: actor.userId,
      action: action === "created" ? "INTAKE_CREATE_RACE" : "INTAKE_UPDATE_RACE",
      targetType: "race",
      targetId: raceId,
      details: {
        sourceKey,
        sourceVersion: body.sourceVersion,
        resultsStatus: body.resultsStatus,
        previousResultsStatus: previous?.resultsStatus ?? null,
        previousSourceFiles: previous?.sourceFiles ?? null,
        format: body.format,
        parser: parser.name,
        apiTokenId: actor.apiTokenId ?? null,
        files: Object.keys(body.files),
        manifest: (body.manifest as any) ?? null,
        entries: counts.entries,
        laps: counts.laps,
        warnings,
      } as any,
    },
  });

  return { action, raceId, sourceKey, entriesCreated: counts.entries, lapsCreated: counts.laps, warnings, archived: archived.paths };
}

/** Races created by the intake, for `intake discover` to compare against. */
export async function listIntakeRaces(site?: string) {
  const rows = await prisma.race.findMany({
    where: site ? { sourceKey: { startsWith: `${site}:` } } : { sourceKey: { not: null } },
    select: { id: true, name: true, status: true, sourceKey: true, sourceVersion: true, resultsStatus: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r: any) => ({
    sourceKey: r.sourceKey as string,
    sourceVersion: r.sourceVersion ?? null,
    resultsStatus: r.resultsStatus ?? null,
    raceId: r.id,
    name: r.name,
    status: r.status,
    updatedAt: r.updatedAt,
  }));
}

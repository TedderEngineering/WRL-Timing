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
 *  5. `attachToRaceId` claims a race imported before source keys existed (the
 *     admin upload): the race must have no source key, the same series, a
 *     date from a day after to four days before the session, and no clash in
 *     day or race length (unless `force`); it is then updated as in 4 and keeps
 *     the source key from then on. Only ever sent by `intake push --attach`.
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
import { sameSessionTraits } from "../intake/push.js";
import { raceFamily } from "../intake/reimport.js";

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
  attachToRaceId: z.string().min(1).max(100).optional(),
});

export type IntakeBody = z.infer<typeof intakeBodySchema>;

export { PARSER_PLACEHOLDERS, parserInput } from "../intake/parser-input.js";
import { parserInput } from "../intake/parser-input.js";

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
  /** True when this push gave an existing race without a source key its source key. */
  attached?: boolean;
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
      if (batch.length >= LAP_BATCH) await flush();
    }
  }
  await flush();
  return { entries: entryData.length, laps: total };
}

/** Lap rows per insert: 11 columns × 2,000 rows stays well under Postgres's 65,535 bind parameters. */
const LAP_BATCH = 2000;
/**
 * The write transaction's time limit. A 24-hour race has about 45,000 laps, and a re-import deletes
 * the old rows before writing the new ones; 60 seconds was not enough for the Rolex 24.
 */
const WRITE_TIMEOUT_MS = 300_000;

function isTransactionTimeout(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "P2028";
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

  let existing: { id: string; sourceVersion: string | null; resultsStatus: string | null; sourceFiles: unknown } | null = await prisma.race.findUnique({
    where: { sourceKey },
    select: { id: true, sourceVersion: true, resultsStatus: true, sourceFiles: true },
  });
  let attached = false;
  if (body.attachToRaceId) {
    if (existing && existing.id !== body.attachToRaceId) {
      throw new AppError(409, `This source key already belongs to race ${existing.id}; it cannot also be attached to race ${body.attachToRaceId}.`, "ATTACH_CONFLICT");
    }
    if (!existing) {
      const r = await prisma.race.findUnique({
        where: { id: body.attachToRaceId },
        select: { id: true, sourceKey: true, sourceVersion: true, resultsStatus: true, sourceFiles: true, series: true, date: true, name: true },
      });
      if (!r) throw new AppError(404, `Race ${body.attachToRaceId} not found`, "ATTACH_NOT_FOUND");
      if (r.sourceKey) throw new AppError(409, `Race ${r.id} already has the source key ${r.sourceKey}`, "ATTACH_KEYED");
      // The session may be up to four days after the race's date (older uploads carry the event's first day).
      const days = (Date.parse(`${body.metadata.date}T00:00:00Z`) - new Date(r.date).getTime()) / 86400000;
      // Same series family (older uploads spell series several ways: "GR CUP", "GR_CUP", "GTWC", a championship name).
      const sameFamily = r.series === body.metadata.series || (raceFamily(r.series) !== null && raceFamily(r.series) === raceFamily(body.metadata.series, body.metadata.subSeries));
      if (!body.force && (!sameFamily || !(days >= -2.5 && days <= 4.5) || !sameSessionTraits(body.metadata.name, r.name))) {
        throw new AppError(
          409,
          `Race ${r.id} ("${r.name}", ${r.series}, ${new Date(r.date).toISOString().slice(0, 10)}) does not look like this session (${body.metadata.series}, ${body.metadata.date}). Send force: true to attach anyway.`,
          "ATTACH_MISMATCH"
        );
      }
      existing = { id: r.id, sourceVersion: null, resultsStatus: r.resultsStatus ?? null, sourceFiles: r.sourceFiles ?? null };
      attached = true;
    }
  }

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
              ...(attached ? { sourceKey } : {}),
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
      { timeout: WRITE_TIMEOUT_MS, maxWait: 20_000 }
    ));
  } catch (e) {
    if (isTransactionTimeout(e)) {
      throw new AppError(
        504,
        `Saving ${carCount} cars and their laps took longer than ${WRITE_TIMEOUT_MS / 1000} s, so nothing was saved (the raw files are archived). Run it again; if it keeps happening, the race is too large for one write.`,
        "WRITE_TIMEOUT"
      );
    }
    if (isUniqueViolation(e)) {
      throw new AppError(409, "Another intake created this race at the same moment; run push again to update it.", "SOURCE_KEY_CONFLICT");
    }
    throw e;
  }

  await prisma.auditLog.create({
    data: {
      adminUserId: actor.userId,
      action: action === "created" ? "INTAKE_CREATE_RACE" : attached ? "INTAKE_ATTACH_RACE" : "INTAKE_UPDATE_RACE",
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
        attached,
        files: Object.keys(body.files),
        manifest: (body.manifest as any) ?? null,
        entries: counts.entries,
        laps: counts.laps,
        warnings,
      } as any,
    },
  });

  return { action, ...(attached ? { attached: true } : {}), raceId, sourceKey, entriesCreated: counts.entries, lapsCreated: counts.laps, warnings, archived: archived.paths };
}

/**
 * Races without a source key (imported by hand before the intake), for
 * `intake discover` to suggest which one a session could be attached to.
 */
export async function listUnkeyedRaces(filter: { series?: string; season?: number; withCars?: boolean } = {}) {
  const rows = await prisma.race.findMany({
    where: { sourceKey: null, ...(filter.series ? { series: filter.series } : {}), ...(filter.season ? { season: filter.season } : {}) },
    select: {
      id: true, name: true, date: true, track: true, series: true, subSeries: true, season: true, status: true, maxLap: true, totalCars: true,
      // Car numbers let the re-import match a race to its timing session by the cars that ran.
      ...(filter.withCars ? { entries: { select: { carNumber: true, lapsCompleted: true } } } : {}),
    },
    orderBy: { date: "desc" },
  });
  return rows.map((r: any) => ({
    raceId: r.id as string,
    name: r.name as string,
    date: new Date(r.date).toISOString().slice(0, 10),
    track: r.track as string,
    series: r.series as string,
    season: r.season as number,
    status: r.status as string,
    maxLap: r.maxLap ?? null,
    totalCars: r.totalCars ?? null,
    ...(r.subSeries ? { subSeries: r.subSeries as string } : {}),
    ...(filter.withCars
      ? { cars: ((r.entries ?? []) as { carNumber: string; lapsCompleted: number | null }[]).filter((e) => (e.lapsCompleted ?? 1) > 0).map((e) => e.carNumber) }
      : {}),
  }));
}

/** Races created by the intake, for `intake discover` to compare against. */
export async function listIntakeRaces(site?: string) {
  const rows = await prisma.race.findMany({
    where: site ? { sourceKey: { startsWith: `${site}:` } } : { sourceKey: { not: null } },
    select: {
      id: true,
      name: true,
      status: true,
      sourceKey: true,
      sourceVersion: true,
      resultsStatus: true,
      updatedAt: true,
      date: true,
      series: true,
      season: true,
      track: true,
      // The newest analysis package, so the intake can tell which races still need one.
      packages: { select: { version: true, status: true, engineVersion: true, rulebookVersion: true, createdAt: true }, orderBy: { version: "desc" }, take: 1 },
    },
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
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
    series: r.series,
    season: r.season,
    track: r.track,
    latestPackage: r.packages?.[0] ?? null,
  }));
}

const identitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  season: z.number().int().min(2000).max(2100),
});

/**
 * Rename and re-date a race to match its timing session (intake `names`). Only races with a
 * source key: their session is the authority for the day they ran. Id, link and status stay.
 */
export async function setRaceIdentity(raceId: string, bodyIn: unknown, actor: IntakeActor) {
  const body = identitySchema.parse(bodyIn);
  const race = await prisma.race.findUnique({ where: { id: raceId }, select: { id: true, name: true, date: true, season: true, sourceKey: true } });
  if (!race) throw new AppError(404, `Race ${raceId} not found`, "NOT_FOUND");
  if (!race.sourceKey) throw new AppError(409, `Race ${raceId} has no source key; only races tied to a timing session can be renamed this way.`, "NOT_KEYED");
  const date = new Date(`${body.date}T00:00:00.000Z`);
  await prisma.race.update({ where: { id: raceId }, data: { name: body.name, date, season: body.season } });
  await prisma.auditLog.create({
    data: {
      adminUserId: actor.userId,
      action: "INTAKE_RACE_IDENTITY",
      targetType: "race",
      targetId: raceId,
      details: {
        sourceKey: race.sourceKey,
        apiTokenId: actor.apiTokenId ?? null,
        from: { name: race.name, date: race.date.toISOString().slice(0, 10), season: race.season },
        to: body,
      } as any,
    },
  });
  return { raceId, name: body.name, date: body.date, season: body.season };
}

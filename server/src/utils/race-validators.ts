import { z } from "zod";

// ─── Incoming JSON DATA schema (matches the embedded DATA object) ────────────

const lapDataSchema = z.object({
  l: z.number().int().positive(),
  p: z.number().int().positive(),
  cp: z.number().int().positive(),
  lt: z.string(),
  ltSec: z.number().positive(),
  flag: z.string(),
  pit: z.number().int().min(0).max(1),
  spd: z.number().nonnegative().optional(),
});

const carDataSchema = z.object({
  num: z.number().int().positive(),
  team: z.string().min(1),
  cls: z.string().min(1),
  make: z.string().optional(),
  vehicle: z.string().optional(),
  finishPos: z.number().int().positive(),
  finishPosClass: z.number().int().positive(),
  laps: z.array(lapDataSchema).min(1),
});

export const raceDataJsonSchema = z.object({
  maxLap: z.number().int().positive(),
  totalCars: z.number().int().positive(),
  greenPaceCutoff: z.number().positive(),
  cars: z.record(z.string(), carDataSchema),
  fcy: z.array(z.tuple([z.number(), z.number()])).default([]),
  classGroups: z.record(z.string(), z.array(z.number())),
  classCarCounts: z.record(z.string(), z.number()),
  makeGroups: z.record(z.string(), z.array(z.number())).optional(),
});

export type RaceDataJson = z.infer<typeof raceDataJsonSchema>;

// ─── Incoming JSON ANN schema (matches the embedded ANN object) ──────────────

const pitMarkerSchema = z.object({
  l: z.number().int().positive(),
  lb: z.string(),
  c: z.string(),
  yo: z.number().default(0),
  da: z.number().default(0),
});

const settleMarkerSchema = z.object({
  l: z.number().int().positive(),
  p: z.number().int().positive(),
  lb: z.string(),
  su: z.string(),
  c: z.string(),
});

const carAnnotationsSchema = z.object({
  reasons: z.record(z.string(), z.string()).default({}),
  pits: z.array(pitMarkerSchema).default([]),
  settles: z.array(settleMarkerSchema).default([]),
});

export const annotationJsonSchema = z.record(z.string(), carAnnotationsSchema);

export type AnnotationJson = z.infer<typeof annotationJsonSchema>;

// ─── Race metadata schema for uploads ────────────────────────────────────────

export const raceMetadataSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  date: z.coerce.date(),
  track: z.string().min(1).max(200).trim(),
  series: z.string().min(1).max(100).trim(),
  season: z.coerce.number().int().min(2000).max(2100),
  premium: z.coerce.boolean().default(false),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
});

export type RaceMetadata = z.infer<typeof raceMetadataSchema>;

// ─── Query parameters ────────────────────────────────────────────────────────

export const raceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  series: z.string().optional(),
  track: z.string().optional(),
  season: z.coerce.number().int().optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  search: z.string().max(200).optional(),
  sortBy: z.enum(["date", "name", "createdAt"]).default("date"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

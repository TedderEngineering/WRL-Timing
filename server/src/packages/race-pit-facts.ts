/**
 * Loads a race's pit facts (pit-facts.ts) from its published package, or for admins a named
 * version under review, and applies them to its chart data. Cached by the package's sha256,
 * which never changes for a stored version.
 */
import { prisma } from "../models/prisma.js";
import { pitFactsFlagOn } from "./flags.js";
import { getServedGzip, gunzip } from "./store.js";
import { applyPitFacts, extractPitFacts, type Annotations, type Chart, type PitFacts } from "./pit-facts.js";

const cache = new Map<string, PitFacts | null>();
const CACHE_MAX = 60;

export interface PitFactsInfo {
  version: number;
  status: "published" | "draft" | "superseded" | "rejected";
  engineVersion: string;
  /** Chart cars the package was matched to. */
  matched: number;
}

type Row = { id: string; version: number; status: string; storagePath: string; sha256: string; engineVersion: string };

async function loadFacts(row: Row): Promise<PitFacts | null> {
  if (cache.has(row.sha256)) return cache.get(row.sha256) ?? null;
  let facts: PitFacts | null = null;
  try {
    const gz = await getServedGzip(row, "norules");
    facts = extractPitFacts(JSON.parse(gunzip(gz).toString("utf8")));
  } catch (err) {
    console.error(`[pit-facts] package ${row.id} could not be read:`, (err as Error).message);
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(row.sha256, facts);
  return facts;
}

/**
 * The race's chart data with its package's pit facts, when it has one (and the switch is on).
 * `version` (admins only; the caller checks) picks a specific package, e.g. a draft.
 */
export async function withPitFacts<T extends { data: unknown; annotations: unknown }>(
  race: { id: string; currentPackageId?: string | null; packagesDisabled?: boolean | null },
  chart: T,
  opts: { version?: number } = {}
): Promise<T & { pitFacts: PitFactsInfo | null }> {
  const none = { ...chart, pitFacts: null };
  if (!chart.data || !pitFactsFlagOn() || race.packagesDisabled === true) return none;
  const select = { id: true, version: true, status: true, storagePath: true, sha256: true, engineVersion: true };
  let row: Row | null = null;
  if (opts.version !== undefined) {
    row = (await prisma.raceAnalysisPackage.findUnique({ where: { raceId_version: { raceId: race.id, version: opts.version } }, select })) as Row | null;
  } else if (race.currentPackageId) {
    row = (await prisma.raceAnalysisPackage.findUnique({ where: { id: race.currentPackageId }, select })) as Row | null;
    if (row && row.status !== "PUBLISHED") row = null;
  }
  if (!row) return none;
  const facts = await loadFacts(row);
  if (!facts) return none;
  const out = applyPitFacts(chart.data as Chart, (chart.annotations ?? {}) as Annotations, facts);
  if (out.matched === 0) return none;
  return {
    ...chart,
    data: out.data,
    annotations: out.annotations,
    pitFacts: { version: row.version, status: row.status.toLowerCase() as PitFactsInfo["status"], engineVersion: row.engineVersion, matched: out.matched },
  };
}

export function clearPitFactsCache(): void {
  cache.clear();
}

/** The pit facts of the race's published package, when it has one and the switch is on. */
export async function publishedPitFacts(race: { currentPackageId?: string | null; packagesDisabled?: boolean | null }): Promise<PitFacts | null> {
  if (!pitFactsFlagOn() || race.packagesDisabled === true || !race.currentPackageId) return null;
  const row = (await prisma.raceAnalysisPackage.findUnique({
    where: { id: race.currentPackageId },
    select: { id: true, version: true, status: true, storagePath: true, sha256: true, engineVersion: true },
  })) as Row | null;
  return row && row.status === "PUBLISHED" ? loadFacts(row) : null;
}

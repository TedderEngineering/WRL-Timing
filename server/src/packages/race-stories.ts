/**
 * The race page's Story tab: the published package's words only (race summary, key moments,
 * class notes and every car's story), not its facts, so the tab loads a few kilobytes instead of
 * the whole package. Same gating as GET /api/races/:id/package. Rule findings are never included
 * (rule checks stay admin-only).
 *
 *   GET /api/races/:id/stories
 */
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../middleware/error-handler.js";
import { prisma } from "../models/prisma.js";
import { assertRaceAccess, resolveViewer } from "../services/race-access.js";
import { packagesEnabledFor } from "./flags.js";
import { getServedGzip, gunzip } from "./store.js";
import { extractRecap, type Recap } from "../dashboard/recap.js";
import type { Prose } from "../analysis/schema/package-types.js";

export interface RaceStory {
  car: string;
  cls: string;
  headline: Prose;
  paragraphs: Prose[];
  /** Finishing positions, for ordering the car list (null when not classified). */
  positionClass: number | null;
  positionOverall: number | null;
}

export interface RaceStories {
  version: number;
  publishedAt: string | null;
  recap: Recap;
  stories: RaceStory[];
}

type Pkg = Record<string, any>;

/** The words of a published package, or null when it has no race summary. */
export function extractRaceStories(pkg: Pkg, version: number, publishedAt: string | null): RaceStories | null {
  const recap = extractRecap(pkg);
  if (!recap) return null;
  const entries = new Map<string, any>((pkg.entries ?? []).map((e: any) => [String(e.car), e]));
  const stories: RaceStory[] = [];
  for (const s of pkg.carStories ?? []) {
    if (!s?.headline?.text) continue;
    const e = entries.get(String(s.car));
    stories.push({
      car: String(s.car),
      cls: e?.class ?? "",
      headline: s.headline,
      paragraphs: s.paragraphs ?? [],
      positionClass: typeof e?.result?.positionClass === "number" ? e.result.positionClass : null,
      positionOverall: typeof e?.result?.positionOverall === "number" ? e.result.positionOverall : null,
    });
  }
  return { version, publishedAt, recap, stories };
}

// Published packages never change: cache by sha256.
const cache = new Map<string, RaceStories | null>();
const CACHE_MAX = 100;

export async function getRaceStories(req: Request, res: Response, next: NextFunction) {
  try {
    const raceId = req.params.id as string;
    const isAdmin = req.user?.role === "ADMIN";
    const race = (await prisma.race.findUnique({
      where: { id: raceId },
      select: { id: true, premium: true, createdAt: true, status: true, currentPackageId: true, packagesDisabled: true },
    })) as { id: string; premium: boolean; createdAt: Date; status: string; currentPackageId: string | null; packagesDisabled: boolean } | null;
    if (!race || (race.status === "DRAFT" && !isAdmin)) throw new AppError(404, "Race not found", "RACE_NOT_FOUND");
    if (!packagesEnabledFor(race) || !race.currentPackageId) throw new AppError(404, "This race has no published stories", "NO_STORIES");

    const viewer = await resolveViewer(req.user);
    await assertRaceAccess(viewer, race);

    const row = (await prisma.raceAnalysisPackage.findUnique({
      where: { id: race.currentPackageId },
      select: { storagePath: true, sha256: true, status: true, version: true, publishedAt: true },
    })) as { storagePath: string; sha256: string; status: string; version: number; publishedAt: Date | null } | null;
    if (!row || row.status !== "PUBLISHED") throw new AppError(404, "This race has no published stories", "NO_STORIES");

    const etag = `"stories-${row.sha256}"`;
    res.set("ETag", etag);
    res.set("Vary", "Authorization, Accept-Encoding");
    res.set("Cache-Control", req.user ? "private, max-age=60" : "public, max-age=60");
    if (String(req.headers["if-none-match"] ?? "").split(/\s*,\s*/).includes(etag)) {
      res.status(304).end();
      return;
    }

    let out = cache.get(row.sha256);
    if (out === undefined) {
      const gz = await getServedGzip(row, "norules");
      out = extractRaceStories(JSON.parse(gunzip(gz).toString("utf8")), row.version, row.publishedAt ? row.publishedAt.toISOString() : null);
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(row.sha256, out);
    }
    if (!out) throw new AppError(404, "This race has no published stories", "NO_STORIES");
    res.json(out);
  } catch (err) {
    next(err);
  }
}

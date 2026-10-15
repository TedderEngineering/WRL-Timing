/**
 * Dashboard API (RaceTrace 2.0, G6 dashboard).
 *
 *   GET /api/dashboard/latest?limit=6   newest race weekends with recaps
 *   GET /api/dashboard/season?season=   each calendar series, round by round
 */
import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../models/prisma.js";
import { canUserAccessRace } from "../services/races.js";
import { resolveViewer } from "../services/race-access.js";
import { packagesEnabledFor } from "../packages/flags.js";
import { getServedGzip, gunzip } from "../packages/store.js";
import { extractRecap, type Recap } from "../dashboard/recap.js";
import { groupIntoWeekends, headlineOrder, sessionLabel, type LatestRaceRow } from "../dashboard/latest.js";
import { availableSeasons, buildSeason, calendarFor, locateRace, type SeasonRace } from "../dashboard/season.js";

export const dashboardRouter = Router();

// Recaps are cut from immutable published packages, so cache them by sha256.
const recapCache = new Map<string, Recap | null>();
const RECAP_CACHE_MAX = 200;

async function recapFor(packageId: string): Promise<Recap | null> {
  const row = (await prisma.raceAnalysisPackage.findUnique({
    where: { id: packageId },
    select: { storagePath: true, sha256: true, status: true },
  })) as { storagePath: string; sha256: string; status: string } | null;
  if (!row || row.status !== "PUBLISHED") return null;
  if (recapCache.has(row.sha256)) return recapCache.get(row.sha256) ?? null;
  try {
    // "norules": the dashboard never shows rule flags.
    const gz = await getServedGzip(row, "norules");
    const recap = extractRecap(JSON.parse(gunzip(gz).toString("utf8")));
    if (recapCache.size >= RECAP_CACHE_MAX) recapCache.delete(recapCache.keys().next().value as string);
    recapCache.set(row.sha256, recap);
    return recap;
  } catch (err) {
    console.error(`[dashboard] recap for package ${packageId} failed:`, (err as Error).message);
    return null;
  }
}

type Row = LatestRaceRow & {
  currentPackageId: string | null;
  packagesDisabled: boolean;
  resultsStatus: string | null;
};

dashboardRouter.get("/latest", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 12);
    const viewer = await resolveViewer(req.user);

    const rows = (await prisma.race.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ date: "desc" }, { name: "asc" }],
      take: limit * 6,
      select: {
        id: true,
        name: true,
        date: true,
        track: true,
        series: true,
        subSeries: true,
        eventId: true,
        premium: true,
        createdAt: true,
        maxLap: true,
        totalCars: true,
        currentPackageId: true,
        packagesDisabled: true,
        resultsStatus: true,
      },
    })) as Row[];

    const viewed = new Set(
      (
        await prisma.userRaceView.findMany({
          where: { userId: req.user!.userId, raceId: { in: rows.map((r) => r.id) } },
          select: { raceId: true },
          distinct: ["raceId"],
        })
      ).map((v: { raceId: string }) => v.raceId)
    );

    const groups = groupIntoWeekends(rows).slice(0, limit);
    // Feature races first in each weekend: count the pit laps of the races shown.
    const shown = groups.flatMap((g) => g.races.map((r) => r.id));
    const pits = (await prisma.raceLap.groupBy({
      by: ["raceId"],
      where: { raceId: { in: shown }, pitStop: true },
      _count: { _all: true },
    })) as { raceId: string; _count: { _all: number } }[];
    const pitCount = new Map(pits.map((p) => [p.raceId, p._count._all]));
    for (const g of groups) {
      for (const r of g.races) r.pitStops = pitCount.get(r.id) ?? 0;
      g.races.sort(headlineOrder);
    }
    const cal = calendarFor(new Date().getUTCFullYear());
    const fresh = Date.now() - 14 * 86_400_000;

    const events = [];
    for (const g of groups) {
      const first = g.races[0];
      const last = g.races[g.races.length - 1];
      const races = [];
      for (const r of g.races) {
        const access = await canUserAccessRace(r, viewer.plan, viewer.role);
        const recap =
          access.accessible && r.currentPackageId && packagesEnabledFor(r) ? await recapFor(r.currentPackageId) : null;
        races.push({
          id: r.id,
          name: r.name,
          session: sessionLabel(r, recap?.session),
          date: r.date.toISOString().slice(0, 10),
          totalCars: r.totalCars,
          maxLap: r.maxLap,
          resultsStatus: recap?.resultsStatus ?? r.resultsStatus ?? null,
          locked: !access.accessible,
          lockReason: access.accessible ? null : access.reason ?? null,
          recap,
        });
      }
      const located = cal ? locateRace(cal, first) : null;
      events.push({
        key: g.key,
        series: first.series,
        subSeries: first.subSeries,
        seriesLabel: located?.label ?? null,
        round: located ? { number: located.round, of: located.of, name: located.roundName } : null,
        track: first.track,
        startDate: first.date.toISOString().slice(0, 10),
        endDate: last.date.toISOString().slice(0, 10),
        isNew: g.races.some((r) => !viewed.has(r.id) && r.createdAt.getTime() >= fresh),
        races,
      });
    }

    res.json({ events });
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get("/season", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const seasons = availableSeasons();
    const asked = Number(req.query.season);
    const season = seasons.includes(asked) ? asked : seasons.includes(new Date().getUTCFullYear()) ? new Date().getUTCFullYear() : seasons[0];
    const cal = season ? calendarFor(season) : null;
    if (!cal) {
      res.json({ season: null, seasons, series: [], next: null });
      return;
    }

    const races = await prisma.race.findMany({
      where: { status: "PUBLISHED", season: cal.season },
      select: { id: true, name: true, date: true, track: true, series: true, subSeries: true },
    });
    const today = new Date();
    const series = buildSeason(cal, races, today);

    // The user's own series first: those of the races they viewed most recently.
    const recent = await prisma.userRaceView.findMany({
      where: { userId: req.user!.userId },
      orderBy: { viewedAt: "desc" },
      take: 50,
      select: { race: { select: { id: true, name: true, date: true, track: true, series: true, subSeries: true } } },
    });
    const rank = new Map<string, number>();
    recent.forEach((v: { race: SeasonRace }, i: number) => {
      const hit = locateRace(cal, v.race);
      if (hit && !rank.has(hit.seriesId)) rank.set(hit.seriesId, i);
    });
    const suggested = [...series]
      .sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9))
      .map((s) => s.id);

    const nexts = series
      .filter((s) => s.next)
      .map((s) => ({ seriesId: s.id, seriesLabel: s.shortLabel, ...s.next! }))
      .sort((a, b) => a.start.localeCompare(b.start));

    res.json({ season: cal.season, seasons, today: today.toISOString().slice(0, 10), series, suggested, next: nexts[0] ?? null, upcoming: nexts });
  } catch (err) {
    next(err);
  }
});

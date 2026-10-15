/**
 * Dashboard API (RaceTrace 2.0, G6 dashboard).
 *
 *   GET /api/dashboard/latest?limit=6   newest race weekends with recaps
 *   GET /api/dashboard/season?season=   each calendar series, round by round
 *   GET /api/dashboard/my-car           the latest race of a car the user follows (plan C)
 *   GET /api/dashboard/season-recap     "Your 2026", per followed car and series once its season is over (plan H)
 */
import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../models/prisma.js";
import { canUserAccessRace } from "../services/races.js";
import { resolveViewer } from "../services/race-access.js";
import { packagesEnabledFor } from "../packages/flags.js";
import { getServedGzip, gunzip } from "../packages/store.js";
import { withPitFacts } from "../packages/race-pit-facts.js";
import { extractRecap, type Recap } from "../dashboard/recap.js";
import { groupIntoWeekends, headlineOrder, sessionLabel, type LatestRaceRow } from "../dashboard/latest.js";
import { carFacts, extractCarStory, type CarStory } from "../dashboard/my-car.js";
import { buildRecap, recapSeriesFor, seasonOver, type RecapRaceIn } from "../dashboard/season-recap.js";
import { carMatchesEntry, listCars } from "../services/my-cars.js";
import { getRaceAlerts } from "../services/race-alerts.js";
import { normCar } from "../intake/reimport.js";
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

const storyCache = new Map<string, CarStory | null>();

async function storyFor(packageId: string, carNumber: string): Promise<CarStory | null> {
  const row = (await prisma.raceAnalysisPackage.findUnique({
    where: { id: packageId },
    select: { storagePath: true, sha256: true, status: true },
  })) as { storagePath: string; sha256: string; status: string } | null;
  if (!row || row.status !== "PUBLISHED") return null;
  const key = `${row.sha256}:${normCar(carNumber)}`;
  if (storyCache.has(key)) return storyCache.get(key) ?? null;
  try {
    const gz = await getServedGzip(row, "norules");
    const story = extractCarStory(JSON.parse(gunzip(gz).toString("utf8")), carNumber);
    if (storyCache.size >= RECAP_CACHE_MAX) storyCache.delete(storyCache.keys().next().value as string);
    storyCache.set(key, story);
    return story;
  } catch (err) {
    console.error(`[dashboard] car story for package ${packageId} failed:`, (err as Error).message);
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
      // Enough rows for `limit` weekends even when each holds ten races (IMSA, SRO).
      take: limit * 10,
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
    // Pit laps are a small share of all laps, so counting them here is cheap and keeps the
    // query free of Prisma's groupBy generics (which failed the build's type check).
    const pitLaps = await prisma.raceLap.findMany({
      where: { raceId: { in: shown }, pitStop: true },
      select: { raceId: true },
    });
    const pitCount = new Map<string, number>();
    for (const l of pitLaps) pitCount.set(l.raceId, (pitCount.get(l.raceId) ?? 0) + 1);
    for (const g of groups) {
      for (const r of g.races) r.pitStops = pitCount.get(r.id) ?? 0;
      g.races.sort(headlineOrder);
    }
    const cal = calendarFor(new Date().getUTCFullYear());
    const fresh = Date.now() - 14 * 86_400_000;

    const events = [];
    for (const g of groups) {
      // Races are in headline order (feature race first), so the weekend's dates come from the
      // earliest and latest race, not the first and last listed.
      const first = g.races[0];
      const byDate = [...g.races].sort((a, b) => a.date.getTime() - b.date.getTime());
      const earliest = byDate[0];
      const last = byDate[byDate.length - 1];
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
        startDate: earliest.date.toISOString().slice(0, 10),
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

// ─── GET /api/dashboard/my-car — "Your car's latest race" (engagement plan C) ──

dashboardRouter.get("/my-car", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const [cars, alerts] = await Promise.all([listCars(userId), getRaceAlerts(userId)]);
    if (cars.length === 0) {
      res.json({ carCount: 0, car: null, race: null, alerts });
      return;
    }
    // Candidate numbers as stored ("7" and "007" are one car).
    const numbers = [...new Set(cars.flatMap((c) => [c.number, normCar(c.number)]))];
    const candidates = (await prisma.race.findMany({
      where: { status: "PUBLISHED", entries: { some: { carNumber: { in: numbers } } } },
      orderBy: [{ date: "desc" }, { name: "asc" }],
      take: 40,
      select: {
        id: true, name: true, date: true, track: true, series: true, subSeries: true, season: true,
        premium: true, createdAt: true, currentPackageId: true, packagesDisabled: true, resultsStatus: true,
        entries: { where: { carNumber: { in: numbers } }, select: { carNumber: true, teamName: true } },
      },
    })) as any[];

    let hit: { race: any; car: (typeof cars)[number]; carNumber: string } | null = null;
    for (const race of candidates) {
      for (const e of race.entries) {
        const car = cars.find((c) => carMatchesEntry(c, race, e));
        if (car) {
          hit = { race, car, carNumber: e.carNumber };
          break;
        }
      }
      if (hit) break;
    }
    if (!hit) {
      res.json({ carCount: cars.length, car: cars[0], race: null, alerts });
      return;
    }

    const { race, car, carNumber } = hit;
    const viewer = await resolveViewer(req.user ?? undefined);
    const access = await canUserAccessRace(race, viewer.plan, viewer.role);
    const raceOut = {
      id: race.id,
      name: race.name,
      date: race.date.toISOString().slice(0, 10),
      track: race.track,
      series: race.series,
      resultsStatus: race.resultsStatus ?? null,
      locked: !access.accessible,
      lockReason: access.accessible ? null : access.reason ?? null,
    };
    if (!access.accessible) {
      res.json({ carCount: cars.length, car, race: raceOut, facts: null, story: null, viewed: false, alerts });
      return;
    }
    const [data, viewed] = await Promise.all([
      prisma.race
        .findUnique({ where: { id: race.id }, select: { id: true, chartData: true, annotationData: true, currentPackageId: true, packagesDisabled: true } })
        .then((r: any) => (r?.chartData ? withPitFacts(r, { data: r.chartData, annotations: r.annotationData ?? {} }) : null)) as Promise<any>,
      prisma.userRaceView.findFirst({ where: { userId, raceId: race.id }, select: { id: true } }),
    ]);
    const facts = data ? carFacts(data.data, data.annotations ?? null, carNumber) : null;
    const story = race.currentPackageId && packagesEnabledFor(race) ? await storyFor(race.currentPackageId, carNumber) : null;
    res.json({ carCount: cars.length, car, race: raceOut, facts, story, viewed: !!viewed, alerts });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/dashboard/season-recap — "Your 2026" (engagement plan H) ────────

dashboardRouter.get("/season-recap", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const season = Number(req.query.season) || new Date().getUTCFullYear();
    const cal = calendarFor(season);
    const cars = await listCars(userId);
    if (!cal || cars.length === 0) {
      res.json({ season, recaps: [] });
      return;
    }
    const numbers = [...new Set(cars.flatMap((c) => [c.number, normCar(c.number)]))];
    const published = (await prisma.race.findMany({
      where: { status: "PUBLISHED", season },
      select: { id: true, name: true, date: true, track: true, series: true, subSeries: true, season: true, entries: { where: { carNumber: { in: numbers } }, select: { carNumber: true, teamName: true } } },
    })) as any[];

    // Each followed car's races this season, grouped by calendar series.
    const groups = new Map<string, { car: (typeof cars)[number]; seriesId: string; races: { race: any; carNumber: string }[] }>();
    for (const car of cars) {
      if (car.season && car.season !== season) continue;
      for (const race of published) {
        const e = race.entries.find((x: any) => carMatchesEntry(car, race, x));
        if (!e) continue;
        const seriesId = recapSeriesFor(cal, race);
        if (!seriesId) continue;
        const key = `${car.id}:${seriesId}`;
        if (!groups.has(key)) groups.set(key, { car, seriesId, races: [] });
        groups.get(key)!.races.push({ race, carNumber: e.carNumber });
      }
    }
    const today = new Date();
    const done = [...groups.values()].filter((g) => seasonOver(cal, g.seriesId, published, today));
    const ids = [...new Set(done.flatMap((g) => g.races.map((r) => r.race.id)))];
    const charts = new Map(
      await Promise.all(
        ((await prisma.race.findMany({
          where: { id: { in: ids } },
          select: { id: true, chartData: true, annotationData: true, currentPackageId: true, packagesDisabled: true },
        })) as any[]).map(async (r) => {
          const c = r.chartData ? await withPitFacts(r, { data: r.chartData, annotations: r.annotationData ?? {} }) : null;
          return [r.id, { chartData: c?.data ?? null, annotationData: c?.annotations ?? null }] as const;
        })
      )
    );
    const recaps = [];
    for (const g of done) {
      const races: RecapRaceIn[] = g.races.map(({ race, carNumber }) => ({
        ...race,
        carNumber,
        chartData: charts.get(race.id)?.chartData ?? null,
        annotationData: charts.get(race.id)?.annotationData ?? null,
      }));
      const r = buildRecap(cal, g.car, season, g.seriesId, races);
      if (r) recaps.push(r);
    }
    res.json({ season, recaps });
  } catch (err) {
    next(err);
  }
});

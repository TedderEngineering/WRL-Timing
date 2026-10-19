import { Router, Request, Response, NextFunction } from "express";
import { requireAuth, optionalAuth, requireSubscription } from "../middleware/auth.js";
import { raceListQuerySchema } from "../utils/race-validators.js";
import { prisma } from "../models/prisma.js";
import * as raceSvc from "../services/races.js";
import { AppError } from "../middleware/error-handler.js";
import { normalizeTrackName } from "../services/pitStopAnalysis.service.js";
import { assertRaceAccess, resolveViewer } from "../services/race-access.js";
import { getRacePackage } from "./packages.js";
import { getRaceStories } from "../packages/race-stories.js";
import { packagesFlagOn } from "../packages/flags.js";
import { parseVersion } from "../packages/service.js";
import { publishedPitFacts } from "../packages/race-pit-facts.js";
import { pitStopsFromFacts } from "../packages/pit-facts.js";
import { carCardData, cardCar, driverCardData, driverOfEntry, entryDrivers, pickEntry } from "../dashboard/driver-card.js";
import { displayName } from "../services/driver-search.js";

export const racesRouter = Router();

// ─── GET /api/races — List published races ───────────────────────────────────

racesRouter.get(
  "/",
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = raceListQuerySchema.parse(req.query);
      // Force published-only for non-admin
      if (req.user?.role !== "ADMIN") {
        params.status = "PUBLISHED" as const;
      }
      const result = await raceSvc.listRaces(params, req.user?.userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/races/filters — Get distinct filter values ─────────────────────

racesRouter.get(
  "/filters",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = await raceSvc.getFilterOptions();
      res.json(filters);
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/races/recently-viewed — User's recently viewed races ──────────

racesRouter.get(
  "/recently-viewed",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 8, 20);
      const races = await raceSvc.getRecentlyViewed(req.user!.userId, limit);
      res.json({ races });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/races/favorites — User's favorited races ──────────────────────

racesRouter.get(
  "/favorites",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 12, 50);
      const races = await raceSvc.getUserFavorites(req.user!.userId, limit);
      res.json({ races });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/races/:id — Get race detail with entry list ───────────────────

racesRouter.get(
  "/:id",
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { packageAdmin, ...race } = await raceSvc.getRaceDetail(
        req.params.id as string,
        req.user?.userId
      );
      // Non-admin can't see drafts
      if (race.status === "DRAFT" && req.user?.role !== "ADMIN") {
        res.status(404).json({ error: "Race not found", code: "RACE_NOT_FOUND" });
        return;
      }
      if (req.user?.role === "ADMIN") {
        res.json({ ...race, packageAdmin: { ...packageAdmin, flag: packagesFlagOn() ? "on" : "off" } });
        return;
      }
      res.json(race);
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/races/:id/chart-data — Full chart dataset ─────────────────────

racesRouter.get(
  "/:id/chart-data",
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raceId = req.params.id as string;

      // Access gating — enforce free-tier limits
      const race = await prisma.race.findUnique({
        where: { id: raceId },
        select: { id: true, premium: true, createdAt: true },
      });

      if (race) {
        // Same gating as /package (services/race-access.ts)
        await assertRaceAccess(await resolveViewer(req.user), race);
      }

      // ?facts=N: an admin previews the pit facts of package version N (e.g. a draft under review).
      const factsVersion =
        req.query.facts !== undefined && req.user?.role === "ADMIN" ? parseVersion(req.query.facts) : undefined;
      const chartData = await raceSvc.getChartData(raceId, { factsVersion });

      // Record view
      if (req.user) {
        raceSvc.recordView(req.user.userId, raceId).catch(() => {});
      }

      // Cache privately when authed, publicly for free races
      res.set("Cache-Control", factsVersion ? "private, no-store" : req.user ? "private, max-age=300" : "public, max-age=300");
      res.json(chartData);
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/races/:id/package — Race Analysis Package (RaceTrace 2.0) ─────
// Same gating as /chart-data. gzip + ETag (sha256). ?version=N is admin-only.

racesRouter.get("/:id/package", optionalAuth, getRacePackage);

// ─── GET /api/races/:id/driver-card?car=&driver= — one driver's share card ──
// The race, the car, its facts and the driver's drive, for the race page's Drivers list. Same
// gating as /chart-data.

racesRouter.get(
  "/:id/driver-card",
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raceId = req.params.id as string;
      const carNumber = typeof req.query.car === "string" ? req.query.car.trim() : "";
      const name = typeof req.query.driver === "string" ? req.query.driver.trim() : "";
      if (!carNumber || !name || carNumber.length > 8 || name.length > 120) {
        throw new AppError(400, "A car number and a driver are needed", "BAD_REQUEST");
      }
      const race = (await prisma.race.findUnique({
        where: { id: raceId },
        select: { id: true, name: true, date: true, track: true, series: true, premium: true, createdAt: true, status: true, resultsStatus: true },
      })) as any;
      if (!race || (race.status !== "PUBLISHED" && req.user?.role !== "ADMIN")) throw new AppError(404, "Race not found", "NOT_FOUND");
      await assertRaceAccess(await resolveViewer(req.user), race);
      const entries = (await prisma.raceEntry.findMany({
        where: { raceId },
        select: { carNumber: true, teamName: true, carClass: true, driverNames: true },
      })) as Array<{ carNumber: string; teamName: string; carClass: string; driverNames: string }>;
      const entry = pickEntry(entries, carNumber);
      const driverName = entry ? driverOfEntry(entry, name) : null;
      if (!entry || !driverName) throw new AppError(404, "That driver is not in that car", "NOT_FOUND");
      const card = await driverCardData(raceId, entry.carNumber, driverName, entry.driverNames);
      res.set("Cache-Control", req.user ? "private, max-age=300" : "public, max-age=300");
      res.json({
        race: {
          id: race.id,
          name: race.name,
          date: race.date.toISOString().slice(0, 10),
          track: race.track,
          series: race.series,
          resultsStatus: race.resultsStatus ?? null,
          locked: false,
          lockReason: null,
        },
        car: cardCar(entry, driverName),
        facts: card.facts,
        driverFacts: card.driverFacts,
        driverHighlights: card.driverHighlights,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/races/:id/car-card?car= — one car's share card ─────────────────
// The race, the car, its drivers, facts and drive (as the dashboard's car card), for the race
// page's share image. Same gating as /chart-data.

racesRouter.get(
  "/:id/car-card",
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raceId = req.params.id as string;
      const carNumber = typeof req.query.car === "string" ? req.query.car.trim() : "";
      if (!carNumber || carNumber.length > 8) throw new AppError(400, "A car number is needed", "BAD_REQUEST");
      const race = (await prisma.race.findUnique({
        where: { id: raceId },
        select: { id: true, name: true, date: true, track: true, series: true, premium: true, createdAt: true, status: true, resultsStatus: true },
      })) as any;
      if (!race || (race.status !== "PUBLISHED" && req.user?.role !== "ADMIN")) throw new AppError(404, "Race not found", "NOT_FOUND");
      await assertRaceAccess(await resolveViewer(req.user), race);
      const entries = (await prisma.raceEntry.findMany({
        where: { raceId },
        select: { carNumber: true, teamName: true, carClass: true, driverNames: true },
      })) as Array<{ carNumber: string; teamName: string; carClass: string; driverNames: string }>;
      const entry = pickEntry(entries, carNumber);
      if (!entry) throw new AppError(404, "That car is not in this race", "NOT_FOUND");
      const card = await carCardData(raceId, entry.carNumber, entry.driverNames);
      res.set("Cache-Control", req.user ? "private, max-age=300" : "public, max-age=300");
      res.json({
        race: { id: race.id, name: race.name, date: race.date.toISOString().slice(0, 10), track: race.track, series: race.series, resultsStatus: race.resultsStatus ?? null },
        car: { number: entry.carNumber, team: entry.teamName.replace(/\s*\([^()]*\)\s*$/, ""), cls: entry.carClass },
        drivers: entryDrivers(entry.driverNames).map(displayName),
        facts: card.facts,
        drive: card.drive,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/races/:id/stories — the published package's words (Story tab) ─

racesRouter.get("/:id/stories", optionalAuth, getRaceStories);

// ─── GET /api/races/:id/entries — Entry list for a race ─────────────────────

racesRouter.get(
  "/:id/entries",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entries = await raceSvc.getRaceEntries(req.params.id as string);
      res.json({ entries });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/races/:id/pit-analysis — Pit stop analysis (Team tier) ────────

racesRouter.get(
  "/:id/pit-analysis",
  requireAuth,
  requireSubscription("TEAM"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raceId = req.params.id as string;

      const race = await prisma.race.findUnique({
        where: { id: raceId },
        select: { id: true, track: true, series: true, status: true, currentPackageId: true, packagesDisabled: true },
      });
      if (!race || (race.status === "DRAFT" && req.user?.role !== "ADMIN")) {
        throw new AppError(404, "Race not found", "RACE_NOT_FOUND");
      }

      // A race with a published analysis package: its stops, as on the chart (packages/pit-facts.ts).
      const facts = await publishedPitFacts(race);
      if (facts) {
        const entries = await prisma.raceEntry.findMany({
          where: { raceId },
          select: { carNumber: true, teamName: true, carClass: true, carColor: true, finishPos: true },
        });
        res.json({ raceId, track: race.track, trackConfig: null, ...pitStopsFromFacts(facts, entries) });
        return;
      }

      // Fetch all pit stop analysis rows for this race
      const stops = await prisma.pitStopAnalysis.findMany({
        where: { raceId },
        orderBy: [{ carNumber: "asc" }, { stopNumber: "asc" }],
      });

      if (stops.length === 0) {
        res.json({
          raceId,
          track: race.track,
          trackConfig: null,
          cars: {},
          summary: { totalStops: 0, totalCars: 0, avgServiceTime_s: 0, avgTimeLost_s: 0 },
        });
        return;
      }

      // Fetch car metadata from race entries
      const entries = await prisma.raceEntry.findMany({
        where: { raceId },
        select: { carNumber: true, teamName: true, carClass: true, carColor: true, finishPos: true },
      });
      const entryMap = new Map(entries.map((e) => [e.carNumber, e]));

      // Fetch track config for reference
      const slug = normalizeTrackName(race.track);
      const trackConfig = await prisma.trackPitConfig.findFirst({
        where: { trackName: slug, series: "WRL" },
        orderBy: { eventYear: "desc" },
        select: { transitTime_s: true, transitOverhead_s: true, trackName: true },
      });

      // Group by car
      const cars: Record<string, {
        carNumber: string;
        teamName: string;
        carClass: string;
        carColor: string | null;
        finishPos: number | null;
        stops: Array<{
          stopNumber: number;
          pitLap: number;
          condition: string;
          localRef_s: number;
          vsGlobal_s: number;
          refSource: string;
          twoLapActual_s: number;
          twoLapRef_s: number;
          serviceTime_s: number;
          pitRoadTime_s: number;
          timeLost_s: number;
          delta_s: number;
          isCautionContaminated: boolean;
        }>;
      }> = {};

      let totalService = 0;
      let totalLost = 0;

      for (const s of stops) {
        if (!cars[s.carNumber]) {
          const entry = entryMap.get(s.carNumber);
          cars[s.carNumber] = {
            carNumber: s.carNumber,
            teamName: entry?.teamName ?? `Car #${s.carNumber}`,
            carClass: entry?.carClass ?? "",
            carColor: entry?.carColor ?? null,
            finishPos: entry?.finishPos ?? null,
            stops: [],
          };
        }
        cars[s.carNumber].stops.push({
          stopNumber: s.stopNumber,
          pitLap: s.pitLap,
          condition: s.condition,
          localRef_s: s.localRef_s,
          vsGlobal_s: s.vsGlobal_s,
          refSource: s.refSource,
          twoLapActual_s: s.twoLapActual_s,
          twoLapRef_s: s.twoLapRef_s,
          serviceTime_s: s.serviceTime_s,
          pitRoadTime_s: s.pitRoadTime_s,
          timeLost_s: s.timeLost_s,
          delta_s: s.delta_s,
          isCautionContaminated: s.isCautionContaminated,
        });
        totalService += s.serviceTime_s;
        totalLost += s.timeLost_s;
      }

      res.set("Cache-Control", "private, max-age=300");
      res.json({
        raceId,
        track: race.track,
        trackConfig: trackConfig
          ? { trackName: trackConfig.trackName, transitTime_s: trackConfig.transitTime_s, transitOverhead_s: trackConfig.transitOverhead_s }
          : null,
        cars,
        summary: {
          totalStops: stops.length,
          totalCars: Object.keys(cars).length,
          avgServiceTime_s: Math.round((totalService / stops.length) * 100) / 100,
          avgTimeLost_s: Math.round((totalLost / stops.length) * 100) / 100,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/races/:id/favorite — Toggle favorite ─────────────────────────

racesRouter.post(
  "/:id/favorite",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user!.role !== "ADMIN") {
        const sub = await prisma.subscription.findUnique({
          where: { userId: req.user!.userId },
        });
        if (!sub || sub.plan === "FREE") {
          throw new AppError(
            403,
            "Favorites are a Pro feature — upgrade to save your favorite races",
            "INSUFFICIENT_TIER"
          );
        }
      }

      const isFavorited = await raceSvc.toggleFavorite(
        req.user!.userId,
        req.params.id as string
      );
      res.json({ isFavorited });
    } catch (err) {
      next(err);
    }
  }
);

import { Router, Request, Response, NextFunction } from "express";
import { requireAuth, optionalAuth, requireSubscription } from "../middleware/auth.js";
import { raceListQuerySchema } from "../utils/race-validators.js";
import { prisma } from "../models/prisma.js";
import * as raceSvc from "../services/races.js";
import { AppError } from "../middleware/error-handler.js";
import { normalizeTrackName } from "../services/pitStopAnalysis.service.js";

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
      const race = await raceSvc.getRaceDetail(req.params.id as string, req.user?.userId);
      // Non-admin can't see drafts
      if (race.status === "DRAFT" && req.user?.role !== "ADMIN") {
        res.status(404).json({ error: "Race not found", code: "RACE_NOT_FOUND" });
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
        // Determine user's plan
        let userPlan: string | null = null;
        const userRole = req.user?.role ?? null;

        if (req.user && userRole !== "ADMIN") {
          const sub = await prisma.subscription.findUnique({
            where: { userId: req.user.userId },
          });
          userPlan = sub?.plan ?? "FREE";
        }

        const access = await raceSvc.canUserAccessRace(race, userPlan, userRole);
        if (!access.accessible) {
          if (!req.user) {
            throw new AppError(403, "Sign in to access this race.", "AUTH_REQUIRED");
          }
          if (access.reason === "available_soon") {
            throw new AppError(403, "This race will be available to free members shortly. Pro members get instant access.", "AVAILABLE_SOON");
          }
          throw new AppError(403, "Upgrade to Pro or Team to access this race.", "SUBSCRIPTION_REQUIRED");
        }
      }

      const chartData = await raceSvc.getChartData(raceId);

      // Record view
      if (req.user) {
        raceSvc.recordView(req.user.userId, raceId).catch(() => {});
      }

      // Cache privately when authed, publicly for free races
      res.set("Cache-Control", req.user ? "private, max-age=300" : "public, max-age=300");
      res.json(chartData);
    } catch (err) {
      next(err);
    }
  }
);

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
        select: { id: true, track: true, series: true, status: true },
      });
      if (!race || (race.status === "DRAFT" && req.user?.role !== "ADMIN")) {
        throw new AppError(404, "Race not found", "RACE_NOT_FOUND");
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

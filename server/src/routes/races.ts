import { Router, Request, Response, NextFunction } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { raceListQuerySchema } from "../utils/race-validators.js";
import { prisma } from "../models/prisma.js";
import * as raceSvc from "../services/races.js";
import { AppError } from "../middleware/error-handler.js";

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
      const chartData = await raceSvc.getChartData(raceId);

      // Access gating
      const race = await prisma.race.findUnique({
        where: { id: raceId },
        select: { id: true, createdAt: true, premium: true },
      });
      if (race) {
        let userPlan: string | null = null;
        const userRole = req.user?.role ?? null;
        if (req.user?.userId) {
          const sub = await prisma.subscription.findUnique({
            where: { userId: req.user.userId },
          });
          if (sub) {
            const isActive = sub.status === "ACTIVE" || sub.status === "TRIALING";
            const inGracePeriod =
              sub.status === "CANCELED" &&
              sub.currentPeriodEnd &&
              sub.currentPeriodEnd > new Date();
            userPlan = isActive || inGracePeriod ? sub.plan : null;
          }
        }

        const access = await raceSvc.canUserAccessRace(race, userPlan, userRole);
        if (!access.accessible) {
          if (access.reason === "available_soon") {
            throw new AppError(403, "This race will be available to free members shortly", "AVAILABLE_SOON");
          }
          throw new AppError(403, "Upgrade to Pro to access the full race library", "INSUFFICIENT_TIER");
        }
      }

      // Record view if authenticated
      if (req.user?.userId) {
        raceSvc.recordView(req.user.userId, raceId).catch(() => {});
      }

      // Cache privately when authenticated
      res.set(
        "Cache-Control",
        req.user ? "private, max-age=300" : "public, max-age=300"
      );
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

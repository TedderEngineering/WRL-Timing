import { Router, Request, Response, NextFunction } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { raceListQuerySchema } from "../utils/race-validators.js";
import { prisma } from "../models/prisma.js";
import * as raceSvc from "../services/races.js";

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
      const race = await raceSvc.getRaceDetail(req.params.id, req.user?.userId);
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
      const raceId = req.params.id;
      const chartData = await raceSvc.getChartData(raceId);

      // Subscription gating: check access
      const isAdmin = req.user?.role === "ADMIN";
      if (!isAdmin) {
        let hasPaidAccess = false;
        if (req.user?.userId) {
          const subscription = await prisma.subscription.findUnique({
            where: { userId: req.user.userId },
          });
          if (subscription) {
            const isPaid = subscription.plan === "PRO" || subscription.plan === "TEAM";
            const isActive = subscription.status === "ACTIVE" || subscription.status === "TRIALING";
            const inGracePeriod =
              subscription.status === "CANCELED" &&
              subscription.currentPeriodEnd &&
              subscription.currentPeriodEnd > new Date();
            hasPaidAccess = isPaid && (isActive || !!inGracePeriod);
          }
        }

        if (!hasPaidAccess) {
          const isFree = await raceSvc.isFreeAccessRace(raceId);
          if (!isFree) {
            res.status(403).json({
              error: "This race requires a Pro subscription or higher.",
              code: "SUBSCRIPTION_REQUIRED",
            });
            return;
          }
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
      const entries = await raceSvc.getRaceEntries(req.params.id);
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
      const isFavorited = await raceSvc.toggleFavorite(
        req.user!.userId,
        req.params.id
      );
      res.json({ isFavorited });
    } catch (err) {
      next(err);
    }
  }
);

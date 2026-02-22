import { Router, Request, Response, NextFunction } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { raceListQuerySchema } from "../utils/race-validators.js";
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
      const chartData = await raceSvc.getChartData(req.params.id);

      // TODO: Phase 6 — subscription gating for premium races
      // For now, serve all chart data to all users

      // Record view if authenticated
      if (req.user?.userId) {
        raceSvc.recordView(req.user.userId, req.params.id).catch(() => {});
      }

      // Cache for 5 minutes (chart data doesn't change often)
      res.set("Cache-Control", "public, max-age=300");
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

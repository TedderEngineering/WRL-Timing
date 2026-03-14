import { Router, Request, Response, NextFunction } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { prisma } from "../models/prisma.js";
import { AppError } from "../middleware/error-handler.js";

export const qualifyingRouter = Router();

// ─── GET /api/qualifying — List published qualifying sessions ────────────────

qualifyingRouter.get(
  "/",
  optionalAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const sessions = await prisma.qualifyingSession.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { date: "desc" },
        select: {
          id: true,
          name: true,
          sessionName: true,
          date: true,
          track: true,
          series: true,
          season: true,
        },
      });

      res.json({
        sessions: sessions.map((s) => ({
          ...s,
          date: s.date.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/qualifying/:id/chart-data — Full qualifying dataset ────────────

qualifyingRouter.get(
  "/:id/chart-data",
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await prisma.qualifyingSession.findUnique({
        where: { id: req.params.id as string },
        select: {
          id: true,
          name: true,
          sessionName: true,
          date: true,
          track: true,
          series: true,
          season: true,
          chartData: true,
        },
      });

      if (!session) {
        throw new AppError(404, "Qualifying session not found", "SESSION_NOT_FOUND");
      }

      if (!session.chartData) {
        throw new AppError(404, "No chart data available", "NO_CHART_DATA");
      }

      res.set("Cache-Control", req.user ? "private, max-age=300" : "public, max-age=300");
      res.json({
        session: {
          id: session.id,
          name: session.name,
          sessionName: session.sessionName,
          date: session.date.toISOString(),
          track: session.track,
          series: session.series,
          season: session.season,
        },
        data: session.chartData,
      });
    } catch (err) {
      next(err);
    }
  }
);

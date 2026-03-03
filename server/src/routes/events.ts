import { Router, Request, Response, NextFunction } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { prisma } from "../models/prisma.js";
import { AppError } from "../middleware/error-handler.js";

export const eventsRouter = Router();

// ─── GET /api/events — List published events with race counts ────────────────

eventsRouter.get(
  "/",
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { series, season } = req.query;
      const isAdmin = req.user?.role === "ADMIN";

      const where: any = {};
      if (!isAdmin) where.status = "PUBLISHED";
      if (series) where.series = { equals: String(series), mode: "insensitive" };
      if (season) where.season = String(season);

      const events = await prisma.event.findMany({
        where,
        select: {
          id: true,
          name: true,
          series: true,
          track: true,
          date: true,
          season: true,
          _count: { select: { races: true } },
        },
        orderBy: { date: "desc" },
      });

      res.json({
        events: events.map((e) => ({
          id: e.id,
          name: e.name,
          series: e.series,
          track: e.track,
          date: e.date,
          season: e.season,
          raceCount: e._count.races,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/events/:id — Single event with nested races ───────────────────

eventsRouter.get(
  "/:id",
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eventId = req.params.id as string;
      const isAdmin = req.user?.role === "ADMIN";

      const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
          races: {
            where: isAdmin ? {} : { status: "PUBLISHED" },
            select: {
              id: true,
              name: true,
              date: true,
              status: true,
              series: true,
            },
            orderBy: { date: "asc" },
          },
        },
      });

      if (!event || (!isAdmin && event.status !== "PUBLISHED")) {
        throw new AppError(404, "Event not found");
      }

      res.json({
        id: event.id,
        name: event.name,
        series: event.series,
        track: event.track,
        date: event.date,
        season: event.season,
        races: event.races,
      });
    } catch (err) {
      next(err);
    }
  }
);

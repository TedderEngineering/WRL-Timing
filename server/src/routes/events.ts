import { Router, Request, Response, NextFunction } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { prisma } from "../models/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import { getFreeAccessRaceIds } from "../services/races.js";

export const eventsRouter = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getUserPlan(userId: string | undefined): Promise<string> {
  if (!userId) return "FREE";
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  return sub?.plan ?? "FREE";
}

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
          _count: {
            select: {
              races: isAdmin ? true : { where: { status: "PUBLISHED" } },
            },
          },
          races: {
            where: isAdmin ? {} : { status: "PUBLISHED" },
            select: { id: true, date: true },
            orderBy: { date: "asc" },
          },
        },
        orderBy: { date: "desc" },
      });

      // Determine free access race IDs for non-premium users
      const plan = isAdmin ? "ADMIN" : await getUserPlan(req.user?.userId);
      const fullAccess = isAdmin || plan === "PRO" || plan === "TEAM";
      const freeRaceIds = fullAccess ? [] : await getFreeAccessRaceIds();

      res.json({
        freeAccessRaceIds: freeRaceIds,
        events: events.map((e) => {
          const raceDates = e.races.map((r) => r.date);
          const startDate = raceDates[0] ?? e.date;
          const endDate = raceDates[raceDates.length - 1] ?? e.date;
          return {
            id: e.id,
            name: e.name,
            series: e.series,
            track: e.track,
            date: e.date,
            season: e.season,
            raceCount: e._count.races,
            raceIds: e.races.map((r) => r.id),
            startDate,
            endDate,
          };
        }),
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
              subSeries: true,
              roundNumber: true,
            },
            orderBy: { date: "asc" },
          },
          qualifyingSessions: {
            where: isAdmin ? {} : { status: "PUBLISHED" },
            select: {
              id: true,
              name: true,
              sessionName: true,
              date: true,
              series: true,
            },
            orderBy: { date: "asc" },
          },
        },
      });

      if (!event || (!isAdmin && event.status !== "PUBLISHED")) {
        throw new AppError(404, "Event not found");
      }

      // Determine per-race accessibility
      const plan = isAdmin ? "ADMIN" : await getUserPlan(req.user?.userId);
      const fullAccess = isAdmin || plan === "PRO" || plan === "TEAM";
      const freeRaceIds = fullAccess ? null : await getFreeAccessRaceIds();
      const freeSet = freeRaceIds ? new Set(freeRaceIds) : null;

      res.json({
        id: event.id,
        name: event.name,
        series: event.series,
        track: event.track,
        date: event.date,
        season: event.season,
        races: event.races.map((r) => ({
          ...r,
          accessible: fullAccess || (freeSet?.has(r.id) ?? false),
        })),
        qualifyingSessions: event.qualifyingSessions,
      });
    } catch (err) {
      next(err);
    }
  }
);

import { Router, Request, Response, NextFunction } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { prisma } from "../models/prisma.js";

export const searchRouter = Router();

// ─── GET /api/search?q=&series=&season= — Unified event+race search ─────────

searchRouter.get(
  "/",
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const series = req.query.series ? String(req.query.series) : undefined;
      const season = req.query.season ? String(req.query.season) : undefined;
      const isAdmin = req.user?.role === "ADMIN";

      if (!q && !series && !season) {
        return res.json({ events: [] });
      }

      const statusFilter = isAdmin ? {} : { status: "PUBLISHED" as const };

      // Build event-level match conditions
      const eventMatchClauses: any[] = [];
      if (q) {
        eventMatchClauses.push(
          { track: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { series: { contains: q, mode: "insensitive" } },
        );
      }

      // Build race-level match conditions
      const raceMatchClauses: any[] = [];
      if (q) {
        raceMatchClauses.push(
          { name: { contains: q, mode: "insensitive" } },
          { subSeries: { contains: q, mode: "insensitive" } },
        );
      }

      // Find events where event-level OR race-level fields match
      const where: any = {
        ...statusFilter,
        AND: [
          // Series/season filters
          ...(series ? [{ series: { equals: series, mode: "insensitive" } }] : []),
          ...(season ? [{ season }] : []),
          // Search query: match on event fields OR on nested race fields
          ...(q
            ? [{
                OR: [
                  ...eventMatchClauses,
                  { races: { some: { OR: raceMatchClauses } } },
                ],
              }]
            : []),
        ],
      };

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
        },
        orderBy: { date: "desc" },
        take: 20,
      });

      const results = events.map((e) => {
        const raceDates = e.races.map((r) => r.date);
        const startDate = raceDates[0] ?? e.date;
        const endDate = raceDates[raceDates.length - 1] ?? e.date;

        // Determine what the query matched on
        let matchedOn: "track" | "series" | "race" | "sub_series" | "name" = "track";
        if (q) {
          const ql = q.toLowerCase();
          if (e.track.toLowerCase().includes(ql)) {
            matchedOn = "track";
          } else if (e.series.toLowerCase().includes(ql)) {
            matchedOn = "series";
          } else if (e.name.toLowerCase().includes(ql)) {
            matchedOn = "name";
          } else {
            // Match was on a race-level field — filter to only matching races
            const matchingRaces = e.races.filter(
              (r) =>
                r.name.toLowerCase().includes(ql) ||
                (r.subSeries && r.subSeries.toLowerCase().includes(ql))
            );
            const matchedOnSubSeries = matchingRaces.some(
              (r) => r.subSeries && r.subSeries.toLowerCase().includes(ql)
            );
            return {
              id: e.id,
              name: e.name,
              series: e.series,
              track: e.track,
              date: e.date,
              season: e.season,
              raceCount: e._count.races,
              startDate,
              endDate,
              races: matchingRaces,
              matchedOn: matchedOnSubSeries ? "sub_series" as const : "race" as const,
            };
          }
        }

        return {
          id: e.id,
          name: e.name,
          series: e.series,
          track: e.track,
          date: e.date,
          season: e.season,
          raceCount: e._count.races,
          startDate,
          endDate,
          races: e.races,
          matchedOn,
        };
      });

      res.json({ events: results });
    } catch (err) {
      next(err);
    }
  }
);

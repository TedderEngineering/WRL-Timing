/**
 * The landing page's race news, for visitors who are not signed in (everything else needs an
 * account).
 *
 *   GET /api/landing   { latest, next, upcoming }
 *     latest:   the newest published race: name, track, date, series, results status, and its
 *               published story's headline (with the car and class names its tokens need)
 *     next:     the next race weekend on the season calendars (series, round, track, dates, and
 *               the first session's start when the live schedule knows it)
 *     upcoming: the two weekends after it
 *
 * Names and dates only: no chart data, no stories beyond the one headline. Cached 5 minutes.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { prisma } from "../models/prisma.js";
import { recapFor } from "./dashboard.js";
import { LIVE_SCHEDULE } from "../live/schedule.js";
import { availableSeasons, buildSeason, calendarFor, nextSessionFor, roundScheduleOver } from "../dashboard/season.js";
import type { Prose } from "../analysis/schema/package-types.js";

export const landingRouter = Router();

const TOKEN = /\{(?:\d+|car:([0-9A-Za-z]{1,8})|class:[A-Za-z0-9][A-Za-z0-9+_-]{0,31}|driver:([0-9A-Za-z]{1,8}):\d+)\}/g;

/** The cars a piece of prose names ({car:…} and {driver:…} tokens). */
export function carsNamed(p: Prose): string[] {
  const out = new Set<string>();
  for (const m of p.text.matchAll(TOKEN)) {
    if (m[1]) out.add(m[1]);
    if (m[2]) out.add(m[2]);
  }
  return [...out];
}

export interface LandingNext {
  series: string;
  name: string;
  track: string;
  start: string;
  end: string;
  session: { name: string; startsAt: string } | null;
}

/** The season's upcoming weekends across every series, soonest first. */
export async function upcomingWeekends(today: Date): Promise<LandingNext[]> {
  const seasons = availableSeasons();
  const year = today.getUTCFullYear();
  const out: LandingNext[] = [];
  for (const season of seasons.filter((s) => s >= year).sort()) {
    const cal = calendarFor(season);
    if (!cal) continue;
    const races = await prisma.race.findMany({
      where: { status: "PUBLISHED", season: cal.season },
      select: { id: true, name: true, date: true, track: true, series: true, subSeries: true },
    });
    const series = buildSeason(cal, races, today, (short, round) => roundScheduleOver(short, round, today.getTime(), LIVE_SCHEDULE));
    const calRounds = new Map(cal.series.map((s) => [s.id, s.rounds]));
    for (const s of series) {
      if (!s.next) continue;
      const r = (calRounds.get(s.id) ?? []).find((x) => x.round === s.next!.round);
      const session = r ? nextSessionFor(s.shortLabel, r, today.getTime(), LIVE_SCHEDULE) : null;
      out.push({
        series: s.shortLabel,
        name: s.next.name,
        track: s.next.track,
        start: s.next.start,
        end: s.next.end,
        session: session ? { name: session.name, startsAt: session.startsAt } : null,
      });
    }
    if (out.length) break;
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.series.localeCompare(b.series));
}

landingRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const race = (await prisma.race.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: [{ date: "desc" }, { maxLap: "desc" }],
      select: { name: true, date: true, track: true, series: true, resultsStatus: true, currentPackageId: true, packagesDisabled: true },
    })) as {
      name: string;
      date: Date;
      track: string;
      series: string;
      resultsStatus: string | null;
      currentPackageId: string | null;
      packagesDisabled: boolean;
    } | null;

    let latest = null;
    if (race) {
      const recap = race.currentPackageId && !race.packagesDisabled ? await recapFor(race.currentPackageId) : null;
      const named = recap ? carsNamed(recap.headline) : [];
      latest = {
        name: race.name,
        date: race.date.toISOString().slice(0, 10),
        track: race.track,
        series: race.series,
        official: race.resultsStatus === "official",
        headline: recap?.headline ?? null,
        // Only what the headline's tokens need.
        cars: Object.fromEntries(named.filter((c) => recap?.cars[c]).map((c) => [c, recap!.cars[c]])),
        classes: recap?.classes ?? {},
      };
    }
    const weekends = await upcomingWeekends(new Date());
    res.set("Cache-Control", "public, max-age=300");
    res.json({ latest, next: weekends[0] ?? null, upcoming: weekends.slice(1, 3) });
  } catch (err) {
    next(err);
  }
});

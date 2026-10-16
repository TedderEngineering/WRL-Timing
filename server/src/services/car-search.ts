/**
 * Car search: find a car by its number ("67", "#67") or its team ("blackdog"), with every
 * published race it ran, newest first. One car is one series family, one number and one team
 * ("7" and "007" are one number), so the same number in IMSA and WRL are two results.
 */
import { prisma } from "../models/prisma.js";
import { normCar, raceFamily } from "../intake/reimport.js";
import { canonicalTrack } from "../lib/weekends.js";
import type { DriverRace } from "./driver-search.js";

export interface CarResult {
  /** "imsa" | "sro" | "wrl" */
  series: string;
  number: string;
  team: string;
  /** The class in its newest race. */
  carClass: string;
  races: DriverRace[];
}

export interface CarEntryRow {
  carNumber: string;
  teamName: string;
  carClass: string;
  finishPos: number | null;
  finishPosClass: number | null;
  race: { id: string; name: string; date: Date; track: string; series: string; subSeries: string | null };
}

const teamOf = (t: string) => t.replace(/\s*\([^()]*\)\s*$/, "").trim();
const teamKey = (t: string) => teamOf(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A car number query: digits and letters only, at most 8 ("#67", "4A", "007"). */
export function numberQuery(q: string): string | null {
  const t = q.trim().replace(/^#/, "");
  return /^\d[0-9A-Za-z]{0,7}$/.test(t) ? t : null;
}

/** Group race entries into cars, most races first, each car's races newest first. */
export function groupCars(rows: CarEntryRow[], max = 20): CarResult[] {
  const by = new Map<string, { series: string; numbers: Map<string, number>; teams: Map<string, number>; races: Map<string, DriverRace>; newest: CarEntryRow }>();
  for (const r of rows) {
    const series = raceFamily(r.race.series, r.race.subSeries);
    if (!series) continue;
    const key = `${series}|${normCar(r.carNumber)}|${teamKey(r.teamName)}`;
    const g = by.get(key) ?? { series, numbers: new Map(), teams: new Map(), races: new Map(), newest: r };
    by.set(key, g);
    g.numbers.set(r.carNumber.trim(), (g.numbers.get(r.carNumber.trim()) ?? 0) + 1);
    g.teams.set(teamOf(r.teamName), (g.teams.get(teamOf(r.teamName)) ?? 0) + 1);
    if (r.race.date > g.newest.race.date) g.newest = r;
    g.races.set(r.race.id, {
      raceId: r.race.id,
      raceName: r.race.name,
      date: r.race.date.toISOString().slice(0, 10),
      track: canonicalTrack(r.race.track),
      series: r.race.series,
      carNumber: r.carNumber,
      teamName: teamOf(r.teamName),
      carClass: r.carClass,
      finishPos: r.finishPos,
      finishPosClass: r.finishPosClass,
    });
  }
  const most = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return [...by.values()]
    .map((g) => ({
      series: g.series,
      number: most(g.numbers),
      team: most(g.teams),
      carClass: g.newest.carClass,
      races: [...g.races.values()].sort((a, b) => b.date.localeCompare(a.date) || a.raceName.localeCompare(b.raceName)),
    }))
    .sort((a, b) => b.races[0].date.localeCompare(a.races[0].date) || b.races.length - a.races.length)
    .slice(0, max);
}

/** Cars matching a number (exactly, "7" = "007") or a team name (2+ letters). */
export async function searchCars(query: string): Promise<CarResult[]> {
  const q = query.trim();
  const num = numberQuery(q);
  if (!num && q.replace(/\s/g, "").length < 3) return [];
  const numbers = num ? [...new Set([num, normCar(num), num.toUpperCase()])] : [];
  // "7" also finds "007": zero-padded forms of a plain number.
  if (num && /^\d+$/.test(num)) for (const pad of ["0", "00"]) numbers.push(pad + normCar(num));
  const rows = (await prisma.raceEntry.findMany({
    where: {
      race: { status: "PUBLISHED" },
      ...(num ? { carNumber: { in: numbers } } : { teamName: { contains: q, mode: "insensitive" } }),
    },
    select: {
      carNumber: true,
      teamName: true,
      carClass: true,
      finishPos: true,
      finishPosClass: true,
      race: { select: { id: true, name: true, date: true, track: true, series: true, subSeries: true } },
    },
    orderBy: { race: { date: "desc" } },
    take: 3000,
  })) as CarEntryRow[];
  return groupCars(rows.filter((r) => !num || normCar(r.carNumber) === normCar(num)));
}

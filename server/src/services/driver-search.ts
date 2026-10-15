/**
 * Driver search: every published race a driver ran in, from the race entries' driver names
 * (RaceEntry.driverNames, "Name; Name", filled by the imports from each source's driver list).
 *
 * Matching ignores case and accents; every word of the query must start a word of the name
 * ("veach", "zach vea", "kirchhofer" for "Kirchhöfer"). Spellings of one driver across sources
 * ("Marvin Kirchhöfer", "KIRCHHOFER Marvin") are one driver (driverKey).
 */
import { prisma } from "../models/prisma.js";
import { DRIVER_SEPARATOR, driverKey } from "../utils/driverNames.js";
import { canonicalTrack } from "../lib/weekends.js";

export interface DriverRace {
  raceId: string;
  raceName: string;
  date: string;
  track: string;
  series: string;
  carNumber: string;
  teamName: string;
  carClass: string;
  finishPos: number | null;
  finishPosClass: number | null;
}

export interface DriverResult {
  name: string;
  races: DriverRace[];
}

const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Every query word starts some word of the name. */
export function nameMatches(name: string, query: string): boolean {
  const q = words(query);
  const n = words(name);
  return q.length > 0 && q.every((w) => n.some((x) => x.startsWith(w)));
}

/** "Zach VEACH" → "Zach Veach"; mixed-case names are kept as written. */
export function displayName(name: string): string {
  return /[a-z]/.test(name) && /[A-Z]/.test(name) && !/\b[A-Z]{3,}\b/.test(name)
    ? name
    : name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
}

export interface EntryRow {
  carNumber: string;
  teamName: string;
  carClass: string;
  finishPos: number | null;
  finishPosClass: number | null;
  driverNames: string;
  race: { id: string; name: string; date: Date; track: string; series: string };
}

/** Group matching entries by driver, most races first, each driver's races newest first. */
export function groupDrivers(rows: EntryRow[], query: string, maxDrivers = 20): DriverResult[] {
  const byKey = new Map<string, { names: Map<string, number>; races: Map<string, DriverRace> }>();
  for (const r of rows) {
    for (const raw of r.driverNames.split(/;\s*/)) {
      const name = raw.trim();
      if (!name || !nameMatches(name, query)) continue;
      const key = driverKey(name);
      const g = byKey.get(key) ?? { names: new Map(), races: new Map() };
      byKey.set(key, g);
      g.names.set(name, (g.names.get(name) ?? 0) + 1);
      g.races.set(r.race.id, {
        raceId: r.race.id,
        raceName: r.race.name,
        date: r.race.date.toISOString().slice(0, 10),
        track: canonicalTrack(r.race.track),
        series: r.race.series,
        carNumber: r.carNumber,
        teamName: r.teamName.replace(/\s*\([^()]*\)\s*$/, ""),
        carClass: r.carClass,
        finishPos: r.finishPos,
        finishPosClass: r.finishPosClass,
      });
    }
  }
  return [...byKey.values()]
    .map((g) => {
      // The spelling seen most, preferring one written in mixed case.
      const best = [...g.names.entries()].sort((a, b) => b[1] - a[1] || Number(/[a-z]/.test(b[0])) - Number(/[a-z]/.test(a[0])))[0][0];
      return { name: displayName(best), races: [...g.races.values()].sort((a, b) => b.date.localeCompare(a.date) || a.raceName.localeCompare(b.raceName)) };
    })
    .sort((a, b) => b.races.length - a.races.length || a.name.localeCompare(b.name))
    .slice(0, maxDrivers);
}

/**
 * The database narrows by the longest query word's first letters (accents in the rest of a
 * name do not stop a match); groupDrivers does the exact match.
 */
export async function searchDrivers(query: string): Promise<DriverResult[]> {
  const q = words(query);
  if (!q.length || q.join("").length < 3) return [];
  const longest = q.reduce((a, b) => (b.length > a.length ? b : a));
  const stem = longest.slice(0, Math.min(4, longest.length));
  const rows = (await prisma.raceEntry.findMany({
    where: { driverNames: { contains: stem, mode: "insensitive" }, race: { status: "PUBLISHED" } },
    select: {
      carNumber: true,
      teamName: true,
      carClass: true,
      finishPos: true,
      finishPosClass: true,
      driverNames: true,
      race: { select: { id: true, name: true, date: true, track: true, series: true } },
    },
    take: 5000,
  })) as EntryRow[];
  return groupDrivers(rows, query);
}

export { DRIVER_SEPARATOR };

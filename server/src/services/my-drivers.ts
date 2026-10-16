/**
 * My drivers: the drivers a user follows, whatever car or series they race in.
 *
 * A race entry has the driver when one of its driver names (RaceEntry.driverNames, "A; B",
 * from each source's driver list) is the same driver: the same driverKey (accents, case and
 * word order ignored), or one name holding every word of the other ("Alex Rivera" and
 * "Alex J. Rivera"). Two people with one name are one driver (owner decision, Oct 16 2026).
 */
import { z } from "zod";
import { prisma } from "../models/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import { DRIVER_SEPARATOR, driverKey } from "../utils/driverNames.js";
import { displayName } from "./driver-search.js";
import { canonicalTrack } from "../lib/weekends.js";

export const MAX_DRIVERS = 20;

const wordsOf = (key: string) => key.split(" ").filter((w) => w.length > 1 || /\d/.test(w));

/** True when two driver names are one driver. Initials are left out of the word check. */
export function sameDriver(a: string, b: string): boolean {
  const ka = driverKey(a);
  const kb = driverKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const wa = wordsOf(ka);
  const wb = wordsOf(kb);
  if (wa.length < 2 || wb.length < 2) return false;
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return short.every((w) => long.includes(w));
}

/** The entry's spelling of the driver, when the entry has them. */
export function driverInNames(driverNames: string | null | undefined, name: string): string | null {
  for (const raw of String(driverNames ?? "").split(/;\s*/)) {
    const n = raw.trim();
    if (n && sameDriver(n, name)) return n;
  }
  return null;
}

/** The other drivers of the entry, display-cased. */
export function coDrivers(driverNames: string | null | undefined, name: string): string[] {
  return String(driverNames ?? "")
    .split(/;\s*/)
    .map((n) => n.trim())
    .filter((n) => n && !sameDriver(n, name))
    .map(displayName);
}

export interface DriverRaceRow {
  raceId: string;
  raceName: string;
  date: string;
  track: string;
  series: string;
  subSeries: string | null;
  carNumber: string;
  teamName: string;
  carClass: string;
  finishPos: number | null;
  finishPosClass: number | null;
  /** The entry's spelling of the driver. */
  spelledAs: string;
  driverNames: string;
}

const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Every published race the driver ran in, newest first. The database narrows by the first letters
 * of the name's longest word (accents later in a name do not stop a match); sameDriver decides.
 */
export async function racesForDriver(name: string, limit = 200): Promise<DriverRaceRow[]> {
  const w = words(name);
  if (!w.length) return [];
  const longest = w.reduce((a, b) => (b.length > a.length ? b : a));
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
      race: { select: { id: true, name: true, date: true, track: true, series: true, subSeries: true } },
    },
    orderBy: { race: { date: "desc" } },
    take: 5000,
  })) as Array<{
    carNumber: string;
    teamName: string;
    carClass: string;
    finishPos: number | null;
    finishPosClass: number | null;
    driverNames: string;
    race: { id: string; name: string; date: Date; track: string; series: string; subSeries: string | null };
  }>;
  const out: DriverRaceRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.race.id)) continue;
    const spelledAs = driverInNames(r.driverNames, name);
    if (!spelledAs) continue;
    seen.add(r.race.id);
    out.push({
      raceId: r.race.id,
      raceName: r.race.name,
      date: r.race.date.toISOString().slice(0, 10),
      track: canonicalTrack(r.race.track),
      series: r.race.series,
      subSeries: r.race.subSeries,
      carNumber: r.carNumber,
      teamName: r.teamName.replace(/\s*\([^()]*\)\s*$/, ""),
      carClass: r.carClass,
      finishPos: r.finishPos,
      finishPosClass: r.finishPosClass,
      spelledAs,
      driverNames: r.driverNames,
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.raceName.localeCompare(b.raceName));
  return out.slice(0, limit);
}

/** The spelling seen most, preferring mixed case, display-cased. */
export function bestSpelling(rows: { spelledAs: string }[], fallback: string): string {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.spelledAs, (count.get(r.spelledAs) ?? 0) + 1);
  const best = [...count.entries()].sort(
    (a, b) => b[1] - a[1] || Number(/[a-z]/.test(b[0])) - Number(/[a-z]/.test(a[0]))
  )[0]?.[0];
  return displayName(best ?? fallback);
}

// ─── Followed drivers ─────────────────────────────────────────────────────────

export const followDriverSchema = z.object({ name: z.string().trim().min(3).max(120) });
export const updateDriverSchema = z.object({ alerts: z.boolean() });

const select = { id: true, name: true, key: true, alerts: true, createdAt: true } as const;

export interface FollowedDriver {
  id: string;
  name: string;
  key: string;
  alerts: boolean;
  createdAt: Date;
}

export async function listDrivers(userId: string): Promise<FollowedDriver[]> {
  return (await prisma.userDriver.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select })) as FollowedDriver[];
}

/**
 * Follow a driver by name (from a race page, the driver search or Settings). The driver must have
 * raced in a published race; following one already followed returns that one.
 */
export async function followDriver(userId: string, body: unknown) {
  const { name } = followDriverSchema.parse(body);
  const races = await racesForDriver(name, 200);
  if (races.length === 0) throw new AppError(404, `No race on RaceTrace has a driver called ${name}`, "DRIVER_NOT_FOUND");
  const shown = bestSpelling(races, name);
  const key = driverKey(shown);
  const mine = await listDrivers(userId);
  const existing = mine.find((d) => d.key === key || sameDriver(d.name, shown));
  if (existing) return { driver: existing, created: false };
  if (mine.length >= MAX_DRIVERS) {
    throw new AppError(409, `You can follow up to ${MAX_DRIVERS} drivers. Remove one in Settings → My drivers first.`, "TOO_MANY_DRIVERS");
  }
  const driver = (await prisma.userDriver.create({ data: { userId, name: shown, key }, select })) as FollowedDriver;
  return { driver, created: true };
}

async function owned(userId: string, id: string) {
  const d = (await prisma.userDriver.findUnique({ where: { id }, select: { id: true, userId: true } })) as { id: string; userId: string } | null;
  if (!d || d.userId !== userId) throw new AppError(404, "Driver not found", "DRIVER_NOT_FOUND");
}

export async function updateDriver(userId: string, id: string, body: unknown) {
  const b = updateDriverSchema.parse(body);
  await owned(userId, id);
  return (await prisma.userDriver.update({ where: { id }, data: { alerts: b.alerts }, select })) as FollowedDriver;
}

export async function deleteDriver(userId: string, id: string) {
  await owned(userId, id);
  await prisma.userDriver.delete({ where: { id } });
}

/** The race's drivers the user follows: the entry's spelling, the car and the followed driver. */
export async function followedDriversInRace(userId: string, raceId: string) {
  const [drivers, entries] = await Promise.all([
    listDrivers(userId),
    prisma.raceEntry.findMany({ where: { raceId }, select: { carNumber: true, driverNames: true } }) as Promise<{ carNumber: string; driverNames: string }[]>,
  ]);
  const out: { name: string; carNumber: string; driverId: string }[] = [];
  for (const d of drivers) {
    for (const e of entries) {
      const n = driverInNames(e.driverNames, d.name);
      if (n) out.push({ name: n, carNumber: e.carNumber, driverId: d.id });
    }
  }
  return out;
}

export { DRIVER_SEPARATOR };

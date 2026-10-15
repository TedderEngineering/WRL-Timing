/**
 * My cars (engagement plan B): the cars a user follows.
 *
 * A race entry is the user's car when
 *   - the race's series family matches the car's ("imsa" | "sro" | "wrl"),
 *   - the car number matches ("007" and "7" are one car, as in the parsers),
 *   - the team matches when the car has one (case and punctuation ignored, either name may
 *     hold the other: "Blackdog" matches "Blackdog Racing"),
 *   - and the race is in the car's season when it has one (numbers change between seasons).
 */
import { z } from "zod";
import { prisma } from "../models/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import { normCar, raceFamily } from "../intake/reimport.js";

export const SERIES_FAMILIES = ["imsa", "sro", "wrl"] as const;
export type SeriesFamily = (typeof SERIES_FAMILIES)[number];
export const MAX_CARS = 20;

export interface CarRule {
  number: string;
  series: string;
  teamName?: string | null;
  season?: number | null;
}

const teamKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function teamsMatch(want: string | null | undefined, entry: string | null | undefined): boolean {
  if (!want || !teamKey(want)) return true;
  const a = teamKey(want);
  const b = teamKey(entry ?? "");
  return !!b && (a === b || b.includes(a) || a.includes(b));
}

export function carMatchesEntry(
  car: CarRule,
  race: { series: string; subSeries?: string | null; season: number },
  entry: { carNumber: string; teamName?: string | null }
): boolean {
  if (raceFamily(race.series, race.subSeries) !== car.series) return false;
  if (car.season && race.season !== car.season) return false;
  if (normCar(entry.carNumber) !== normCar(car.number)) return false;
  return teamsMatch(car.teamName, entry.teamName);
}

/**
 * The race entry a followed car is, when one is. A race can run "7" and "007" as two cars
 * (utils/carNumbers.ts): the entry with the car's exact number wins over one that only
 * reduces to the same integer.
 */
export function entryForCar<E extends { carNumber: string; teamName?: string | null }>(
  car: CarRule,
  race: { series: string; subSeries?: string | null; season: number },
  entries: E[]
): E | undefined {
  const all = entries.filter((e) => carMatchesEntry(car, race, e));
  return all.find((e) => e.carNumber.trim() === car.number.trim()) ?? all[0];
}

const carFields = {
  label: z.string().trim().max(60).nullish(),
  number: z.string().trim().min(1).max(8).regex(/^[0-9A-Za-z]+$/, "Car numbers are letters and digits"),
  series: z.enum(SERIES_FAMILIES),
  teamName: z.string().trim().max(120).nullish(),
  carClass: z.string().trim().max(40).nullish(),
  season: z.number().int().min(2000).max(2100).nullish(),
};
export const createCarSchema = z.object(carFields);
export const updateCarSchema = z.object(carFields).partial();
export const followSchema = z.object({ raceId: z.string().min(1), carNumber: z.string().trim().min(1).max(8) });

const select = { id: true, label: true, number: true, series: true, teamName: true, carClass: true, season: true, createdAt: true } as const;
const blankToNull = (v: string | null | undefined) => (v === undefined ? undefined : v && v.length ? v : null);

export async function listCars(userId: string) {
  return prisma.userCar.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select });
}

async function assertRoom(userId: string) {
  if ((await prisma.userCar.count({ where: { userId } })) >= MAX_CARS) {
    throw new AppError(409, `You can follow up to ${MAX_CARS} cars. Remove one in Settings → My cars first.`, "TOO_MANY_CARS");
  }
}

export async function createCar(userId: string, body: unknown) {
  const b = createCarSchema.parse(body);
  await assertRoom(userId);
  return prisma.userCar.create({
    data: {
      userId,
      number: b.number,
      series: b.series,
      label: blankToNull(b.label) ?? null,
      teamName: blankToNull(b.teamName) ?? null,
      carClass: blankToNull(b.carClass) ?? null,
      season: b.season ?? null,
    },
    select,
  });
}

/**
 * Follow a car from a race page: series, team, class and season come from the race's entry.
 * Following a car already followed (same match) returns that car instead of a second copy.
 */
export async function followFromRace(userId: string, body: unknown) {
  const { raceId, carNumber } = followSchema.parse(body);
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    select: { id: true, series: true, subSeries: true, season: true, status: true, entries: { select: { carNumber: true, teamName: true, carClass: true } } },
  });
  if (!race || race.status !== "PUBLISHED") throw new AppError(404, "Race not found", "RACE_NOT_FOUND");
  const entry =
    race.entries.find((e) => e.carNumber.trim() === carNumber.trim()) ??
    race.entries.find((e) => normCar(e.carNumber) === normCar(carNumber));
  if (!entry) throw new AppError(404, `Car #${carNumber} is not in this race`, "CAR_NOT_FOUND");
  const series = raceFamily(race.series, race.subSeries);
  if (!series) throw new AppError(400, "This race's series cannot be followed yet", "SERIES_UNKNOWN");

  const existing = (await listCars(userId)).find((c) => carMatchesEntry(c, race, entry));
  if (existing) return { car: existing, created: false };
  await assertRoom(userId);
  const car = await prisma.userCar.create({
    data: { userId, number: entry.carNumber, series, teamName: entry.teamName || null, carClass: entry.carClass || null, season: race.season },
    select,
  });
  return { car, created: true };
}

async function owned(userId: string, id: string) {
  const car = await prisma.userCar.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!car || car.userId !== userId) throw new AppError(404, "Car not found", "CAR_NOT_FOUND");
}

export async function updateCar(userId: string, id: string, body: unknown) {
  const b = updateCarSchema.parse(body);
  await owned(userId, id);
  return prisma.userCar.update({
    where: { id },
    data: {
      ...(b.number !== undefined ? { number: b.number } : {}),
      ...(b.series !== undefined ? { series: b.series } : {}),
      ...(b.label !== undefined ? { label: blankToNull(b.label) } : {}),
      ...(b.teamName !== undefined ? { teamName: blankToNull(b.teamName) } : {}),
      ...(b.carClass !== undefined ? { carClass: blankToNull(b.carClass) } : {}),
      ...(b.season !== undefined ? { season: b.season } : {}),
    },
    select,
  });
}

export async function deleteCar(userId: string, id: string) {
  await owned(userId, id);
  await prisma.userCar.delete({ where: { id } });
}

/** The race's car numbers that are the user's cars, with the car each one is. */
export async function followedInRace(userId: string, raceId: string) {
  const [cars, race] = await Promise.all([
    listCars(userId),
    prisma.race.findUnique({ where: { id: raceId }, select: { series: true, subSeries: true, season: true, entries: { select: { carNumber: true, teamName: true } } } }),
  ]);
  if (!race || cars.length === 0) return [];
  const out: { carNumber: string; carId: string }[] = [];
  for (const c of cars) {
    const e = entryForCar(c, race, race.entries);
    if (e && !out.some((o) => o.carNumber === e.carNumber)) out.push({ carNumber: e.carNumber, carId: c.id });
  }
  return out;
}

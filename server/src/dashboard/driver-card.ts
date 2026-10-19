/**
 * A driver's card for one race: the race, the car, the car's facts and the driver's drive. The
 * dashboard's driver panel (any of the driver's races, the latest by default) and the race page's
 * Drivers list (any driver of any car) both draw their share card from this.
 *
 * The caller checks access to the race first.
 */
import { prisma } from "../models/prisma.js";
import { withPitFacts } from "../packages/race-pit-facts.js";
import { normCar } from "../intake/reimport.js";
import { coDrivers, driverInNames } from "../services/my-drivers.js";
import { carFacts, chartKeyFor, type CarFacts } from "./my-car.js";
import { carDrive, driverFacts, type CarDrive, type DriverFacts } from "./my-driver.js";
import { driverHighlights, type Highlight } from "./highlights.js";

export interface DriverCardCar {
  number: string;
  team: string;
  cls: string;
  coDrivers: string[];
}

export interface DriverCardData {
  facts: CarFacts | null;
  driverFacts: DriverFacts | null;
  /** What went right for the driver, ranked (dashboard/highlights.ts). */
  driverHighlights: Highlight[];
}

/** Every entry's drivers in the race, by car number (to name each class car's stints). */
async function driversByCar(raceId: string): Promise<Record<string, string[]>> {
  const rows = (await prisma.raceEntry.findMany({ where: { raceId }, select: { carNumber: true, driverNames: true } })) as Array<{ carNumber: string; driverNames: string }>;
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    out[r.carNumber] = entryDrivers(r.driverNames);
    out[normCar(r.carNumber)] ??= out[r.carNumber];
  }
  return out;
}

/** The entry's drivers as a list ("A; B; C"). */
export function entryDrivers(driverNames: string | null | undefined): string[] {
  return String(driverNames ?? "")
    .split(/;\s*/)
    .map((n) => n.trim())
    .filter(Boolean);
}

export function cardCar(entry: { carNumber: string; teamName: string; carClass: string; driverNames: string }, driverName: string): DriverCardCar {
  return {
    number: entry.carNumber,
    team: entry.teamName.replace(/\s*\([^()]*\)\s*$/, ""),
    cls: entry.carClass,
    coDrivers: coDrivers(entry.driverNames, driverName),
  };
}

/** The car's facts and the driver's drive, from the race's stored chart data. */
export async function driverCardData(raceId: string, carNumber: string, driverName: string, driverNames: string): Promise<DriverCardData> {
  const row = (await prisma.race.findUnique({
    where: { id: raceId },
    select: { id: true, chartData: true, annotationData: true, currentPackageId: true, packagesDisabled: true },
  })) as any;
  const data = row?.chartData ? ((await withPitFacts(row, { data: row.chartData, annotations: row.annotationData ?? {} })) as any) : null;
  if (!data) return { facts: null, driverFacts: null, driverHighlights: [] };
  const facts = carFacts(data.data, data.annotations ?? null, carNumber);
  const key = chartKeyFor(data.data, carNumber);
  const drive = key ? driverFacts(data.data.cars[key], data.annotations?.[key]?.pits, driverName, entryDrivers(driverNames)) : null;
  const highlights = key && drive?.known ? driverHighlights(data.data, data.annotations ?? null, key, driverName, await driversByCar(raceId), facts) : [];
  return { facts, driverFacts: drive, driverHighlights: highlights };
}

/**
 * The race's entry for a car number as the chart labels it ("007", "4A"): the exact number first,
 * else the one that reduces to the same number.
 */
export function pickEntry<E extends { carNumber: string }>(entries: E[], carNumber: string): E | undefined {
  const want = carNumber.trim();
  return entries.find((e) => e.carNumber.trim() === want) ?? entries.find((e) => normCar(e.carNumber) === normCar(want));
}

/** The driver as the entry spells them, when they are in it. */
export function driverOfEntry(entry: { driverNames: string }, name: string): string | null {
  return driverInNames(entry.driverNames, name);
}

/** The car's facts and drive (who drove when, every driver), for the car's share card. */
export async function carCardData(raceId: string, carNumber: string, driverNames: string): Promise<{ facts: CarFacts | null; drive: CarDrive | null }> {
  const row = (await prisma.race.findUnique({
    where: { id: raceId },
    select: { id: true, chartData: true, annotationData: true, currentPackageId: true, packagesDisabled: true },
  })) as any;
  const data = row?.chartData ? ((await withPitFacts(row, { data: row.chartData, annotations: row.annotationData ?? {} })) as any) : null;
  if (!data) return { facts: null, drive: null };
  const facts = carFacts(data.data, data.annotations ?? null, carNumber);
  const drive = facts ? carDrive(data.data.cars[facts.carKey], data.annotations?.[facts.carKey]?.pits, entryDrivers(driverNames)) : null;
  return { facts, drive };
}

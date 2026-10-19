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
import { driverFacts, type DriverFacts } from "./my-driver.js";

export interface DriverCardCar {
  number: string;
  team: string;
  cls: string;
  coDrivers: string[];
}

export interface DriverCardData {
  facts: CarFacts | null;
  driverFacts: DriverFacts | null;
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
  if (!data) return { facts: null, driverFacts: null };
  const facts = carFacts(data.data, data.annotations ?? null, carNumber);
  const key = chartKeyFor(data.data, carNumber);
  const drive = key ? driverFacts(data.data.cars[key], data.annotations?.[key]?.pits, driverName, entryDrivers(driverNames)) : null;
  return { facts, driverFacts: drive };
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

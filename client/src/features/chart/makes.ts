/**
 * Car makes for the Make filter. The IMSA import gives make groups; SRO and GR
 * Cup races only have the vehicle ("McLaren Artura GT4"), so the make is read
 * from its first words. Races without either (WRL) have no make filter.
 */
import type { RaceChartData } from "@shared/types";

const MAKES: Array<[RegExp, string]> = [
  [/^mercedes[- ]?amg|^mercedes|^amg\b/i, "Mercedes-AMG"],
  [/^aston\s*martin/i, "Aston Martin"],
  [/^bmw/i, "BMW"],
  [/^ford/i, "Ford"],
  [/^toyota/i, "Toyota"],
  [/^mclaren/i, "McLaren"],
  [/^porsche/i, "Porsche"],
  [/^chevrolet|^chevy|^corvette/i, "Chevrolet"],
  [/^audi/i, "Audi"],
  [/^lamborghini/i, "Lamborghini"],
  [/^ferrari/i, "Ferrari"],
  [/^acura/i, "Acura"],
  [/^honda/i, "Honda"],
  [/^hyundai/i, "Hyundai"],
  [/^mazda/i, "Mazda"],
  [/^nissan/i, "Nissan"],
  [/^lexus/i, "Lexus"],
  [/^cadillac/i, "Cadillac"],
  [/^ginetta/i, "Ginetta"],
  [/^maserati/i, "Maserati"],
  [/^alpine/i, "Alpine"],
  [/^ktm/i, "KTM"],
  [/^volkswagen|^vw\b/i, "Volkswagen"],
  [/^subaru/i, "Subaru"],
];

export function makeOf(text: string | undefined | null): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  for (const [re, name] of MAKES) if (re.test(t)) return name;
  return null;
}

/** Make → car numbers: the import's groups when it has them, else read from each car's make or vehicle. */
export function makeGroupsOf(data: RaceChartData): Record<string, number[]> {
  if (data.makeGroups && Object.keys(data.makeGroups).length) return data.makeGroups;
  const out: Record<string, number[]> = {};
  for (const c of Object.values(data.cars)) {
    const m = makeOf(c.make) ?? makeOf(c.vehicle);
    if (!m) continue;
    (out[m] ??= []).push(c.num);
  }
  return out;
}

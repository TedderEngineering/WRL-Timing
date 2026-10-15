/**
 * Driver names for a car, as the import found them (driver search, RaceEntry.driverNames).
 * Trimmed, de-duplicated without regard to case or accents, in first-seen order; blanks and
 * placeholders dropped.
 */
export function uniqueDrivers(names: Iterable<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const n = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!n || /^[\d\W_]+$/.test(n) || /^(tbd|tba|n\/a|unknown|driver \d+)$/i.test(n)) continue;
    const key = driverKey(n);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n.slice(0, 120));
    if (out.length === 12) break;
  }
  return out;
}

/** "Kirchhöfer, Marvin", "MARVIN KIRCHHOFER" and "Marvin Kirchhöfer" → one key. */
export function driverKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** How RaceEntry.driverNames stores them. */
export const DRIVER_SEPARATOR = "; ";

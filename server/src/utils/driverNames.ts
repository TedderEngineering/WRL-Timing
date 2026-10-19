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

/**
 * A driver as the timing names them in one place ("Boehm", "K. Boehm") made into the car's full
 * name ("Kevin Boehm") when exactly one of the car's drivers fits: every full word matches and
 * each initial starts one of their names. Otherwise the name is kept as it is.
 */
export function expandDriverName(name: string, carDrivers: string[]): string {
  const same = carDrivers.find((d) => sameDriver(d, name));
  if (same) return same;
  const key = driverKey(name).split(" ").filter(Boolean);
  const full = key.filter((w) => w.length > 1);
  const initials = key.filter((w) => w.length === 1);
  if (!full.length) return name;
  const fits = carDrivers.filter((d) => {
    const dw = driverKey(d).split(" ");
    return full.every((w) => dw.includes(w)) && initials.every((i) => dw.some((x) => x.startsWith(i)));
  });
  return fits.length === 1 ? fits[0] : name;
}

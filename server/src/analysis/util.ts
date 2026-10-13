/**
 * Small pure helpers shared by the fact engine (no I/O, no clock).
 */

/** 'H:MM:SS.mmm' / 'M:SS.mmm' / 'SS.mmm' → seconds. Blank, '-' or unparsable → null (never 0). */
export function parseDuration(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s || s === "-") return null;
  if (!/^\d+(?::\d+)*(?:\.\d+)?$/.test(s)) return null;
  let v = 0;
  for (const p of s.split(":")) v = v * 60 + Number(p);
  return Number.isFinite(v) ? v : null;
}

/** Round to n decimals (3 = millisecond precision). null passes through. */
export function rd(x: number, n?: number): number;
export function rd(x: number | null | undefined, n?: number): number | null;
export function rd(x: number | null | undefined, n = 3): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  const f = 10 ** n;
  const r = Math.round((x + 0) * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Median; even count = mean of the two middle values (Python statistics.median). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let s = 0;
  for (const x of values) s += x;
  return s / values.length;
}

/** Display / tie-break order for car strings: (length, string). Never numeric (D-CAR). */
export function carOrder(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

export function byCar<T extends { car: string }>(a: T, b: T): number {
  return carOrder(a.car, b.car);
}

/** Class id slug (schema ClassId pattern ^[A-Za-z0-9][A-Za-z0-9+_-]{0,31}$). */
export function classSlug(name: string): string {
  const s = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9+_-]/g, "")
    .replace(/^[^A-Za-z0-9]+/, "");
  return (s || "Unclassified").slice(0, 32);
}

/** Car id as exported, trimmed. Never parsed as a number (D-CAR). */
export function carId(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

/** Lower-bound binary search: first index with arr[i] >= x. */
export function lowerBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Upper-bound binary search: first index with arr[i] > x. */
export function upperBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * UTC offset in minutes of an IANA zone at a UTC instant (ms), e.g. -240 for EDT.
 * Uses the platform ICU data (deterministic for a given Node build).
 */
export function zoneOffsetMinutes(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** Offset of a zone for a local wall-clock time on a date (two-pass, handles DST). */
export function zoneOffsetForLocal(timeZone: string, date: string, localSeconds: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d) + localSeconds * 1000;
  const o1 = zoneOffsetMinutes(timeZone, guess);
  const o2 = zoneOffsetMinutes(timeZone, guess - o1 * 60000);
  return o2;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const a = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Add whole days to a 'YYYY-MM-DD' date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * ISO 8601 local date-time with offset for `localSeconds` after local midnight of `date`
 * (values ≥ 86 400 roll into the next day).
 */
export function isoLocal(date: string, localSeconds: number, offsetMinutes: number): string {
  const ms = Math.round(localSeconds * 1000);
  const dayMs = 86400000;
  const days = Math.floor(ms / dayMs);
  let rem = ms - days * dayMs;
  const d = addDays(date, days);
  const h = Math.floor(rem / 3600000);
  rem -= h * 3600000;
  const mi = Math.floor(rem / 60000);
  rem -= mi * 60000;
  const s = Math.floor(rem / 1000);
  const milli = rem - s * 1000;
  return `${d}T${pad(h)}:${pad(mi)}:${pad(s)}.${pad(milli, 3)}${formatOffset(offsetMinutes)}`;
}

/** 'HH:MM:SS(.mmm)' clock string → seconds since midnight, or null. */
export function parseClock(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/**
 * Match a timing abbreviation ('J. Catania', 'Catania') to an entry driver. Initial and surname must
 * both match when an initial is given (siblings share surnames); a surname alone must be unique.
 */
export function matchDriver(abbrev: string | null | undefined, drivers: { number: number; name: string }[]): number | null {
  const a = (abbrev ?? "").trim();
  if (!a) return null;
  const exact = drivers.filter((d) => d.name.toLowerCase() === a.toLowerCase());
  if (exact.length === 1) return exact[0].number;
  const m = a.match(/^((?:[A-Za-z]\.\s*)+)?(.+)$/);
  const initials = (m?.[1] ?? "").replace(/[\s.]/g, "").toLowerCase();
  const surname = (m?.[2] ?? a).trim().toLowerCase();
  const hits = drivers.filter((d) => {
    const n = d.name.toLowerCase();
    if (!n.endsWith(surname)) return false;
    return !initials || n.startsWith(initials[0]);
  });
  return hits.length === 1 ? hits[0].number : null;
}

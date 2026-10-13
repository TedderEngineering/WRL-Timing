/**
 * Formatting for race dates.
 *
 * A race date is a calendar day, not a moment. The API sends it as a UTC-midnight
 * timestamp ("2026-08-22T00:00:00.000Z"), so `new Date(iso).toLocaleDateString()`
 * renders it in the viewer's zone and shows the previous day for anyone west of
 * UTC — every race read one day early in UTC-4. These helpers read the UTC parts
 * instead, so the day shown is the day stored.
 *
 * Use these only for date-only values (race, event and qualifying dates). Real
 * timestamps — created_at, last login, billing dates — are moments in time and
 * SHOULD be rendered in the viewer's local zone, so leave those alone.
 */

/** "2026-08-22T00:00:00.000Z" → "8/22/2026" */
export function formatRaceDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

/** "2026-08-22T00:00:00.000Z" → "August 22, 2026" */
export function formatRaceDateLong(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-08-22T00:00:00.000Z" → "2026-08-22", the value an <input type="date"> wants */
export function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

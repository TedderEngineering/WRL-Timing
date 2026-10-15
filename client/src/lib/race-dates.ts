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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

/** "2025-10-09", "2025-10-11" → "Oct 9–11, 2025"; across months "Feb 28 – Mar 1, 2026". */
export function formatDateRange(start: string, end: string): string {
  const [y1, m1, d1] = parts(start);
  const [y2, m2, d2] = parts(end);
  if (y1 === y2 && m1 === m2) return d1 === d2 ? `${MONTHS[m1 - 1]} ${d1}, ${y1}` : `${MONTHS[m1 - 1]} ${d1}–${d2}, ${y1}`;
  if (y1 === y2) return `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}, ${y1}`;
  return `${MONTHS[m1 - 1]} ${d1}, ${y1} – ${MONTHS[m2 - 1]} ${d2}, ${y2}`;
}

/** "2026-10-02" → "Fri" */
export function dayName(day: string): string {
  const [y, m, d] = parts(day);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "2026-10-02" → "October 2026" */
export function monthHeading(day: string): string {
  const [y, m] = parts(day);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

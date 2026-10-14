/** Date helpers for the dashboard. Dates are calendar days (YYYY-MM-DD, UTC). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

/** "Oct 10–11, 2026", "Feb 27–Mar 1, 2026", "Aug 22, 2026". */
export function formatDayRange(start: string, end: string, withYear = true): string {
  const a = parts(start);
  const b = parts(end);
  const year = withYear ? `, ${b.y}` : "";
  if (start.slice(0, 10) === end.slice(0, 10)) return `${MONTHS[a.m - 1]} ${a.d}${year}`;
  if (a.m === b.m && a.y === b.y) return `${MONTHS[a.m - 1]} ${a.d}–${b.d}${year}`;
  return `${MONTHS[a.m - 1]} ${a.d}–${MONTHS[b.m - 1]} ${b.d}${year}`;
}

/** Whole days from `today` to `day` (both YYYY-MM-DD). */
export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export function whenLabel(start: string, end: string, today: string): string {
  const d = daysUntil(start, today);
  if (d > 1) return `in ${d} days`;
  if (d === 1) return "tomorrow";
  if (daysUntil(end, today) >= 0) return "this weekend";
  return "";
}

export function resultsLabel(status: string | null | undefined): "Official" | "Provisional" | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "official") return "Official";
  if (s === "provisional" || s === "unofficial") return "Provisional";
  return null;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

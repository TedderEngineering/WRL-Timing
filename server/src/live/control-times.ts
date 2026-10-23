/**
 * Race control's times on a 24-hour clock.
 *
 * The timing's race-control log mixes clocks: on Sunday at Sebring most messages carried 24-hour
 * times ("13:39:00") but the latest read "02:36:00" and "02:41:00" (2:36 and 2:41 in the
 * afternoon, on a 12-hour clock with no AM or PM). An hour past 12 is certain; any other time is
 * read as the morning or the afternoon one nearer the message before it in the log's order (the
 * session's start for the first), within an hour before the start and a day after it.
 */
interface Timed {
  o?: number;
  t?: string | null;
}

const H = 3_600_000;
const RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(.*)$/;

export function fixTwelveHour<T extends Timed>(entries: T[], startLocalMs: number | null): T[] {
  if (startLocalMs === null || !Number.isFinite(startLocalMs)) return entries;
  const order = entries.map((e, i) => ({ e, i })).sort((a, b) => (a.e.o ?? a.i) - (b.e.o ?? b.i) || a.i - b.i);
  const out = [...entries];
  let prev = startLocalMs;
  for (const { e, i } of order) {
    const m = RE.exec(String(e.t ?? ""));
    if (!m) continue;
    const hour = Number(m[2]);
    const day = Date.parse(`${m[1]}T00:00:00Z`);
    const rest = (Number(m[3]) * 60 + Number(m[4])) * 1000;
    if (hour > 12) {
      prev = day + hour * H + rest;
      continue;
    }
    const h = hour % 12;
    const options = [day + h * H + rest, day + (h + 12) * H + rest].filter((x) => x >= startLocalMs - H && x <= startLocalMs + 24 * H);
    if (!options.length) continue;
    const best = options.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
    prev = best;
    const t = `${new Date(best).toISOString().slice(0, 19)}${m[5].replace(/^\.\d+/, "")}`;
    if (t !== e.t) out[i] = { ...e, t };
  }
  return out;
}

/**
 * Race control's times on a 24-hour clock.
 *
 * The timing's race-control log can give its times on a 12-hour clock with no AM or PM: on Sunday
 * at Sebring an afternoon message read "02:41:00", listed after one at "12:58:00". A log with any
 * hour past 12 is on a 24-hour clock and is left as it is. Otherwise each time is read as the
 * morning or the afternoon one nearer the session's start (track time), within an hour before it
 * and a day after.
 */
interface Timed {
  t?: string | null;
}

const H = 3_600_000;

export function fixTwelveHour<T extends Timed>(entries: T[], startLocalMs: number | null): T[] {
  if (startLocalMs === null || !Number.isFinite(startLocalMs)) return entries;
  const re = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(.*)$/;
  if (entries.some((e) => Number(re.exec(String(e.t ?? ""))?.[2] ?? 0) > 12)) return entries;
  return entries.map((e) => {
    const m = re.exec(String(e.t ?? ""));
    if (!m) return e;
    const h = Number(m[2]) % 12;
    const day = Date.parse(`${m[1]}T00:00:00Z`);
    const rest = (Number(m[3]) * 60 + Number(m[4])) * 1000;
    const options = [day + h * H + rest, day + (h + 12) * H + rest].filter((x) => x >= startLocalMs - H && x <= startLocalMs + 24 * H);
    if (!options.length) return e;
    const best = options.reduce((a, b) => (Math.abs(b - startLocalMs) < Math.abs(a - startLocalMs) ? b : a));
    return { ...e, t: `${new Date(best).toISOString().slice(0, 19)}${m[5].replace(/^\.\d+/, "")}` };
  });
}

/**
 * RaceTrace Live: sessions coming up, from the series' published schedule. The timing feed only
 * creates a session when its timing opens, so "upcoming" can't come from the feed; this list is
 * what the site banner and /live show until then. Edit it per event (a small PR); an admin form
 * with a database table replaces it later.
 *
 * Times carry their UTC offset (the track's local time as published).
 */
export type SessionKind = "race" | "qualify" | "practice";

export interface ScheduledSession {
  /** Stable id (banner dismissals key on it). */
  id: string;
  series: string;
  /** As the live listing names the event (the feed's event name). */
  eventName: string;
  sessionName: string;
  track: string;
  kind: SessionKind;
  startsAt: string;
  endsAt: string;
  /** Where the time came from (not served). */
  source: string;
}

export const LIVE_SCHEDULE: ScheduledSession[] = [
  {
    id: "wrl-2026-sebring-race-2",
    series: "WRL",
    eventName: "Sebring International Raceway 2026",
    sessionName: "Race 2 · 7 Hour",
    track: "Sebring International Raceway",
    kind: "race",
    startsAt: "2026-10-18T08:00:00-04:00",
    endsAt: "2026-10-18T15:00:00-04:00",
    source: "https://www.racewrl.com/watchsebring (WRL Race 2, Sun Oct 18, 8:00AM–3:00PM)",
  },
];

/** What the banner shows of a scheduled session (no source note). */
export type UpcomingSession = Omit<ScheduledSession, "source">;

/** How far ahead a session is announced (the day before). */
export const ANNOUNCE_MS = 36 * 3600_000;

/**
 * Sessions to announce at `now`: starting within ANNOUNCE_MS and not yet over, and not already
 * on the timing feed (a live or just-finished session of the same kind that started from three
 * hours before the scheduled start to its scheduled end: the timing opens before the green flag).
 */
export function upcomingSessions(
  now: number,
  onFeed: { kind: SessionKind; startedAt: string | null }[],
  schedule: ScheduledSession[] = LIVE_SCHEDULE
): UpcomingSession[] {
  return schedule
    .filter((s) => {
      const start = Date.parse(s.startsAt);
      const end = Date.parse(s.endsAt);
      if (!(Number.isFinite(start) && Number.isFinite(end))) return false;
      if (end <= now || start - now > ANNOUNCE_MS) return false;
      return !onFeed.some((f) => {
        const t = f.startedAt ? Date.parse(f.startedAt) : NaN;
        return f.kind === s.kind && Number.isFinite(t) && t >= start - 3 * 3600_000 && t <= end;
      });
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .map(({ source: _source, ...rest }) => rest);
}

/**
 * Season view for the dashboard (RaceTrace 2.0, G6 dashboard).
 *
 * Each series' published calendar (calendars/<season>.json) is matched
 * against the races on RaceTrace, so every round reads as one of:
 *   on_site   – at least one published race matches the round
 *   missing   – the round has finished but no race is on RaceTrace yet
 *   live      – today is inside the round's dates
 *   upcoming  – later this season
 * Pure functions; the route supplies the races and "today".
 */
import cal2026 from "./calendars/2026.json" with { type: "json" };

export interface CalendarRound {
  round: number;
  name: string;
  track: string;
  tracks: string[];
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  note?: string;
}

export interface CalendarSeries {
  id: string;
  label: string;
  shortLabel: string;
  badge: string;
  match: { series: string[]; subSeries?: string; nameIncludes?: string; nameExcludes?: string };
  source: { title: string; url: string; checked: string };
  rounds: CalendarRound[];
}

export interface Calendar {
  season: number;
  series: CalendarSeries[];
}

export interface SeasonRace {
  id: string;
  name: string;
  date: Date | string;
  track: string;
  series: string;
  subSeries?: string | null;
}

export type RoundStatus = "on_site" | "missing" | "live" | "upcoming";

export interface SeasonRound {
  /** The round's next scheduled session (live schedule), when one is known and not over. */
  session?: NextSession;
  round: number;
  name: string;
  track: string;
  start: string;
  end: string;
  note?: string;
  status: RoundStatus;
  isNext: boolean;
  races: { id: string; name: string; date: string }[];
}

export interface SeasonSeries {
  id: string;
  label: string;
  shortLabel: string;
  badge: string;
  source: { title: string; url: string; checked: string };
  rounds: SeasonRound[];
  counts: { total: number; run: number; onSite: number };
  complete: boolean;
  latestOnSite: SeasonRound | null;
  next: SeasonRound | null;
}

export interface NextSession {
  /** The live schedule's id: its pre-race page is /live/next/<id>. */
  id?: string;
  name: string;
  kind: string;
  startsAt: string;
}

/**
 * The next session of a round from the live schedule: same series (the schedule's series is the
 * calendar series' short label), a track the round names, and not over at `nowMs`.
 */
/** The live schedule's sessions of a round: same series (its short label), a track the round names, a day of the round. */
export function sessionsOfRound<T extends { series: string; track: string; startsAt: string }>(
  shortLabel: string,
  round: Pick<CalendarRound, "tracks" | "start" | "end">,
  schedule: T[]
): T[] {
  return schedule
    .filter((x) => x.series.toLowerCase() === shortLabel.toLowerCase())
    .filter((x) => {
      const d = dayNumber(x.startsAt.slice(0, 10));
      return d >= dayNumber(round.start) && d <= dayNumber(round.end);
    })
    .filter((x) => {
      const t = normalizeTrack(x.track);
      return round.tracks.some((alias) => {
        const a = normalizeTrack(alias);
        return a.length > 0 && (t.includes(a) || a.includes(t));
      });
    });
}

/** True when the schedule lists sessions for the round and every one has ended by `nowMs`. */
export function roundScheduleOver(
  shortLabel: string,
  round: Pick<CalendarRound, "tracks" | "start" | "end">,
  nowMs: number,
  schedule: { series: string; track: string; startsAt: string; endsAt: string }[]
): boolean {
  const xs = sessionsOfRound(shortLabel, round, schedule);
  return xs.length > 0 && xs.every((x) => Date.parse(x.endsAt) <= nowMs);
}

export function nextSessionFor(
  shortLabel: string,
  round: Pick<CalendarRound, "tracks" | "start" | "end">,
  nowMs: number,
  schedule: { id?: string; series: string; track: string; sessionName: string; kind: string; startsAt: string; endsAt: string }[]
): NextSession | null {
  const hit = schedule
    .filter((x) => x.series.toLowerCase() === shortLabel.toLowerCase())
    .filter((x) => Date.parse(x.endsAt) > nowMs)
    .filter((x) => {
      const d = dayNumber(x.startsAt.slice(0, 10));
      return d >= dayNumber(round.start) && d <= dayNumber(round.end);
    })
    .filter((x) => {
      const t = normalizeTrack(x.track);
      return round.tracks.some((alias) => {
        const a = normalizeTrack(alias);
        return a.length > 0 && (t.includes(a) || a.includes(t));
      });
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return hit ? { ...(hit.id ? { id: hit.id } : {}), name: hit.sessionName, kind: hit.kind, startsAt: hit.startsAt } : null;
}

const CALENDARS: Record<number, Calendar> = { 2026: cal2026 as Calendar };

export function calendarFor(season: number): Calendar | null {
  return CALENDARS[season] ?? null;
}

export function availableSeasons(): number[] {
  return Object.keys(CALENDARS).map(Number).sort((a, b) => b - a);
}

/** Lower-case letters and digits only: "Eagle's Canyon" → "eaglescanyon". */
export function normalizeTrack(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function dayNumber(d: Date | string): number {
  const iso = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

/** Does this race belong to the calendar series (series, sub-series, name rules)? */
export function raceInSeries(race: SeasonRace, s: CalendarSeries): boolean {
  const m = s.match;
  const series = race.series.toUpperCase().replace(/[\s-]+/g, "_");
  if (!m.series.some((x) => x.toUpperCase().replace(/[\s-]+/g, "_") === series)) return false;
  // Machine intake records the championship; trust it when present.
  if (m.subSeries && race.subSeries) return race.subSeries.toLowerCase() === m.subSeries.toLowerCase();
  if (m.nameExcludes && new RegExp(m.nameExcludes, "i").test(race.name)) return false;
  if (m.nameIncludes && !new RegExp(m.nameIncludes, "i").test(race.name)) return false;
  return true;
}

/** Date window (start − 3 days … end + 1 day) and a track named in the round. */
export function raceInRound(race: SeasonRace, r: CalendarRound): boolean {
  const d = dayNumber(race.date);
  if (d < dayNumber(r.start) - 3 || d > dayNumber(r.end) + 1) return false;
  const t = normalizeTrack(race.track);
  return r.tracks.some((alias) => {
    const a = normalizeTrack(alias);
    return a.length > 0 && (t.includes(a) || a.includes(t));
  });
}

/**
 * `scheduleOver(shortLabel, round)`: true when the live schedule lists the round's sessions and all
 * of them are over (routes/dashboard.ts passes it; see sessionsOfRound).
 */
export function buildSeason(
  cal: Calendar,
  races: SeasonRace[],
  today: Date | string,
  scheduleOver: (shortLabel: string, round: CalendarRound) => boolean = () => false
): SeasonSeries[] {
  const now = dayNumber(today);
  return cal.series.map((s) => {
    const mine = races.filter((r) => raceInSeries(r, s));
    const rounds: SeasonRound[] = s.rounds.map((r) => {
      const hits = mine
        .filter((race) => raceInRound(race, r))
        .sort((a, b) => dayNumber(a.date) - dayNumber(b.date) || a.name.localeCompare(b.name));
      const start = dayNumber(r.start);
      const end = dayNumber(r.end);
      const status: RoundStatus = hits.length
        ? "on_site"
        : now > end
          ? "missing"
          : now >= start
            ? "live"
            : "upcoming";
      return {
        round: r.round,
        name: r.name,
        track: r.track,
        start: r.start,
        end: r.end,
        ...(r.note ? { note: r.note } : {}),
        status,
        isNext: false,
        races: hits.map((h) => ({
          id: h.id,
          name: h.name,
          date: typeof h.date === "string" ? h.date.slice(0, 10) : h.date.toISOString().slice(0, 10),
        })),
      };
    });
    // The next round is the first one not over yet: a weekend stays "next" while it runs, even once
    // its first race is on the site (Saturday's race in, Sunday's still to run). It is over after its
    // last day, or as soon as its last day's race is on the site, or every session the live schedule
    // lists for it has ended: then the following round is next the same evening.
    const done = (r: SeasonRound, i: number): boolean =>
      dayNumber(r.end) < now ||
      r.races.some((x) => dayNumber(x.date) >= dayNumber(r.end)) ||
      scheduleOver(s.shortLabel, s.rounds[i]);
    const next = rounds.find((r, i) => !done(r, i)) ?? null;
    if (next) next.isNext = true;
    const run = rounds.filter((r) => dayNumber(r.end) < now).length;
    const onSite = rounds.filter((r) => r.status === "on_site").length;
    const latestOnSite = [...rounds].reverse().find((r) => r.status === "on_site") ?? null;
    return {
      id: s.id,
      label: s.label,
      shortLabel: s.shortLabel,
      badge: s.badge,
      source: s.source,
      rounds,
      counts: { total: rounds.length, run, onSite },
      complete: run === rounds.length,
      latestOnSite,
      next,
    };
  });
}

/** Which calendar series and round a race belongs to, if any (used to label recaps "Round 7 of 7"). */
export function locateRace(
  cal: Calendar,
  race: SeasonRace
): { seriesId: string; label: string; round: number; of: number; roundName: string } | null {
  for (const s of cal.series) {
    if (!raceInSeries(race, s)) continue;
    const r = s.rounds.find((x) => raceInRound(race, x));
    if (r) return { seriesId: s.id, label: s.label, round: r.round, of: s.rounds.length, roundName: r.name };
  }
  return null;
}

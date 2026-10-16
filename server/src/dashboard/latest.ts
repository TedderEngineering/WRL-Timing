/**
 * "Latest races" for the dashboard (RaceTrace 2.0, G6 dashboard): the newest
 * published races grouped into race weekends, each race carrying its recap
 * when it has a published analysis package.
 */
import { normalizeTrack } from "./season.js";

export interface LatestRaceRow {
  id: string;
  name: string;
  date: Date;
  track: string;
  series: string;
  subSeries: string | null;
  eventId: string | null;
  premium: boolean;
  createdAt: Date;
  maxLap: number | null;
  totalCars: number | null;
  /** Pit laps recorded for the race, all cars together (optional; used to order a weekend). */
  pitStops?: number;
}

export interface RaceGroup<T extends LatestRaceRow = LatestRaceRow> {
  key: string;
  races: T[];
}

const DAY = 86_400_000;

/**
 * Group date-sorted (newest first) races into weekends: same event id, or
 * same series + sub-series + track within 3 days. Races keep date order
 * inside a group, oldest first (Race 1 before Race 2, Saturday before Sunday).
 */
export function groupIntoWeekends<T extends LatestRaceRow>(races: T[]): RaceGroup<T>[] {
  const groups: (RaceGroup<T> & { anchor: T })[] = [];
  for (const r of races) {
    const g = groups.find((x) => sameWeekend(x.anchor, r));
    if (g) g.races.push(r);
    else groups.push({ key: r.eventId ?? `race:${r.id}`, anchor: r, races: [r] });
  }
  return groups.map(({ key, races: rs }) => ({
    key,
    races: [...rs].sort((a, b) => a.date.getTime() - b.date.getTime() || a.name.localeCompare(b.name, undefined, { numeric: true })),
  }));
}

/**
 * The order of a weekend's races on the dashboard: the races with pit stops first (the endurance
 * and feature races: GT World Challenge, WeatherTech, GT4, WRL), then the rest by length, longest
 * first; equal races keep date order (Race 1 before Race 2). A race counts as having pit stops when
 * at least half its cars stopped, so one car pitting for damage in a sprint does not count.
 */
export function headlineOrder(a: LatestRaceRow, b: LatestRaceRow): number {
  const stops = (r: LatestRaceRow) => (r.pitStops ?? 0) >= Math.max(1, (r.totalCars ?? 0) / 2);
  return (
    Number(stops(b)) - Number(stops(a)) ||
    (b.maxLap ?? 0) - (a.maxLap ?? 0) ||
    a.date.getTime() - b.date.getTime() ||
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
}

function sameWeekend(a: LatestRaceRow, b: LatestRaceRow): boolean {
  if (a.eventId && b.eventId) return a.eventId === b.eventId;
  if (a.series.toUpperCase().replace(/[\s-]+/g, "_") !== b.series.toUpperCase().replace(/[\s-]+/g, "_")) return false;
  if ((a.subSeries ?? "") !== (b.subSeries ?? "")) return false;
  if (normalizeTrack(a.track) !== normalizeTrack(b.track)) return false;
  return Math.abs(a.date.getTime() - b.date.getTime()) <= 3 * DAY;
}

/**
 * The label for one race inside its weekend: the package's session name when
 * there is one ("Race 1"), else the race name without the event part
 * ("Pirelli GT4 Race 1 — Sonoma Raceway" → "Pirelli GT4 Race 1").
 */
export function sessionLabel(race: { name: string }, packageSession?: string | null): string {
  if (packageSession) return packageSession;
  return race.name.split(" — ")[0].trim();
}

/** The race's own name without the track ("GT4 America Race 1 — Indianapolis Motor Speedway" → "GT4 America Race 1"). */
function namePart(name: string): string {
  return name.split(" — ")[0].trim();
}

const seriesKey = (r: { series: string; subSeries: string | null }) =>
  `${r.series.toUpperCase().replace(/[\s-]+/g, "_")}|${r.subSeries ?? ""}`;

/**
 * The tab labels for one weekend's races. A weekend of one series keeps the short session names
 * ("Race 1", "Race 2"). A weekend that mixes series (SRO's Indianapolis weekend: the 8 Hour, GT4
 * America, McLaren Trophy) says which race each one is ("Indianapolis 8 Hour", "GT4 America Race
 * 1"), adding the session only where two names would read the same.
 */
export function weekendLabels(races: { name: string; series: string; subSeries: string | null; session: string }[]): string[] {
  const oneSeries = new Set(races.map(seriesKey)).size <= 1;
  const sessions = races.map((r) => r.session);
  if (oneSeries && new Set(sessions).size === sessions.length) return sessions;
  const names = races.map((r) => namePart(r.name) || r.session);
  return names.map((n, i) => (names.filter((x) => x === n).length > 1 && !n.includes(races[i].session) ? `${n} · ${races[i].session}` : n));
}

/**
 * A weekend's races grouped by series in headline order (the series with the feature race first),
 * and in date order inside each series, so Race 1 comes before Race 2.
 */
export function weekendOrder<T extends LatestRaceRow>(races: T[]): T[] {
  const ranked = [...races].sort(headlineOrder);
  const rank = new Map<string, number>();
  ranked.forEach((r, i) => {
    const k = seriesKey(r);
    if (!rank.has(k)) rank.set(k, i);
  });
  return [...races].sort(
    (a, b) =>
      rank.get(seriesKey(a))! - rank.get(seriesKey(b))! ||
      a.date.getTime() - b.date.getTime() ||
      a.name.localeCompare(b.name, undefined, { numeric: true })
  );
}

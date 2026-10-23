/**
 * "Your 2026" season recap (engagement plan H), one per followed car and series.
 *
 * Series by series, not one date for everyone: a recap opens once that series' season is
 * over on RaceTrace, i.e. its last calendar round has a race on the site, or a week has passed
 * since it ended (IMSA and SRO finish in October, WRL at COTA in December). A car whose
 * championship has no calendar of its own uses its family's (IMSA → Pilot Challenge,
 * SRO → GT4 America, WRL → WRL), whose finales are the same weekend.
 *
 * Facts only, in the stories' and benchmarks' tone: what the car did (races, laps, best
 * result, class wins and podiums, places gained over the pit cycles, top-three pit stops and
 * fastest laps). Nothing negative is summed up: a total that is not a gain is left out.
 */
import { carFacts, type CarFacts } from "./my-car.js";
import { buildSeason, locateRace, type Calendar } from "./season.js";
import { raceFamily } from "../intake/reimport.js";
import { canonicalTrack } from "../lib/weekends.js";

const FAMILY_SERIES: Record<string, string> = { imsa: "imsa-mpc", sro: "sro-gt4", wrl: "wrl" };
const GRACE_DAYS = 7;
const DAY = 86_400_000;

export interface RecapRaceIn {
  id: string;
  name: string;
  date: Date;
  track: string;
  series: string;
  subSeries: string | null;
  carNumber: string;
  chartData: any;
  annotationData: any;
  /** The car's facts in this race, when the caller has them already (cached); else from chartData. */
  facts?: CarFacts | null;
}

export interface SeasonRecap {
  key: string;
  carId: string;
  number: string;
  team: string;
  season: number;
  seriesId: string;
  seriesLabel: string;
  finale: { name: string; end: string };
  races: number;
  laps: number;
  best: { finishClass: number; cls: string; raceId: string; raceName: string; date: string } | null;
  classWins: number;
  podiums: number;
  pitCycles: { count: number; gained: number | null };
  topThreePitStops: number;
  topThreeFastestLaps: number;
  raceList: {
    id: string;
    name: string;
    date: string;
    /** The track's standard name, the race's label in the recap's race tabs. */
    track: string;
    finishClass: number | null;
    finishOverall: number | null;
    classSize: number | null;
    /** Took the chequered flag (false for a car that retired, even when classified). */
    finished: boolean;
    laps: number;
    cls: string;
    pitCycles: { net: number }[];
  }[];
}

/** The calendar series a race belongs to, or its family's. */
export function recapSeriesFor(cal: Calendar, race: { id: string; name: string; date: Date; track: string; series: string; subSeries: string | null }): string | null {
  const located = locateRace(cal, race);
  if (located) return located.seriesId;
  const fam = raceFamily(race.series, race.subSeries);
  const id = fam ? FAMILY_SERIES[fam] : undefined;
  return id && cal.series.some((s) => s.id === id) ? id : null;
}

/** The series' season is over on RaceTrace: its finale is on the site, or a week has passed. */
export function seasonOver(cal: Calendar, seriesId: string, publishedRaces: { id: string; name: string; date: Date; track: string; series: string; subSeries: string | null }[], today: Date): boolean {
  const series = buildSeason(cal, publishedRaces, today).find((s) => s.id === seriesId);
  if (!series || series.rounds.length === 0) return false;
  const finale = series.rounds[series.rounds.length - 1];
  if (finale.status === "on_site") return true;
  return today.getTime() > Date.parse(`${finale.end}T00:00:00Z`) + GRACE_DAYS * DAY;
}

export function buildRecap(
  cal: Calendar,
  car: { id: string; number: string },
  season: number,
  seriesId: string,
  races: RecapRaceIn[]
): SeasonRecap | null {
  const s = cal.series.find((x) => x.id === seriesId);
  if (!s || races.length === 0) return null;
  const finale = s.rounds[s.rounds.length - 1];
  const rows: { race: RecapRaceIn; f: CarFacts }[] = [];
  for (const race of [...races].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const f = race.facts !== undefined ? race.facts : race.chartData ? carFacts(race.chartData, race.annotationData ?? null, race.carNumber) : null;
    if (f) rows.push({ race, f });
  }
  if (rows.length === 0) return null;

  let best: SeasonRecap["best"] = null;
  for (const { race, f } of rows) {
    if (f.finishClass !== null && (!best || f.finishClass < best.finishClass)) {
      best = { finishClass: f.finishClass, cls: f.cls, raceId: race.id, raceName: race.name, date: race.date.toISOString().slice(0, 10) };
    }
  }
  const cycles = rows.flatMap((r) => r.f.pitCycles);
  const gained = cycles.reduce((a, c) => a + c.net, 0);
  const last = rows[rows.length - 1].f;
  return {
    key: `${car.id}:${season}:${seriesId}`,
    carId: car.id,
    number: last.number,
    team: last.team,
    season,
    seriesId,
    seriesLabel: s.label,
    finale: { name: finale.name, end: finale.end },
    races: rows.length,
    laps: rows.reduce((a, r) => a + r.f.laps, 0),
    best,
    classWins: rows.filter((r) => r.f.finishClass === 1).length,
    podiums: rows.filter((r) => r.f.finishClass !== null && r.f.finishClass <= 3).length,
    pitCycles: { count: cycles.length, gained: gained > 0 ? gained : null },
    topThreePitStops: rows.reduce((a, r) => a + r.f.benchmarks.filter((b) => / stop of \d+ in /.test(b)).length, 0),
    topThreeFastestLaps: rows.filter((r) => r.f.benchmarks.some((b) => b.startsWith("Fastest lap"))).length,
    raceList: rows.map(({ race, f }) => ({
      id: race.id,
      name: race.name,
      date: race.date.toISOString().slice(0, 10),
      track: canonicalTrack(race.track),
      finishClass: f.finishClass,
      finishOverall: f.finishOverall,
      classSize: f.classSize,
      finished: f.finished,
      laps: f.laps,
      cls: f.cls,
      pitCycles: f.pitCycles.map((c) => ({ net: c.net })),
    })),
  };
}

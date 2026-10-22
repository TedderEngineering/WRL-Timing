/**
 * RaceTrace Live: turn a timed session that is still running into the same
 * chart data a finished race has (pure; no network, no database).
 *
 * The live inputs are the ones the intake downloads for a finished session,
 * read before the session ends:
 *   - laps: v1/Events/LoadSessionLaps (every completed lap, CarPosition rows,
 *     the same shape as the export's `laps`);
 *   - state: v2/Events/GetCurrentSessionState (msgpack SessionState), mapped
 *     to the LoadSessionResults JSON shape by `resultsFromState`;
 *   - flags: v1/Events/LoadFlags (the current flag has no end yet);
 *   - control: v1/Events/LoadSessionHistoricalControlLog.
 *
 * The CSVs come from the intake's own builders (through ./feed.ts) and are
 * parsed by the Speedhive parser, exactly as `intake push` does for a
 * finished WRL session.
 */
import { nameDriverChanges } from "./drivers.js";
import {
  buildAllLapsCsv,
  buildControlCsv,
  buildFlagsCsv,
  buildSummaryCsv,
  carsFromResults,
  sessionClock,
  type FeedControlEntry,
  type FeedFlag,
  type FeedLap,
  type FeedResults,
} from "./feed.js";
import { parserInput } from "../intake/parser-input.js";
import { speedhiveParser } from "../utils/parsers/speedhive.js";
import { raceDataJsonSchema, type RaceDataJson } from "../utils/race-validators.js";

/** The timing feed's flag codes. */
export const FLAG_NAMES: Record<number, string> = {
  0: "Unknown",
  1: "Green",
  2: "Yellow",
  3: "Red",
  4: "White",
  5: "Checkered",
  6: "Black",
  7: "Code 35",
  8: "Code 60",
};

export interface LiveSessionMeta {
  eventId: number;
  sessionId: number;
  /** RaceTrace's public name for the session (URL and race id); the timing system's ids stay on the server. */
  slug: string;
  eventName: string;
  sessionName: string;
  track: string;
  /** Track UTC offset in hours (LoadSessions `tz`), for open flags. */
  tzOffsetHours: number | null;
  /** Session start date (YYYY-MM-DD, track local), the fallback race date. */
  date: string | null;
}

export interface LiveInputs {
  meta: LiveSessionMeta;
  laps: FeedLap[];
  results: FeedResults | null;
  flags: FeedFlag[] | null;
  control: FeedControlEntry[] | null;
  /** Current flag from the session state (a FLAG_NAMES code). */
  currentFlag?: number | null;
  timeToGo?: string | null;
  /** Wall clock, for closing the open flag (default Date.now()). */
  now?: number;
  /** Who is in each car now, by car number (the state's driver names; drivers.ts). */
  currentDrivers?: Record<string, string>;
}

export interface LiveStatus {
  eventName: string;
  sessionName: string;
  track: string;
  leaderLap: number;
  carCount: number;
  flag: string | null;
  runningRaceTime: string | null;
  timeToGo: string | null;
  warnings: string[];
}

export interface LiveChart {
  race: { id: string; name: string; date: string; track: string; series: string; season: number };
  data: RaceDataJson;
  annotations: Record<string, unknown>;
  status: LiveStatus;
}

/** Track-local ISO timestamp (no zone) for `now`, matching the flag times. */
export function trackLocalNow(now: number, tzOffsetHours: number | null): string {
  return new Date(now + (tzOffsetHours ?? 0) * 3_600_000).toISOString().slice(0, 19);
}

/** The flag that is still showing has no end: it runs until now. */
export function closeOpenFlags(flags: FeedFlag[], nowLocal: string): FeedFlag[] {
  return flags.map((f) => (f.s && !f.e ? { ...f, e: nowLocal > String(f.s) ? nowLocal : String(f.s) } : f));
}

/** A live race's id: never a database id, and never the timing system's numbers. */
export function liveRaceId(slug: string): string {
  return `live-${slug}`;
}

export class LiveNoLapsError extends Error {
  constructor() {
    super("No completed laps yet");
    this.name = "LiveNoLapsError";
  }
}

export async function buildLiveChart(inp: LiveInputs): Promise<LiveChart> {
  const laps = (inp.laps ?? []).filter((l) => l && l.n && Number(l.llp) >= 1);
  if (laps.length === 0) throw new LiveNoLapsError();
  const now = inp.now ?? Date.now();
  const flags = Array.isArray(inp.flags) ? closeOpenFlags(inp.flags, trackLocalNow(now, inp.meta.tzOffsetHours)) : null;
  const cars = carsFromResults(inp.results, laps);
  const clock = sessionClock(laps, inp.results, flags, inp.meta.date);
  const files: Record<string, string> = {
    summaryCsv: buildSummaryCsv(cars),
    lapsCsv: buildAllLapsCsv(laps, cars, clock, null),
    ...(flags ? { flagsCsv: buildFlagsCsv(flags) } : {}),
    ...(Array.isArray(inp.control) ? { controlLogCsv: buildControlCsv(inp.control) } : {}),
  };
  const { input, placeholders } = parserInput(speedhiveParser, files);
  const parsed = await speedhiveParser.parse(input);
  const data = raceDataJsonSchema.parse(parsed.data);
  // Each pit stop's driver in and out, from the laps' driver names (the parser names nobody).
  if (parsed.annotations) nameDriverChanges(parsed.annotations as Record<string, unknown>, data, laps, inp.currentDrivers);
  const warnings = [...parsed.warnings];
  if (!clock) warnings.push("No race-clock start yet: Time of Day is missing.");
  for (const k of placeholders) warnings.push(`No ${k} yet: FCY comes from lap status.`);
  const date = clock?.date ?? inp.meta.date ?? new Date(now).toISOString().slice(0, 10);
  const leaderLap = laps.reduce((m, l) => Math.max(m, Number(l.llp) || 0), 0);
  return {
    race: {
      id: liveRaceId(inp.meta.slug),
      name: `${inp.meta.eventName} — ${inp.meta.sessionName}`,
      date: `${date}T00:00:00.000Z`,
      track: inp.meta.track,
      series: "WRL",
      season: Number(date.slice(0, 4)),
    },
    data,
    annotations: parsed.annotations ?? {},
    status: {
      eventName: inp.meta.eventName,
      sessionName: inp.meta.sessionName,
      track: inp.meta.track,
      leaderLap,
      carCount: Object.keys(data.cars).length,
      flag: inp.currentFlag != null ? (FLAG_NAMES[inp.currentFlag] ?? null) : null,
      runningRaceTime: typeof inp.results?.runningRaceTime === "string" ? inp.results.runningRaceTime : null,
      timeToGo: inp.timeToGo ?? null,
      warnings,
    },
  };
}

// ─── GetCurrentSessionState (msgpack) → LoadSessionResults JSON shape ─────────

/**
 * Field positions of the msgpack SessionState, EventEntry and CarPosition
 * (the timing feed's published TypeScript decoders).
 */
const SS = { sessionId: 2, localTimeOfDay: 6, runningRaceTime: 7, timeToGo: 5, eventEntries: 13, carPositions: 14, currentFlag: 15 } as const;
const CP = { number: 2, class: 4, lastLapCompleted: 15, overallPosition: 20, classPosition: 21 } as const;

/**
 * A car's state as a lap row (the shape of the feed's lap list, short keys),
 * so a crossing can be added between full lap reloads. Positions are the
 * state's at the time it was read, a few seconds after the crossing at most;
 * the next full reload replaces the row with the logged one.
 */
const LAP_FIELDS: [keyof FeedLap & string, number][] = [
  ["n", 2],
  ["class", 4],
  ["og", 11],
  ["od", 12],
  ["ttm", 13],
  ["ltm", 14],
  ["llp", 15],
  ["ovp", 20],
  ["clp", 21],
  ["ip", 34],
  ["lip", 35],
  ["flg", 38],
  ["dn", 44],
  ["pet", 55],
  ["pdm", 56],
];

export function lapRowFromState(x: unknown[]): FeedLap | null {
  const row: Record<string, unknown> = {};
  for (const [k, i] of LAP_FIELDS) if (x[i] !== undefined && x[i] !== null) row[k] = x[i];
  return typeof row.n === "string" && typeof row.llp === "number" && row.llp >= 1 ? (row as FeedLap) : null;
}

export interface LiveState {
  sessionId: number | null;
  results: FeedResults;
  /** Each car's latest completed lap, as a lap row. */
  laps: FeedLap[];
  currentFlag: number | null;
  timeToGo: string | null;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Decoded msgpack SessionState (an array) → the fields the chart uses. Null when it is not one. */
export function resultsFromState(a: unknown): LiveState | null {
  if (!Array.isArray(a) || a.length < 16) return null;
  const entries = Array.isArray(a[SS.eventEntries]) ? (a[SS.eventEntries] as unknown[]) : [];
  const positions = Array.isArray(a[SS.carPositions]) ? (a[SS.carPositions] as unknown[]) : [];
  const results: FeedResults = {
    // sessionStartTime is a msgpack timestamp (UTC); the clock uses time of day - running time instead.
    localTimeOfDay: str(a[SS.localTimeOfDay]) ?? null,
    runningRaceTime: str(a[SS.runningRaceTime]) ?? null,
    eventEntries: entries
      .filter(Array.isArray)
      .map((e) => ({ no: str((e as unknown[])[0]), nm: str((e as unknown[])[1]), t: str((e as unknown[])[2]), c: str((e as unknown[])[3]) }))
      .filter((e) => e.no),
    carPositions: positions
      .filter(Array.isArray)
      .map((p) => {
        const x = p as unknown[];
        return {
          n: str(x[CP.number]),
          class: str(x[CP.class]),
          llp: num(x[CP.lastLapCompleted]),
          ovp: num(x[CP.overallPosition]),
          clp: num(x[CP.classPosition]),
        } as FeedLap;
      })
      // A car with no position yet (the feed sends -999) keeps the order from its laps.
      .filter((p) => p.n && (p.ovp ?? 0) > 0),
  };
  const laps = positions.filter(Array.isArray).map((p) => lapRowFromState(p as unknown[])).filter((l): l is FeedLap => l !== null);
  return { sessionId: num(a[SS.sessionId]) ?? null, results, laps, currentFlag: num(a[SS.currentFlag]) ?? null, timeToGo: str(a[SS.timeToGo]) ?? null };
}

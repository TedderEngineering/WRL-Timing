/**
 * RaceTrace Live: turn a RedMist session that is still running into the same
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
 * The CSVs come from the intake's own builders (parse-redmist.ts) and are
 * parsed by the Speedhive parser, exactly as `intake push` does for RedMist.
 */
import {
  buildRedmistAllLapsCsv,
  buildRedmistControlCsv,
  buildRedmistFlagsCsv,
  buildRedmistSummaryCsv,
  carsFromResults,
  sessionClock,
  type RmControlEntry,
  type RmFlag,
  type RmLap,
  type RmResults,
} from "../intake/parse-redmist.js";
import { parserInput } from "../intake/parser-input.js";
import { speedhiveParser } from "../utils/parsers/speedhive.js";
import { raceDataJsonSchema, type RaceDataJson } from "../utils/race-validators.js";

/** RedMist Flags enum (redmist-timing-common Flags). */
export const RM_FLAG_NAMES: Record<number, string> = {
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
  laps: RmLap[];
  results: RmResults | null;
  flags: RmFlag[] | null;
  control: RmControlEntry[] | null;
  /** Current flag from the session state (RedMist Flags enum). */
  currentFlag?: number | null;
  timeToGo?: string | null;
  /** Wall clock, for closing the open flag (default Date.now()). */
  now?: number;
}

export interface LiveStatus {
  eventId: number;
  sessionId: number;
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
export function closeOpenFlags(flags: RmFlag[], nowLocal: string): RmFlag[] {
  return flags.map((f) => (f.s && !f.e ? { ...f, e: nowLocal > String(f.s) ? nowLocal : String(f.s) } : f));
}

/** Speedhive-style live race id: never a database id. */
export function liveRaceId(eventId: number, sessionId: number): string {
  return `live-redmist-${eventId}-${sessionId}`;
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
    summaryCsv: buildRedmistSummaryCsv(cars),
    lapsCsv: buildRedmistAllLapsCsv(laps, cars, clock, null),
    ...(flags ? { flagsCsv: buildRedmistFlagsCsv(flags) } : {}),
    ...(Array.isArray(inp.control) ? { controlLogCsv: buildRedmistControlCsv(inp.control) } : {}),
  };
  const { input, placeholders } = parserInput(speedhiveParser, files);
  const parsed = await speedhiveParser.parse(input);
  const data = raceDataJsonSchema.parse(parsed.data);
  const warnings = [...parsed.warnings];
  if (!clock) warnings.push("No race-clock start yet: Time of Day is missing.");
  for (const k of placeholders) warnings.push(`No ${k} yet: FCY comes from lap status.`);
  const date = clock?.date ?? inp.meta.date ?? new Date(now).toISOString().slice(0, 10);
  const leaderLap = laps.reduce((m, l) => Math.max(m, Number(l.llp) || 0), 0);
  return {
    race: {
      id: liveRaceId(inp.meta.eventId, inp.meta.sessionId),
      name: `${inp.meta.eventName} — ${inp.meta.sessionName}`,
      date: `${date}T00:00:00.000Z`,
      track: inp.meta.track,
      series: "WRL",
      season: Number(date.slice(0, 4)),
    },
    data,
    annotations: parsed.annotations ?? {},
    status: {
      eventId: inp.meta.eventId,
      sessionId: inp.meta.sessionId,
      eventName: inp.meta.eventName,
      sessionName: inp.meta.sessionName,
      track: inp.meta.track,
      leaderLap,
      carCount: Object.keys(data.cars).length,
      flag: inp.currentFlag != null ? (RM_FLAG_NAMES[inp.currentFlag] ?? null) : null,
      runningRaceTime: typeof inp.results?.runningRaceTime === "string" ? inp.results.runningRaceTime : null,
      timeToGo: inp.timeToGo ?? null,
      warnings,
    },
  };
}

// ─── GetCurrentSessionState (msgpack) → LoadSessionResults JSON shape ─────────

/**
 * Field positions of the msgpack SessionState, EventEntry and CarPosition
 * (redmist-timing-common TypeScript/generated/decode-functions.ts).
 */
const SS = { sessionId: 2, localTimeOfDay: 6, runningRaceTime: 7, timeToGo: 5, eventEntries: 13, carPositions: 14, currentFlag: 15 } as const;
const CP = { number: 2, class: 4, lastLapCompleted: 15, overallPosition: 20, classPosition: 21 } as const;

export interface LiveState {
  sessionId: number | null;
  results: RmResults;
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
  const results: RmResults = {
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
        } as RmLap;
      })
      // A car with no position yet (RedMist's InvalidPosition is -999) keeps the order from its laps.
      .filter((p) => p.n && (p.ovp ?? 0) > 0),
  };
  return { sessionId: num(a[SS.sessionId]) ?? null, results, currentFlag: num(a[SS.currentFlag]) ?? null, timeToGo: str(a[SS.timeToGo]) ?? null };
}

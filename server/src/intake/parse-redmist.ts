/**
 * Pure handling of RedMist (redmist.racing) export JSON (no network).
 *
 * API base: https://api.redmist.racing/status (open source:
 * github.com/bgriggs/redmist-timing-scoring-backend, models in redmist-timing-common).
 *   GET v2/Events/LoadArchivedEvents?offset=&take=     past events  [{ eid, oid, on, en, ed, t, … }]
 *   GET v2/Events/LoadLiveAndRecentEvents               live / recent events (same shape)
 *   GET v1/Events/LoadSessions?eventId=                 [{ sid, eid, n, st, et, tz, lu, il, pq }]
 *   GET v1/Exports/GetAvailability?eventId=&sessionId=  { sessionCompleted, lapDataAvailable, pitReportAvailable, carNumbers }
 *   GET v1/Exports/GetCarLaps?eventId=&sessionId=&format=json   every car's laps (CarPosition snapshots)
 *   GET v1/Exports/GetPitStops?eventId=&sessionId=&format=json  Flagtronics pit report
 *   GET v2/Events/LoadSessionResults?eventId=&sessionId=        final state: eventEntries, carPositions
 *   GET v1/Events/LoadFlags?eventId=&sessionId=                 [{ f, s, e }] (track local time)
 *   GET v1/Events/LoadSessionHistoricalControlLog?eventId=&sessionId=   race-control log
 *
 * The RaceTrace chart (legacy parser) reads Speedhive-format CSVs, so this
 * module writes the summary, all-laps, flags and control-log CSVs from the
 * RedMist JSON. The fact engine reads the JSON itself (analysis/adapters/redmist.ts).
 *
 * Crossing times. A lap object has no time of day: its `ttm` is the time since
 * the race clock started. The crossing instant is the session start plus `ttm`,
 * where the session start is `sessionStartTime` when the results set it, else
 * the results' `localTimeOfDay - runningRaceTime` (the same rule as the fact
 * engine's adapter; it reproduces Speedhive's Time of Day to the millisecond
 * at Barber 2026). The `Time` column of RedMist's own CSV export is not used:
 * it is when RedMist's server logged the lap, which ran 15 s ahead of the
 * timing clock at West Desert 2026.
 */
import { sha256 } from "./names.js";
import { classifySession } from "./series.js";
import { redmistSourceKey } from "./source-key.js";
import { toCsv } from "./parse-speedhive.js";
import { redmistFlagVisits } from "../analysis/engine/passages.js";
import type { LapRow } from "../analysis/engine/context.js";
import type { RaceSession } from "./types.js";

export const REDMIST_API = process.env.INTAKE_REDMIST_API || "https://api.redmist.racing/status";

/** RedMist organisation id of the World Racing League. */
export const WRL_ORG_ID = 1;

export interface RmEventSummary {
  eid: number;
  oid?: number;
  on?: string;
  en?: string;
  ed?: string;
  t?: string;
  l?: boolean;
  sim?: boolean;
  arch?: boolean;
  priv?: boolean;
  [k: string]: unknown;
}

export interface RmSession {
  sid: number;
  eid: number;
  n?: string;
  st?: string;
  et?: string | null;
  tz?: number;
  lu?: string | null;
  il?: boolean;
  pq?: boolean;
  [k: string]: unknown;
}

export interface RmAvailability {
  sessionCompleted?: boolean;
  lapDataAvailable?: boolean;
  pitReportAvailable?: boolean;
  carNumbers?: string[];
}

export interface RmLap {
  n?: string | null;
  class?: string | null;
  llp?: number | null;
  ltm?: string | null;
  ttm?: string | null;
  ovp?: number | null;
  clp?: number | null;
  og?: string | null;
  od?: string | null;
  lip?: boolean | null;
  ip?: boolean | null;
  flg?: number | null;
  dn?: string | null;
  [k: string]: unknown;
}

export interface RmLapsDoc {
  eventId?: number;
  eventName?: string;
  sessionId?: number;
  sessionName?: string;
  trackTimeZone?: string;
  laps: RmLap[];
  truncated?: boolean;
  [k: string]: unknown;
}

export interface RmPitStop {
  carNumber: string;
  stopNumber?: number;
  startLap: number;
  endLap: number;
  pitEntryTime?: string | null;
  pitExitTime?: string | null;
  pitDurationMs?: number | null;
  [k: string]: unknown;
}

export interface RmPitsDoc {
  pitStops: RmPitStop[];
  [k: string]: unknown;
}

export interface RmResults {
  eventName?: string;
  sessionName?: string;
  sessionStartTime?: string | null;
  localTimeOfDay?: string | null;
  runningRaceTime?: string | null;
  eventEntries?: { no?: string; nm?: string; t?: string; c?: string }[];
  carPositions?: RmLap[];
  [k: string]: unknown;
}

export interface RmFlag {
  f: number;
  s?: string | null;
  e?: string | null;
}

export interface RmControlEntry {
  o?: number;
  t?: string | null;
  cor?: string | null;
  c1?: string | null;
  c2?: string | null;
  n?: string | null;
  s?: string | null;
  a?: string | null;
}

// ─── events and sessions ─────────────────────────────────────────────────────

/** Event list from LoadArchivedEvents / LoadLiveAndRecentEvents (array, or { events | items }). */
export function eventsFromResponse(json: unknown): RmEventSummary[] {
  const o = json && typeof json === "object" && !Array.isArray(json) ? (json as { events?: unknown; items?: unknown }) : null;
  const arr: unknown = Array.isArray(json) ? json : (o?.events ?? o?.items ?? []);
  return (Array.isArray(arr) ? (arr as RmEventSummary[]) : [])
    .filter((e) => e && typeof e === "object" && Number.isFinite(Number(e.eid)))
    .map((e) => ({ ...e, eid: Number(e.eid) }));
}

export function isWrlEvent(e: RmEventSummary): boolean {
  if (e.sim || e.priv) return false;
  if (e.oid !== undefined && e.oid !== null) return Number(e.oid) === WRL_ORG_ID;
  return /world racing league|\bwrl\b/i.test(`${e.on ?? ""} ${e.en ?? ""}`);
}

/** "World Racing League - West Desert 2026" → "West Desert 2026". */
export function eventDisplayName(name: string | undefined, eventId: number): string {
  const n = (name ?? "").replace(/\s+/g, " ").trim();
  return n.replace(/^(world racing league|wrl)\s*[-–—:@]?\s*/i, "").trim() || n || `RedMist event ${eventId}`;
}

/** A date YYYY-MM-DD from "YYYY-MM-DD…" or LoadEvent's "MM/DD/YYYY hh:mm:ss"; null for .NET's year-1 "no date". */
export function plausibleDate(s: string | null | undefined): string | null {
  const t = String(s ?? "").trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Number(m[1]) >= 2000 ? `${m[1]}-${m[2]}-${m[3]}` : null;
  const u = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  return u && Number(u[3]) >= 2000 ? `${u[3]}-${u[1].padStart(2, "0")}-${u[2].padStart(2, "0")}` : null;
}

/**
 * Local calendar date of a session start. RedMist sends `st` in UTC without a
 * zone suffix (West Desert 2026 Saturday: "2026-09-26T13:27:33", tz -6, the
 * session opening at 07:27 local) and `tz` as the UTC offset in hours.
 */
export function sessionLocalDate(s: RmSession, fallback?: string | null): string | null {
  const st = String(s.st ?? "").trim();
  if (!plausibleDate(st)) return plausibleDate(fallback);
  const ms = Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(st) ? st : `${st}Z`);
  if (Number.isFinite(ms) && Number.isFinite(Number(s.tz))) return new Date(ms + Number(s.tz) * 3600_000).toISOString().slice(0, 10);
  return plausibleDate(st);
}

export function redmistVersion(s: RmSession, a: RmAvailability): string {
  return sha256(
    JSON.stringify([s.sid, s.et ?? null, s.lu ?? null, !!a.sessionCompleted, !!a.lapDataAvailable, !!a.pitReportAvailable, (a.carNumbers ?? []).length])
  ).slice(0, 16);
}

export function buildRedmistSession(ev: RmEventSummary, s: RmSession, a: RmAvailability, seriesId = "wrl"): RaceSession | null {
  const raceDate = sessionLocalDate(s, ev.ed);
  if (!raceDate) return null;
  const event = eventDisplayName(ev.en, ev.eid);
  const sessionName = (s.n ?? `Session ${s.sid}`).replace(/\s+/g, " ").trim();
  return {
    sourceKey: redmistSourceKey(ev.eid, s.sid),
    site: "redmist",
    seriesId,
    seriesLabel: "World Racing League",
    championship: ev.on || "World Racing League",
    season: Number(raceDate.slice(0, 4)),
    event,
    track: (ev.t || event).replace(/\s+/g, " ").trim(),
    sessionName,
    sessionType: s.pq ? (/qual/i.test(sessionName) ? "qualify" : "practice") : classifySession(sessionName),
    startTime: plausibleDate(s.st) ? String(s.st) : raceDate,
    raceDate,
    files: [],
    // RedMist carries no official / provisional mark (DEFINITIONS D-FINISH: TBD), like Speedhive.
    resultsStatus: "unknown",
    version: redmistVersion(s, a),
    legacyFormat: "speedhive",
    factFormat: "redmist",
    ids: {
      eventId: ev.eid,
      sessionId: s.sid,
      lapData: !!a.lapDataAvailable,
      pitReport: !!a.pitReportAvailable,
      ...(ev.oid !== undefined ? { organizationId: Number(ev.oid) } : {}),
    },
  };
}

// ─── times ───────────────────────────────────────────────────────────────────

/** .NET TimeSpan text ("08:03:48.003", "1.02:03:04.5", "2:07.972") → seconds; null when empty or malformed. */
export function parseSpan(s: string | null | undefined): number | null {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const m = t.match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (m) return (m[1] ? Number(m[1]) * 86400 : 0) + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  const k = t.match(/^(\d{1,3}):(\d{2}(?:\.\d+)?)$/);
  if (k) return Number(k[1]) * 60 + Number(k[2]);
  const n = t.match(/^\d+(?:\.\d+)?$/);
  return n ? Number(t) : null;
}

/** Seconds of the day from "HH:MM:SS(.f)". */
function clockSeconds(s: string | null | undefined): number | null {
  const m = String(s ?? "").trim().match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Seconds → "1:39.089" or "1:02:03.456" (the Speedhive lap-time style). */
export function formatLapTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(3).padStart(6, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
}

/** Local date + seconds after its midnight (may exceed a day) → "YYYY-MM-DDTHH:MM:SS.fff". */
export function localTimestamp(date: string, sec: number): string {
  const ms = Math.round(sec * 1000);
  const day = Math.floor(ms / 86400_000);
  const rem = ms - day * 86400_000;
  const hh = String(Math.floor(rem / 3600_000)).padStart(2, "0");
  const mm = String(Math.floor((rem % 3600_000) / 60_000)).padStart(2, "0");
  const ss = ((rem % 60_000) / 1000).toFixed(3).padStart(6, "0");
  return `${addDays(date, day)}T${hh}:${mm}:${ss}`;
}

export interface SessionClock {
  /** Local date of the race-clock start. */
  date: string;
  /** Race-clock start, seconds after local midnight. */
  startSec: number;
  source: string;
}

/**
 * When the race clock started, in track local time. Order: results
 * `sessionStartTime` (when not year 1) → results `localTimeOfDay -
 * runningRaceTime` → first green flag less the earliest lap-1 start on the
 * race clock. The date comes from the flags (first dated record), else the
 * session's local date.
 */
export function sessionClock(laps: RmLap[], results: RmResults | null, flags: RmFlag[] | null, fallbackDate: string | null): SessionClock | null {
  const flagDate = (flags ?? []).map((f) => plausibleDate(f.s)).find(Boolean) ?? null;
  const sst = String(results?.sessionStartTime ?? "");
  const sstDate = plausibleDate(sst);
  if (sstDate && !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(sst)) {
    const sec = clockSeconds(sst.slice(11, 23).replace(/(\.\d{3})\d+$/, "$1"));
    if (sec !== null) return { date: sstDate, startSec: sec, source: "results sessionStartTime" };
  }
  const date = flagDate ?? plausibleDate(fallbackDate);
  if (!date) return null;
  const tod = clockSeconds(results?.localTimeOfDay);
  const run = parseSpan(results?.runningRaceTime);
  if (tod !== null && run !== null) {
    return { date, startSec: (((tod - run) % 86400) + 86400) % 86400, source: "results localTimeOfDay - runningRaceTime" };
  }
  const green = (flags ?? []).find((f) => f.f === 1 && plausibleDate(f.s));
  let minL1: number | null = null;
  for (const l of laps) {
    if (l.llp !== 1) continue;
    const tt = parseSpan(l.ttm);
    const lt = parseSpan(l.ltm);
    if (tt !== null && lt !== null) minL1 = minL1 === null ? tt - lt : Math.min(minL1, tt - lt);
  }
  const gs = green ? clockSeconds(String(green.s).slice(11)) : null;
  if (gs !== null && minL1 !== null) return { date: plausibleDate(green!.s)!, startSec: gs - minL1, source: "first green flag - earliest lap-1 start (estimate)" };
  return null;
}

// ─── CSVs for the legacy (Speedhive-format) parser ───────────────────────────

/** RedMist Flags enum → Speedhive lap Status. White (last lap) is green running; Purple35/60 (Code 35/60) is full-course slow. */
export function rmStatus(f: number | null | undefined): string {
  switch (f) {
    case 1:
    case 4:
      return "GREEN";
    case 2:
      return "YELLOW";
    case 7:
    case 8:
      return "FCY";
    case 3:
      return "RED";
    case 5:
      return "FINISH";
    default:
      return "";
  }
}

/** RedMist Flags enum → flags-CSV Flag name the legacy flags parser knows; null = not a race-state change. */
function rmFlagName(f: number): string | null {
  switch (f) {
    case 1:
    case 4:
      return "Green";
    case 2:
      return "Yellow";
    case 7:
    case 8:
      return "FCY";
    case 3:
      return "Red";
    case 5:
      return "Checkered";
    default:
      return null;
  }
}

const numStr = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "" : String(x));

/** "4.019" / "1:32.786" → seconds string; "2 laps" → laps. */
function gapParts(s: string | null | undefined): { time: string; laps: string } {
  const t = String(s ?? "").trim();
  const lp = t.match(/^(\d+)\s*laps?$/i);
  if (lp) return { time: "", laps: lp[1] };
  const sec = parseSpan(t);
  return sec === null ? { time: "", laps: "" } : { time: r3(sec).toFixed(3), laps: "0" };
}

export interface CarInfo {
  num: string;
  name: string;
  cls: string;
  finishPos: number | null;
  finishPosClass: number | null;
}

const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** One row per car: results order, team name from the entry list (`nm`, as Speedhive shows it). */
export function carsFromResults(results: RmResults | null, laps: RmLap[]): CarInfo[] {
  const entries = new Map((results?.eventEntries ?? []).filter((e) => e.no).map((e) => [String(e.no), e]));
  const finals = new Map<string, RmLap>();
  for (const p of results?.carPositions ?? []) if (p.n) finals.set(String(p.n), p);
  const last = new Map<string, RmLap>();
  for (const l of laps) if (l.n && (l.llp ?? 0) >= 1 && (!last.has(l.n) || (l.llp ?? 0) >= (last.get(l.n)!.llp ?? 0))) last.set(l.n, l);
  const nums = new Set([...finals.keys(), ...last.keys()]);
  const cars = [...nums].map((num) => {
    const e = entries.get(num);
    const f = finals.get(num) ?? last.get(num);
    return {
      num,
      name: (e?.nm || e?.t || `Car #${num}`).replace(/\s+/g, " ").trim(),
      cls: (e?.c || f?.class || last.get(num)?.class || "").trim(),
      finishPos: f?.ovp ?? null,
      finishPosClass: f?.clp ?? null,
    };
  });
  return cars.sort((a, b) => (a.finishPos ?? 9999) - (b.finishPos ?? 9999) || natural(a.num, b.num));
}

export function buildRedmistSummaryCsv(cars: CarInfo[]): string {
  // Status: RedMist has no classification status (Running / DNF); left empty rather than guessed.
  return toCsv(
    ["Position", "Start Number", "Name", "Class", "Position In Class", "Status"],
    cars.map((c) => [numStr(c.finishPos), c.num, c.name, c.cls, numStr(c.finishPosClass), ""])
  );
}

export const REDMIST_EXTRA_LAP_COLUMNS = ["Driver", "Pit Stop"];

/**
 * In-laps of every pit stop, per car ("car|lap"). With the Flagtronics pit
 * report: each stop's startLap. Without it: the fact engine's reading of
 * RedMist's lap pit flags (redmistFlagVisits: LapIncludedPit / IsInPit, a
 * lone late flag moved back one lap, lap-1 staging ignored), so the chart and
 * the analysis count the same stops.
 */
export function pitInLaps(laps: RmLap[], pits: RmPitsDoc | null): Set<string> {
  if (pits) return new Set(pits.pitStops.map((p) => `${p.carNumber}|${p.startLap}`));
  const byCar = new Map<string, Map<number, RmLap>>();
  for (const l of laps) {
    const lap = Number(l.llp);
    if (!l.n || !Number.isInteger(lap) || lap < 1) continue;
    if (!byCar.has(l.n)) byCar.set(l.n, new Map());
    byCar.get(l.n)!.set(lap, l);
  }
  const out = new Set<string>();
  for (const [car, m] of byCar) {
    const rows = [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([lap, l]) => ({ lap, inPit: !!l.lip, crossedInPit: !!l.ip }) as unknown as LapRow);
    for (const v of redmistFlagVisits(rows)) out.add(`${car}|${rows[v.i0].lap}`);
  }
  return out;
}

/**
 * All-laps CSV in the Speedhive column set, plus "Driver" and "Pit Stop"
 * (True on each stop's in-lap, see pitInLaps), which the legacy parser takes
 * instead of guessing stops from lap times. "In Pit" is RedMist's
 * LapIncludedPit. Diff/speed/leader-lap columns RedMist does not supply are
 * left empty.
 */
export function buildRedmistAllLapsCsv(laps: RmLap[], cars: CarInfo[], clock: SessionClock | null, pits: RmPitsDoc | null): string {
  const info = new Map(cars.map((c) => [c.num, c]));
  const stops = pitInLaps(laps, pits);
  const byCar = new Map<string, Map<number, RmLap>>();
  for (const l of laps) {
    const n = l.n ? String(l.n) : "";
    const lap = Number(l.llp);
    if (!n || !Number.isInteger(lap) || lap < 1) continue;
    if (!byCar.has(n)) byCar.set(n, new Map());
    byCar.get(n)!.set(lap, l); // a later snapshot of the same lap wins
  }
  const order = [...byCar.keys()].sort((a, b) => (info.get(a)?.finishPos ?? 9999) - (info.get(b)?.finishPos ?? 9999) || natural(a, b));
  const header = [
    "Team/Name", "Start Number", "Class",
    "Finish Position (Overall)", "Finish Position (Class)",
    "Lap Number", "Lap Time", "Time of Day",
    "Diff vs Best Lap", "Diff vs Last Lap", "Speed", "In Pit",
    "Field Position", "Leader Lap",
    "Gap to Leader (Time)", "Gap to Leader (Laps)",
    "Gap Ahead (Time)", "Gap Behind (Time)",
    "Status",
    "Driver",
    "Pit Stop",
  ];
  const rows: string[][] = [];
  for (const num of order) {
    const c = info.get(num);
    const carLaps = [...byCar.get(num)!.entries()].sort((a, b) => a[0] - b[0]);
    for (const [lapNr, l] of carLaps) {
      const lt = parseSpan(l.ltm);
      const tt = parseSpan(l.ttm);
      const toLeader = gapParts(l.od);
      const ahead = gapParts(l.og);
      rows.push([
        c?.name ?? `Car #${num}`, num, c?.cls || String(l.class ?? ""),
        numStr(c?.finishPos), numStr(c?.finishPosClass),
        String(lapNr), lt !== null ? formatLapTime(lt) : "", clock && tt !== null ? localTimestamp(clock.date, clock.startSec + tt) : "",
        "", "", "", l.lip ? "True" : "False",
        numStr(l.ovp), "",
        toLeader.time, toLeader.laps,
        ahead.time, "",
        rmStatus(l.flg),
        String(l.dn ?? "").trim(),
        stops.has(`${num}|${lapNr}`) ? "True" : "False",
      ]);
    }
  }
  return toCsv(header, rows);
}

/** Flags CSV (Flag, Start, End, Duration) for the legacy flags parser; times stay track local. */
export function buildRedmistFlagsCsv(flags: RmFlag[]): string {
  const rows: string[][] = [];
  for (const f of flags) {
    const name = rmFlagName(Number(f.f));
    if (!name || !plausibleDate(f.s) || !plausibleDate(f.e)) continue;
    const d = (Date.parse(`${f.e}Z`) - Date.parse(`${f.s}Z`)) / 1000;
    rows.push([name, String(f.s), String(f.e), Number.isFinite(d) && d >= 0 ? formatLapTime(d) : ""]);
  }
  return toCsv(["Flag", "Start", "End", "Duration"], rows);
}

/** Control-log CSV (Sequence, Timestamp, Car_1, Car_2, Description, Action, Status, Corner) in sequence order. */
export function buildRedmistControlCsv(entries: RmControlEntry[]): string {
  const rows = [...entries]
    .sort((a, b) => (a.o ?? 0) - (b.o ?? 0))
    .map((e) => [
      numStr(e.o),
      String(e.t ?? ""),
      e.c1 ? `#${String(e.c1).replace(/^#/, "")}` : "",
      e.c2 ? `#${String(e.c2).replace(/^#/, "")}` : "",
      String(e.n ?? ""),
      String(e.a ?? ""),
      String(e.s ?? ""),
      String(e.cor ?? ""),
    ]);
  return toCsv(["Sequence", "Timestamp", "Car_1", "Car_2", "Description", "Action", "Status", "Corner"], rows);
}

/** Race date: the flags' local date (D-DATE), else the race-clock date. */
export function redmistRaceDate(flags: RmFlag[] | null, clock: SessionClock | null): string | null {
  return clock?.date ?? (flags ?? []).map((f) => plausibleDate(f.s)).find(Boolean) ?? null;
}

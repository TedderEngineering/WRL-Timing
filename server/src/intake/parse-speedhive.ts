/**
 * Pure handling of Speedhive event-results API JSON (no network).
 *
 * API: https://eventresults-api.speedhive.com/api/v0.2.3/eventresults
 *   GET /organizations/{orgId}/events?count=&offset=   events of an organisation
 *   GET /events/{eventId}?sessions=true                event with its sessions (in groups)
 *   GET /sessions/{sessionId}                          session (name, eventId, type, startTime)
 *   GET /sessions/{sessionId}/classification           { rows: [...] }
 *   GET /sessions/{sessionId}/lapdata/{position}/laps?count=500&offset=0
 *   GET /sessions/{sessionId}/announcements            race-control announcements
 *
 * Shapes follow stage2/intake/Speedhive_Project_Instructions.md and
 * speedhive_download_11748965.py; the organisation and event-session
 * endpoints follow the speedhive-tools client (0.9.10). The CSVs written here
 * reproduce that Python script's columns exactly, because the legacy parser
 * (src/utils/parsers/speedhive.ts) and the fact engine's Speedhive adapter
 * read them.
 */
import { sha256 } from "./names.js";
import { classifySession } from "./series.js";
import { speedhiveSourceKey } from "./source-key.js";
import type { RaceSession, SessionType } from "./types.js";

export const SPEEDHIVE_API = process.env.INTAKE_SPEEDHIVE_API || "https://eventresults-api.speedhive.com/api/v0.2.3/eventresults";

export interface ShEvent {
  id: number;
  name?: string;
  startDate?: string;
  updatedAt?: string;
  location?: { name?: string; length?: number; lengthUnit?: string } | null;
  organization?: { id?: number; name?: string } | null;
  sessions?: unknown;
  [k: string]: unknown;
}

export interface ShSession {
  id: number;
  name?: string;
  eventId?: number;
  type?: string;
  startTime?: string;
  groupName?: string;
  isMerge?: boolean;
  [k: string]: unknown;
}

export interface ShClassRow {
  position?: number;
  startNumber?: string | number;
  name?: string;
  resultClass?: string;
  positionInClass?: number;
  status?: string;
  additionalFields?: { name?: string; value?: unknown }[] | null;
  [k: string]: unknown;
}

export interface ShLap {
  lapNr?: number;
  timeOfDay?: string;
  lapTime?: string;
  diffWithLastLap?: unknown;
  diffWithBestLap?: unknown;
  speed?: unknown;
  sectionTimes?: unknown[] | null;
  inPit?: boolean;
  status?: unknown;
  fieldComparison?: {
    position?: unknown;
    leaderLap?: unknown;
    diff?: { time?: unknown; laps?: unknown } | null;
    gapAhead?: { time?: unknown } | null;
    gapBehind?: { time?: unknown } | null;
  } | null;
}

/** One participant's lap data, as stored in sh-lapdata.json. */
export interface ShParticipantLaps {
  position: number;
  participantInfo?: {
    name?: string;
    startNr?: string | number;
    class?: string;
    fieldFinishPos?: unknown;
    classFinishPos?: unknown;
  } | null;
  lapCount?: number;
  laps: ShLap[];
  /** No lap data (HTTP 404, usually DNS). */
  missing?: boolean;
}

/** Event list from /organizations/{id}/events (array, or { rows | events | items }). */
export function eventsFromOrgResponse(json: unknown): ShEvent[] {
  const arr = Array.isArray(json)
    ? json
    : json && typeof json === "object"
      ? ((json as any).rows ?? (json as any).events ?? (json as any).items ?? [])
      : [];
  return (arr as any[]).filter((e) => e && typeof e === "object" && Number.isFinite(Number(e.id))).map((e) => ({ ...e, id: Number(e.id) }));
}

/** Every session in an event response: `sessions` may be a list, or { groups: [{ sessions, subGroups }], sessions }. */
export function sessionsFromEventResponse(json: unknown): ShSession[] {
  const out: ShSession[] = [];
  const seen = new Set<number>();
  const visit = (node: unknown, groupName?: string): void => {
    if (Array.isArray(node)) {
      for (const n of node) visit(n, groupName);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const looksLikeSession = Number.isFinite(Number(o.id)) && typeof o.name === "string" && ("type" in o || "startTime" in o || "eventId" in o);
    if (looksLikeSession && !("sessions" in o) && !("groups" in o)) {
      const id = Number(o.id);
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ ...(o as any), id, ...(groupName && !o.groupName ? { groupName } : {}) });
      }
      return;
    }
    const gname = typeof o.name === "string" && ("sessions" in o || "subGroups" in o) ? o.name : groupName;
    for (const k of ["sessions", "groups", "subGroups"]) if (k in o) visit(o[k], gname);
  };
  visit(json && typeof json === "object" && "sessions" in (json as object) ? (json as any).sessions : json);
  if (json && typeof json === "object" && "groups" in (json as object)) visit((json as any).groups);
  return out;
}

export function sessionTypeOf(s: ShSession): SessionType {
  const t = String(s.type ?? "").toLowerCase();
  if (/race/.test(t)) return "race";
  if (/qual/.test(t)) return "qualify";
  if (/pract|warm|test/.test(t)) return "practice";
  return classifySession(`${s.name ?? ""}`);
}

/** Local calendar date from an ISO string ("2026-02-28T09:00:00" or with an offset): its own date part. */
export function isoDatePart(s: string | undefined): string | null {
  const m = (s ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function speedhiveVersion(event: ShEvent, session: ShSession): string {
  return sha256(JSON.stringify([event.updatedAt ?? null, session.id, session.startTime ?? null, session.name ?? null])).slice(0, 16);
}

export function buildSpeedhiveSession(event: ShEvent, session: ShSession, seriesId = "wrl-speedhive"): RaceSession | null {
  const raceDate = isoDatePart(session.startTime) ?? isoDatePart(event.startDate);
  if (!raceDate) return null;
  const eventName = (event.name ?? `Event ${event.id}`).replace(/\s+/g, " ").trim();
  return {
    sourceKey: speedhiveSourceKey(session.id),
    site: "speedhive",
    seriesId,
    seriesLabel: "World Racing League",
    championship: event.organization?.name ?? "Speedhive",
    season: Number(raceDate.slice(0, 4)),
    event: eventName,
    track: (event.location?.name ?? eventName).trim(),
    sessionName: (session.name ?? `Session ${session.id}`).replace(/\s+/g, " ").trim(),
    sessionType: sessionTypeOf(session),
    startTime: session.startTime ?? event.startDate ?? raceDate,
    raceDate,
    files: [],
    // Speedhive exports carry no official/provisional mark (DEFINITIONS D-FINISH: TBD).
    resultsStatus: "unknown",
    version: speedhiveVersion(event, session),
    legacyFormat: "speedhive",
    factFormat: "speedhive",
    ids: { sessionId: session.id, eventId: event.id, ...(event.organization?.id ? { organizationId: event.organization.id } : {}) },
  };
}

// ─── CSV, byte-compatible with speedhive_download_*.py ───────────────────────

/** Python csv/str() rendering: None → "", True/False, lists joined by ",". */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (Array.isArray(v)) return v.map(pyStr).join(",");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("time" in o) return pyStr(o.time);
    if ("duration" in o) return pyStr(o.duration);
    return JSON.stringify(v);
  }
  return String(v);
}

function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text with Python's defaults (QUOTE_MINIMAL, "\r\n" line ends). */
export function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const ALL_LAPS_COLUMNS = [
  "Team/Name", "Start Number", "Class",
  "Finish Position (Overall)", "Finish Position (Class)",
  "Lap Number", "Lap Time", "Time of Day",
  "Diff vs Best Lap", "Diff vs Last Lap", "Speed", "In Pit",
  "Field Position", "Leader Lap",
  "Gap to Leader (Time)", "Gap to Leader (Laps)",
  "Gap Ahead (Time)", "Gap Behind (Time)",
  "Status",
];

export function buildAllLapsCsv(rows: ShClassRow[], laps: ShParticipantLaps[]): string {
  const byPos = new Map(rows.map((r, i) => [Number(r.position ?? i + 1), r]));
  let maxSectors = 0;
  for (const p of laps) for (const l of p.laps) maxSectors = Math.max(maxSectors, l.sectionTimes?.length ?? 0);
  const header = [...ALL_LAPS_COLUMNS, ...Array.from({ length: maxSectors }, (_, i) => `Sector ${i + 1}`)];
  const out: string[][] = [];
  for (const p of laps) {
    const row = byPos.get(p.position);
    const info = p.participantInfo ?? {};
    const name = info.name ?? row?.name ?? "Unknown";
    const startNr = info.startNr ?? row?.startNumber ?? "";
    const cls = info.class ?? row?.resultClass ?? "";
    const fieldPos = info.fieldFinishPos ?? p.position;
    const classPos = info.classFinishPos ?? row?.positionInClass ?? "";
    for (const l of p.laps) {
      const fc = l.fieldComparison ?? {};
      const sectors = (l.sectionTimes ?? []).map(pyStr);
      out.push([
        pyStr(name), pyStr(startNr), pyStr(cls), pyStr(fieldPos), pyStr(classPos),
        pyStr(l.lapNr), pyStr(l.lapTime), pyStr(l.timeOfDay),
        pyStr(l.diffWithBestLap), pyStr(l.diffWithLastLap), pyStr(l.speed), pyStr(l.inPit),
        pyStr(fc.position), pyStr(fc.leaderLap),
        pyStr(fc.diff?.time), pyStr(fc.diff?.laps),
        pyStr(fc.gapAhead?.time), pyStr(fc.gapBehind?.time),
        pyStr(l.status),
        ...Array.from({ length: maxSectors }, (_, i) => sectors[i] ?? ""),
      ]);
    }
  }
  return toCsv(header, out);
}

export function buildSummaryCsv(rows: ShClassRow[]): string {
  const extra: string[] = [];
  for (const r of rows) for (const af of r.additionalFields ?? []) if (af?.name && !extra.includes(af.name)) extra.push(af.name);
  const header = ["Position", "Start Number", "Name", "Class", "Position In Class", "Status", ...extra];
  const out = rows.map((r) => {
    const add = new Map((r.additionalFields ?? []).map((af) => [af?.name ?? "", af?.value]));
    return [
      pyStr(r.position), pyStr(r.startNumber), pyStr(r.name), pyStr(r.resultClass),
      pyStr(r.positionInClass), pyStr(r.status),
      ...extra.map((k) => pyStr(add.get(k))),
    ];
  });
  return toCsv(header, out);
}

/** Local date of the first lap-1 crossing (D-DATE for Speedhive: Time of Day is naive local). */
export function firstLapDate(laps: ShParticipantLaps[]): string | null {
  const firsts = laps
    .flatMap((p) => p.laps.filter((l) => l.lapNr === 1).map((l) => l.timeOfDay ?? ""))
    .filter((t) => /^\d{4}-\d{2}-\d{2}/.test(t))
    .sort();
  return firsts.length ? firsts[0].slice(0, 10) : null;
}

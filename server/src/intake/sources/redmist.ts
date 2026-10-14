/**
 * WRL via RedMist (redmist.racing), the WRL timing and scoring platform.
 *
 * Discovery takes the known WRL events (redmist-events.json, from the
 * back-catalogue inventory) plus whatever RedMist lists as archived or live
 * and recent for the WRL organisation, keeps the race sessions, and asks
 * GetAvailability for each: a session is listed only once it has ended and
 * has lap data. RedMist holds no lap history for 2025; use `wrl-speedhive`
 * for those races.
 *
 * Download keeps the raw JSON (laps, pit report when Flagtronics ran,
 * results, flags, race-control log) for the fact engine, and writes the
 * Speedhive-format CSVs the chart's legacy parser reads (parse-redmist.ts).
 *
 * RedMist allows anonymous callers about one request per 1.1 s. Every call
 * here waits at least REDMIST_GAP_MS since the previous one, and the HTTP
 * client backs off on 429.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HttpClient } from "../http.js";
import { addManualFiles, newManifest, readManifest, writeManifest } from "../manifest.js";
import { sha256 } from "../names.js";
import {
  REDMIST_API,
  buildRedmistAllLapsCsv,
  buildRedmistControlCsv,
  buildRedmistFlagsCsv,
  buildRedmistSession,
  buildRedmistSummaryCsv,
  carsFromResults,
  eventsFromResponse,
  isWrlEvent,
  plausibleDate,
  redmistRaceDate,
  sessionClock,
  type RmAvailability,
  type RmControlEntry,
  type RmEventSummary,
  type RmFlag,
  type RmLapsDoc,
  type RmPitsDoc,
  type RmResults,
  type RmSession,
} from "../parse-redmist.js";
import { parseRedmistRef, parseSourceKey } from "../source-key.js";
import type { DiscoverOptions, DownloadOptions, DownloadReport, FileRole, ManifestFile, RaceSession } from "../types.js";
import { REDMIST_KNOWN_EVENTS } from "./redmist-events.js";

/** Minimum gap between RedMist requests (ms). */
export const REDMIST_GAP_MS = Number(process.env.INTAKE_REDMIST_GAP_MS || 1600);

export { REDMIST_KNOWN_EVENTS };

export interface RedmistPacing {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  gapMs?: number;
}

/** HttpClient wrapper that keeps REDMIST_GAP_MS between calls (on top of the client's own gap). */
export function paced(http: HttpClient, p: RedmistPacing = {}): HttpClient {
  const sleep = p.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = p.now ?? Date.now;
  const gap = p.gapMs ?? REDMIST_GAP_MS;
  let last = -Infinity;
  const wait = async () => {
    const w = last + gap - now();
    if (w > 0) await sleep(w);
    last = now();
  };
  return {
    async get(url, o) {
      await wait();
      return http.get(url, o);
    },
    async getText(url, o) {
      await wait();
      return http.getText(url, o);
    },
    async getJson(url, o) {
      await wait();
      return http.getJson(url, o);
    },
  };
}

const q = (path: string, params: Record<string, string | number>) =>
  `${REDMIST_API}/${path}?${Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&")}`;

export const redmistUrls = {
  archived: (offset: number, take: number) => q("v2/Events/LoadArchivedEvents", { offset, take }),
  liveAndRecent: () => `${REDMIST_API}/v2/Events/LoadLiveAndRecentEvents`,
  sessions: (eventId: number) => q("v1/Events/LoadSessions", { eventId }),
  availability: (eventId: number, sessionId: number) => q("v1/Exports/GetAvailability", { eventId, sessionId }),
  laps: (eventId: number, sessionId: number) => q("v1/Exports/GetCarLaps", { eventId, sessionId, format: "json" }),
  pits: (eventId: number, sessionId: number) => q("v1/Exports/GetPitStops", { eventId, sessionId, format: "json" }),
  results: (eventId: number, sessionId: number) => q("v2/Events/LoadSessionResults", { eventId, sessionId }),
  flags: (eventId: number, sessionId: number) => q("v1/Events/LoadFlags", { eventId, sessionId }),
  control: (eventId: number, sessionId: number) => q("v1/Events/LoadSessionHistoricalControlLog", { eventId, sessionId }),
};

const PAGE = 100;

/** WRL events RedMist lists (archived + live/recent), merged with the known catalogue. */
export async function listWrlEvents(http: HttpClient, log: (m: string) => void = () => undefined): Promise<RmEventSummary[]> {
  const byId = new Map<number, RmEventSummary>();
  for (const k of REDMIST_KNOWN_EVENTS) byId.set(k.eventId, { eid: k.eventId, oid: 1, en: k.name, t: k.track, ed: `${k.season}-01-01` });
  let listed = 0;
  try {
    for (let offset = 0; offset < 5000; offset += PAGE) {
      const page = eventsFromResponse(await http.getJson(redmistUrls.archived(offset, PAGE)));
      listed += page.length;
      for (const e of page.filter(isWrlEvent)) byId.set(e.eid, { ...byId.get(e.eid), ...e });
      if (page.length < PAGE) break;
    }
    for (const e of eventsFromResponse(await http.getJson(redmistUrls.liveAndRecent())).filter(isWrlEvent)) byId.set(e.eid, { ...byId.get(e.eid), ...e });
  } catch (e) {
    log(`RedMist: could not list events (${(e as Error).message}); using the known-events list only.`);
  }
  log(`RedMist: ${listed} archived events listed, ${byId.size} WRL events (known + listed)`);
  return [...byId.values()].sort((a, b) => a.eid - b.eid);
}

function eventSeason(e: RmEventSummary): number | null {
  const d = plausibleDate(e.ed);
  if (d) return Number(d.slice(0, 4));
  const k = REDMIST_KNOWN_EVENTS.find((x) => x.eventId === e.eid);
  return k?.season ?? null;
}

async function sessionsOf(http: HttpClient, eventId: number): Promise<RmSession[]> {
  const xs = (await http.getJson<RmSession[]>(redmistUrls.sessions(eventId))) ?? [];
  return (Array.isArray(xs) ? xs : []).filter((s) => s && Number.isFinite(Number(s.sid))).map((s) => ({ ...s, sid: Number(s.sid), eid: Number(s.eid ?? eventId) }));
}

function keep(rs: RaceSession | null, opts: DiscoverOptions): rs is RaceSession {
  if (!rs) return false;
  if (!opts.allSessions && rs.sessionType !== "race") return false;
  if (rs.season !== opts.season) return false;
  return !opts.since || rs.raceDate >= opts.since;
}

async function sessionsForEvent(
  http: HttpClient,
  ev: RmEventSummary,
  log: (m: string) => void,
  wanted: (probe: RaceSession, s: RmSession) => boolean
): Promise<RaceSession[]> {
  const out: RaceSession[] = [];
  for (const s of await sessionsOf(http, ev.eid)) {
    // Cheap filters first, so GetAvailability is only asked for sessions we would keep.
    const probe = buildRedmistSession(ev, s, {});
    if (!probe || !wanted(probe, s)) continue;
    const a = (await http.getJson<RmAvailability>(redmistUrls.availability(ev.eid, s.sid))) ?? {};
    if (!a.sessionCompleted || !a.lapDataAvailable) {
      log(`  RedMist ${ev.eid}/${s.sid} ${probe.event} — ${probe.sessionName}: ${!a.sessionCompleted ? "not finished" : "no lap data"}${probe.season <= 2025 ? " (use --series wrl-speedhive for 2025)" : ""}`);
      continue;
    }
    out.push(buildRedmistSession(ev, s, a)!);
  }
  return out;
}

export async function discoverRedmist(httpIn: HttpClient, opts: DiscoverOptions, pacing?: RedmistPacing): Promise<RaceSession[]> {
  const http = paced(httpIn, pacing);
  const events = (await listWrlEvents(http, opts.log)).filter((e) => {
    const y = eventSeason(e);
    return y === null || y === opts.season || y === opts.season - 1; // an event listed in late December can hold January racing
  });
  const out: RaceSession[] = [];
  const log = opts.log ?? (() => undefined);
  for (const ev of events) out.push(...(await sessionsForEvent(http, ev, log, (p) => keep(p, opts))));
  return out;
}

/** Sessions of one RedMist event or a single session (`--redmist 405` or `405/3` or an API URL). */
export async function discoverRedmistRef(httpIn: HttpClient, ref: string, opts: DiscoverOptions, pacing?: RedmistPacing): Promise<RaceSession[]> {
  const http = paced(httpIn, pacing);
  const r = parseRedmistRef(ref);
  const known = REDMIST_KNOWN_EVENTS.find((k) => k.eventId === r.eventId);
  const ev: RmEventSummary = { eid: r.eventId, ...(known ? { en: known.name, t: known.track, oid: 1 } : {}) };
  const log = opts.log ?? (() => undefined);
  // An explicitly named event is taken whatever its season; a named session whatever its type.
  return sessionsForEvent(http, ev, log, (p, s) => (r.sessionId !== null ? s.sid === r.sessionId : keep(p, { ...opts, season: p.season })));
}

export async function resolveRedmist(httpIn: HttpClient, sourceKey: string, pacing?: RedmistPacing): Promise<RaceSession> {
  const p = parseSourceKey(sourceKey);
  if (p.site !== "redmist") throw new Error(`Not a RedMist source key: ${sourceKey}`);
  const xs = await discoverRedmistRef(httpIn, `${p.eventId}/${p.sessionId}`, { season: 0 }, pacing);
  if (xs.length === 0) throw new Error(`RedMist session ${p.eventId}/${p.sessionId} not found, not finished, or without lap data`);
  return xs[0];
}

function put(
  dir: string,
  name: string,
  content: string,
  e: { url: string; role: FileRole; key: string; parserSlot: boolean; derivedFrom?: string[] },
  prev: ManifestFile | undefined,
  now: string
): { entry: ManifestFile; written: boolean } {
  const buf = Buffer.from(content, "utf-8");
  const digest = sha256(buf);
  const path = join(dir, name);
  const same = prev && prev.sha256 === digest && existsSync(path) && sha256(readFileSync(path)) === digest;
  if (!same) writeFileSync(path, buf);
  return {
    entry: {
      name,
      sourceName: e.url.replace(REDMIST_API, ""),
      url: e.url,
      role: e.role,
      key: e.key,
      parserSlot: e.parserSlot,
      sha256: digest,
      bytes: buf.length,
      fetchedAt: same ? prev!.fetchedAt : now,
      ...(e.derivedFrom ? { derivedFrom: e.derivedFrom } : {}),
    },
    written: !same,
  };
}

export async function downloadRedmist(s: RaceSession, dir: string, httpIn: HttpClient, opts: DownloadOptions = {}, pacing?: RedmistPacing): Promise<DownloadReport> {
  const http = paced(httpIn, pacing);
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? (() => new Date());
  mkdirSync(dir, { recursive: true });
  const prev = readManifest(dir);
  const p = parseSourceKey(s.sourceKey);
  if (p.site !== "redmist") throw new Error(`Not a RedMist session: ${s.sourceKey}`);
  const { eventId, sessionId } = p;
  const report: DownloadReport = { dir, manifest: newManifest(s, now(), prev), downloaded: [], unchanged: [], failed: [] };

  const intact = prev?.files.every((f) => existsSync(join(dir, f.name)) && sha256(readFileSync(join(dir, f.name))) === f.sha256);
  if (!opts.force && prev && prev.version === s.version && intact) {
    const m = { ...prev, updatedAt: now().toISOString() };
    addManualFiles(dir, m, now());
    writeManifest(dir, m);
    return { ...report, manifest: m, unchanged: prev.files.map((f) => f.name) };
  }

  const lapsDoc = await http.getJson<RmLapsDoc>(redmistUrls.laps(eventId, sessionId));
  if (!lapsDoc || !Array.isArray(lapsDoc.laps) || lapsDoc.laps.length === 0) throw new Error(`RedMist ${eventId}/${sessionId}: no lap data`);
  log(`  laps: ${lapsDoc.laps.length} rows`);
  const optional = async <T>(what: string, url: string): Promise<T | null> => {
    try {
      return await http.getJson<T>(url);
    } catch (e) {
      report.failed.push({ name: what, error: (e as Error).message });
      return null;
    }
  };
  const wantPits = s.ids?.pitReport !== false;
  const pits = wantPits ? await optional<RmPitsDoc>("pit report", redmistUrls.pits(eventId, sessionId)) : null;
  const results = await optional<RmResults>("results", redmistUrls.results(eventId, sessionId));
  const flags = await optional<RmFlag[]>("flags", redmistUrls.flags(eventId, sessionId));
  const control = await optional<RmControlEntry[]>("control log", redmistUrls.control(eventId, sessionId));
  const pitsOk = pits && Array.isArray(pits.pitStops) && pits.pitStops.length > 0 ? pits : null;

  const m = newManifest(s, now(), prev);
  const clock = sessionClock(lapsDoc.laps, results, Array.isArray(flags) ? flags : null, s.raceDate);
  const date = redmistRaceDate(Array.isArray(flags) ? flags : null, clock);
  if (date && date !== m.metadata.raceDate) {
    m.warnings.push(`Race date ${date} from the RedMist flags (the session list says ${m.metadata.raceDate}).`);
    m.metadata.raceDate = date;
    m.metadata.season = Number(date.slice(0, 4));
  }
  if (!clock) m.warnings.push("No race-clock start in the results or flags: the all-laps CSV has no Time of Day.");
  else if (/estimate/.test(clock.source)) m.warnings.push(`Race-clock start estimated (${clock.source}); Time of Day may be off by a few seconds.`);
  if (lapsDoc.truncated) m.warnings.push("RedMist marked the lap export as truncated.");

  const ts = now().toISOString();
  const prevBy = new Map((prev?.files ?? []).map((f) => [f.name, f]));
  const base = `redmist_${eventId}_${sessionId}`;
  const raw: { kind: string; data: unknown; url: string; role: FileRole; key: string }[] = [
    { kind: "laps", data: lapsDoc, url: redmistUrls.laps(eventId, sessionId), role: "laps", key: "redmistLapsJson" },
    ...(pitsOk ? [{ kind: "pits", data: pitsOk, url: redmistUrls.pits(eventId, sessionId), role: "pit_cards_json" as FileRole, key: "redmistPitsJson" }] : []),
    ...(results ? [{ kind: "results", data: results, url: redmistUrls.results(eventId, sessionId), role: "results" as FileRole, key: "redmistResultsJson" }] : []),
    ...(Array.isArray(flags) ? [{ kind: "flags", data: flags, url: redmistUrls.flags(eventId, sessionId), role: "flags" as FileRole, key: "redmistFlagsJson" }] : []),
    ...(Array.isArray(control) ? [{ kind: "control", data: control, url: redmistUrls.control(eventId, sessionId), role: "control_log" as FileRole, key: "redmistControlJson" }] : []),
  ];
  const cars = carsFromResults(results, lapsDoc.laps);
  const name = (k: string) => `${base}_${k}`;
  const outputs: { name: string; content: string; url: string; role: FileRole; key: string; parserSlot: boolean; derivedFrom?: string[] }[] = [
    { name: name("summary.csv"), content: buildRedmistSummaryCsv(cars), url: redmistUrls.results(eventId, sessionId), role: "summary", key: "summaryCsv", parserSlot: true, derivedFrom: [name("results.json"), name("laps.json")].filter((n) => raw.some((r) => name(`${r.kind}.json`) === n)) },
    { name: name("all_laps.csv"), content: buildRedmistAllLapsCsv(lapsDoc.laps, cars, clock, pitsOk), url: redmistUrls.laps(eventId, sessionId), role: "laps", key: "lapsCsv", parserSlot: true, derivedFrom: raw.filter((r) => r.kind !== "control" && r.kind !== "flags").map((r) => name(`${r.kind}.json`)) },
    ...(Array.isArray(flags) ? [{ name: name("flags.csv"), content: buildRedmistFlagsCsv(flags), url: redmistUrls.flags(eventId, sessionId), role: "flags" as FileRole, key: "flagsCsv", parserSlot: true, derivedFrom: [name("flags.json")] }] : []),
    ...(Array.isArray(control) ? [{ name: name("control.csv"), content: buildRedmistControlCsv(control), url: redmistUrls.control(eventId, sessionId), role: "control_log" as FileRole, key: "controlLogCsv", parserSlot: true, derivedFrom: [name("control.json")] }] : []),
    ...raw.map((r) => ({ name: name(`${r.kind}.json`), content: JSON.stringify(r.data), url: r.url, role: r.role, key: r.key, parserSlot: false })),
  ];
  for (const o of outputs) {
    const { entry, written } = put(dir, o.name, o.content, o, prevBy.get(o.name), ts);
    m.files.push(entry);
    (written ? report.downloaded : report.unchanged).push(o.name);
  }
  for (const f of prev?.files ?? []) if (f.manual && existsSync(join(dir, f.name)) && !m.files.some((x) => x.name === f.name)) m.files.push(f);
  addManualFiles(dir, m, now());
  if (!pitsOk) {
    m.missing.push({
      role: "pit_cards_json",
      note: "No Flagtronics pit report for this session: pit stops come from RedMist's pit-lane lap flags (no pit-in / pit-out times).",
    });
  }
  for (const f of report.failed) m.warnings.push(`Could not fetch the ${f.name}: ${f.error}`);
  writeManifest(dir, m);
  return { ...report, manifest: m };
}

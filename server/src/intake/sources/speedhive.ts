/**
 * WRL via the Speedhive event-results API.
 *
 * Discovery lists the WRL organisation's events (organisation id from
 * `--org` or SPEEDHIVE_WRL_ORG_ID; `intake speedhive-org --from-session <id>`
 * finds it from any known WRL session) and keeps race sessions. A single
 * event or session URL also works without the organisation id.
 *
 * Download fetches the session, its event, the classification and every
 * participant's laps (by finish position, paginated), keeps the raw JSON, and
 * writes the summary and all-laps CSVs in the format the parsers read.
 *
 * The Redmist flags CSV and race-control log are not on Speedhive. The owner
 * may drop those exports into the work folder before `push`; they are picked
 * up by header. Without them the server gives the legacy parser empty
 * placeholders and FCY is reconstructed from the per-lap Status column.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HttpClient } from "../http.js";
import { addManualFiles, newManifest, readManifest, writeManifest } from "../manifest.js";
import { safeFileName, sha256 } from "../names.js";
import {
  SPEEDHIVE_API,
  buildAllLapsCsv,
  buildSpeedhiveSession,
  buildSummaryCsv,
  eventsFromOrgResponse,
  firstLapDate,
  isoDatePart,
  sessionsFromEventResponse,
  type ShClassRow,
  type ShEvent,
  type ShLap,
  type ShParticipantLaps,
  type ShSession,
} from "../parse-speedhive.js";
import { parseSourceKey, parseSpeedhiveRef } from "../source-key.js";
import type { DiscoverOptions, DownloadOptions, DownloadReport, FileRole, ManifestFile, RaceSession } from "../types.js";

const PAGE = 500;

async function getEvent(http: HttpClient, id: number): Promise<ShEvent | null> {
  return http.getJson<ShEvent>(`${SPEEDHIVE_API}/events/${id}?sessions=true`);
}

async function eventSessions(http: HttpClient, ev: ShEvent): Promise<ShSession[]> {
  let sessions = sessionsFromEventResponse(ev);
  if (sessions.length === 0) {
    const alt = await http.getJson(`${SPEEDHIVE_API}/events/${ev.id}/sessions`);
    sessions = sessionsFromEventResponse(alt);
  }
  return sessions;
}

/** Organisation of the event a session belongs to (to find the WRL organisation id). */
export async function speedhiveOrgFromSession(http: HttpClient, ref: string): Promise<{ id: number | null; name: string | null; eventId: number; eventName: string | null }> {
  const r = parseSpeedhiveRef(ref);
  let eventId = r.id;
  if (r.kind === "session") {
    const s = await http.getJson<ShSession>(`${SPEEDHIVE_API}/sessions/${r.id}`);
    if (!s?.eventId) throw new Error(`Speedhive session ${r.id}: no eventId`);
    eventId = Number(s.eventId);
  }
  const ev = await http.getJson<ShEvent>(`${SPEEDHIVE_API}/events/${eventId}`);
  if (!ev) throw new Error(`Speedhive event ${eventId} not found`);
  return { id: ev.organization?.id ?? null, name: ev.organization?.name ?? null, eventId, eventName: ev.name ?? null };
}

function keep(rs: RaceSession | null, opts: DiscoverOptions): rs is RaceSession {
  if (!rs) return false;
  if (!opts.allSessions && rs.sessionType !== "race") return false;
  if (rs.season !== opts.season) return false;
  return !opts.since || rs.raceDate >= opts.since;
}

/** Sessions of one event (by URL or id). */
export async function discoverSpeedhiveEvent(http: HttpClient, ref: string, opts: DiscoverOptions): Promise<RaceSession[]> {
  const r = parseSpeedhiveRef(ref);
  if (r.kind === "session") return [await resolveSpeedhive(http, `speedhive:session:${r.id}`)];
  const ev = await getEvent(http, r.id);
  if (!ev) throw new Error(`Speedhive event ${r.id} not found`);
  // An explicitly named event is taken whatever its season.
  return (await eventSessions(http, ev))
    .map((s) => buildSpeedhiveSession(ev, s))
    .filter((x): x is RaceSession => !!x && keep(x, { ...opts, season: x.season }));
}

export async function discoverSpeedhive(http: HttpClient, orgId: number, opts: DiscoverOptions): Promise<RaceSession[]> {
  const log = opts.log ?? (() => undefined);
  const events: ShEvent[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = eventsFromOrgResponse(await http.getJson(`${SPEEDHIVE_API}/organizations/${orgId}/events?count=100&offset=${offset}`));
    events.push(...page);
    if (page.length < 100) break;
  }
  const inSeason = events.filter((e) => {
    const d = isoDatePart(e.startDate);
    if (!d) return true;
    const y = Number(d.slice(0, 4));
    // Multi-day events can start the day before the race; keep a one-day margin for --since.
    return y === opts.season && (!opts.since || d >= shiftDate(opts.since, -3));
  });
  log(`Speedhive: ${events.length} events for organisation ${orgId}, ${inSeason.length} in ${opts.season}`);
  const out: RaceSession[] = [];
  for (const e of inSeason) {
    const ev = (await getEvent(http, e.id)) ?? e;
    for (const s of await eventSessions(http, ev)) {
      const rs = buildSpeedhiveSession(ev, s);
      if (keep(rs, opts)) out.push(rs);
    }
  }
  return out;
}

function shiftDate(d: string, days: number): string {
  const t = Date.parse(`${d}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export async function resolveSpeedhive(http: HttpClient, sourceKey: string): Promise<RaceSession> {
  const p = parseSourceKey(sourceKey);
  if (p.site !== "speedhive") throw new Error(`Not a Speedhive source key: ${sourceKey}`);
  const s = await http.getJson<ShSession>(`${SPEEDHIVE_API}/sessions/${p.sessionId}`);
  if (!s) throw new Error(`Speedhive session ${p.sessionId} not found`);
  const ev = s.eventId ? await http.getJson<ShEvent>(`${SPEEDHIVE_API}/events/${s.eventId}`) : null;
  const rs = buildSpeedhiveSession(ev ?? { id: Number(s.eventId ?? 0), name: s.name }, { ...s, id: p.sessionId });
  if (!rs) throw new Error(`Speedhive session ${p.sessionId}: no start date`);
  return rs;
}

async function fetchLaps(http: HttpClient, sessionId: number, position: number): Promise<ShParticipantLaps> {
  const laps: ShLap[] = [];
  let info: ShParticipantLaps["participantInfo"] = null;
  let lapCount = 0;
  for (let offset = 0; ; ) {
    const page = await http.getJson<{ laps?: ShLap[]; lapCount?: number; participantInfo?: ShParticipantLaps["participantInfo"] }>(
      `${SPEEDHIVE_API}/sessions/${sessionId}/lapdata/${position}/laps?count=${PAGE}&offset=${offset}`
    );
    if (!page) return { position, participantInfo: info, laps, missing: laps.length === 0 };
    info = page.participantInfo ?? info;
    lapCount = Number(page.lapCount ?? 0);
    const got = page.laps ?? [];
    laps.push(...got);
    offset += got.length;
    if (got.length === 0 || offset >= lapCount) break;
  }
  return { position, participantInfo: info, lapCount, laps };
}

/** Write a file if its content changed; returns its manifest entry and whether it was written. */
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
      sourceName: e.url.replace(SPEEDHIVE_API, ""),
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

export async function downloadSpeedhive(s: RaceSession, dir: string, http: HttpClient, opts: DownloadOptions = {}): Promise<DownloadReport> {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? (() => new Date());
  mkdirSync(dir, { recursive: true });
  const prev = readManifest(dir);
  const parsed = parseSourceKey(s.sourceKey);
  if (parsed.site !== "speedhive") throw new Error(`Not a Speedhive session: ${s.sourceKey}`);
  const sessionId = parsed.sessionId;
  const report: DownloadReport = { dir, manifest: newManifest(s, now(), prev), downloaded: [], unchanged: [], failed: [] };

  // Unchanged event and every file intact: nothing to fetch beyond discovery's two calls.
  const intact = prev?.files.every((f) => existsSync(join(dir, f.name)) && sha256(readFileSync(join(dir, f.name))) === f.sha256);
  if (!opts.force && prev && prev.version === s.version && intact) {
    const m = { ...prev, updatedAt: now().toISOString() };
    addManualFiles(dir, m, now());
    writeManifest(dir, m);
    return { ...report, manifest: m, unchanged: prev.files.map((f) => f.name) };
  }

  const session = await http.getJson<ShSession>(`${SPEEDHIVE_API}/sessions/${sessionId}`);
  if (!session) throw new Error(`Speedhive session ${sessionId} not found`);
  const event = session.eventId ? await http.getJson<ShEvent>(`${SPEEDHIVE_API}/events/${session.eventId}`) : null;
  const cls = await http.getJson<{ rows?: ShClassRow[] }>(`${SPEEDHIVE_API}/sessions/${sessionId}/classification`);
  const rows = cls?.rows ?? [];
  if (rows.length === 0) throw new Error(`Speedhive session ${sessionId}: empty classification`);
  const laps: ShParticipantLaps[] = [];
  for (const [i, r] of rows.entries()) {
    const pos = Number(r.position ?? i + 1);
    const p = await fetchLaps(http, sessionId, pos);
    laps.push(p);
    log(`  [${i + 1}/${rows.length}] #${String(r.startNumber ?? "?")} P${pos}: ${p.missing ? "no lap data (DNS?)" : `${p.laps.length} laps`}`);
  }
  const ann = await http.getJson(`${SPEEDHIVE_API}/sessions/${sessionId}/announcements`).catch(() => null);

  const m = newManifest(s, now(), prev);
  // D-DATE: the first lap-1 crossing's local date beats the API's session start.
  const lapDate = firstLapDate(laps);
  if (lapDate && lapDate !== m.metadata.raceDate) {
    m.warnings.push(`Race date ${lapDate} from the first lap-1 Time of Day (session start says ${m.metadata.raceDate}).`);
    m.metadata.raceDate = lapDate;
    m.metadata.season = Number(lapDate.slice(0, 4));
  }
  const ts = now().toISOString();
  const prevBy = new Map((prev?.files ?? []).map((f) => [f.name, f]));
  const base = safeFileName(`speedhive_${m.metadata.sessionName}_${sessionId}`).replace(/\s+/g, "_");
  const api = (p: string) => `${SPEEDHIVE_API}${p}`;
  const raw = [
    { name: "sh-session.json", data: session, url: api(`/sessions/${sessionId}`), key: "speedhiveSessionJson" },
    { name: "sh-event.json", data: event, url: api(`/events/${session.eventId ?? ""}`), key: "speedhiveEventJson" },
    { name: "sh-classification.json", data: cls, url: api(`/sessions/${sessionId}/classification`), key: "speedhiveClassificationJson" },
    { name: "sh-lapdata.json", data: laps, url: api(`/sessions/${sessionId}/lapdata/{position}/laps`), key: "speedhiveLapdataJson" },
    ...(ann ? [{ name: "sh-announcements.json", data: ann, url: api(`/sessions/${sessionId}/announcements`), key: "speedhiveAnnouncementsJson" }] : []),
  ].filter((x) => x.data !== null && x.data !== undefined);
  const derived = raw.map((r) => r.name);
  const outputs = [
    { name: `${base}_summary.csv`, content: buildSummaryCsv(rows), url: api(`/sessions/${sessionId}/classification`), role: "summary" as FileRole, key: "summaryCsv", parserSlot: true, derivedFrom: ["sh-classification.json"] },
    { name: `${base}_all_laps.csv`, content: buildAllLapsCsv(rows, laps), url: api(`/sessions/${sessionId}/lapdata/{position}/laps`), role: "laps" as FileRole, key: "lapsCsv", parserSlot: true, derivedFrom: derived },
    ...raw.map((r) => ({ name: r.name, content: JSON.stringify(r.data), url: r.url, role: "other" as FileRole, key: r.key, parserSlot: false })),
  ];
  for (const o of outputs) {
    const { entry, written } = put(dir, o.name, o.content, o, prevBy.get(o.name), ts);
    m.files.push(entry);
    (written ? report.downloaded : report.unchanged).push(o.name);
  }
  for (const f of prev?.files ?? []) if (f.manual && existsSync(join(dir, f.name))) m.files.push(f);
  addManualFiles(dir, m, now());
  for (const role of ["flags", "control_log"] as FileRole[]) {
    if (!m.files.some((f) => f.role === role)) {
      m.missing.push({
        role,
        note:
          role === "flags"
            ? "Redmist flags CSV is not on Speedhive. Optional: export it from Redmist into this folder before push; otherwise FCY is reconstructed from the lap Status column."
            : "Redmist race-control log is not on Speedhive. Optional: export it into this folder before push (penalties, garage context).",
      });
    }
  }
  const missingLaps = laps.filter((p) => p.missing).length;
  if (missingLaps) m.warnings.push(`${missingLaps} participant(s) have no lap data (usually DNS).`);
  writeManifest(dir, m);
  return { ...report, manifest: m };
}

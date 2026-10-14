/**
 * Client side of `POST /api/admin/intake/races`, and the comparison of
 * discovered sessions with the races the site already has.
 *
 * The API token is read by the caller from RACETRACE_API_TOKEN and only ever
 * placed in the Authorization header. Nothing here prints it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resultsStatusRank } from "./file-select.js";
import { sha256 } from "./names.js";
import type { Manifest, RaceSession, ResultsStatus } from "./types.js";

/** Body of POST /api/admin/intake/races (validated by the server with zod). */
export interface IntakePushBody {
  sourceKey: string;
  sourceVersion: string;
  resultsStatus: ResultsStatus;
  /** Legacy parser id. */
  format: string;
  metadata: {
    name: string;
    date: string;
    track: string;
    series: string;
    subSeries?: string;
    season: number;
  };
  /** key → file content. PDFs as data URLs (as the admin upload sends them). */
  files: Record<string, string>;
  /** Manifest summary stored in the audit log. */
  manifest: {
    site: string;
    seriesId: string;
    factFormat: string;
    files: { key: string; name: string; url: string; sha256: string; bytes: number; role: string; mark?: string; manual?: boolean }[];
    missing: { role: string; note: string }[];
  };
  force?: boolean;
  /** Existing race (no source key yet) this session replaces; `intake push --attach`. */
  attachToRaceId?: string;
}

export interface BuildPushOptions {
  /** Include archive-only files (Drive Time, weather, raw API JSON …). Default true. */
  includeArchiveOnly?: boolean;
  /** Skip archive-only files when the body would exceed this many bytes (server JSON limit is 50 MB). */
  maxBytes?: number;
  force?: boolean;
}

export function fileContentForKey(key: string, buf: Buffer): string {
  if (/pdf/i.test(key) || buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return `data:application/pdf;base64,${buf.toString("base64")}`;
  }
  return buf.toString("utf-8").replace(/^\uFEFF/, "");
}

export function buildPushBody(dir: string, m: Manifest, opts: BuildPushOptions = {}): { body: IntakePushBody; skipped: string[] } {
  const includeArchive = opts.includeArchiveOnly ?? true;
  const maxBytes = opts.maxBytes ?? 45 * 1024 * 1024;
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let total = 0;
  // Parser slots first, so the size cap only ever drops archive-only files.
  const ordered = [...m.files].sort((a, b) => Number(b.parserSlot) - Number(a.parserSlot));
  for (const f of ordered) {
    if (files[f.key] !== undefined) {
      skipped.push(`${f.name} (duplicate key ${f.key})`);
      continue;
    }
    if (!f.parserSlot && !includeArchive) {
      skipped.push(`${f.name} (archive-only)`);
      continue;
    }
    const content = fileContentForKey(f.key, readFileSync(join(dir, f.name)));
    if (!f.parserSlot && total + content.length > maxBytes) {
      skipped.push(`${f.name} (size cap)`);
      continue;
    }
    files[f.key] = content;
    total += content.length;
  }
  const meta = m.metadata;
  const body: IntakePushBody = {
    sourceKey: m.sourceKey,
    sourceVersion: pushVersion(m, files),
    resultsStatus: m.resultsStatus,
    format: m.legacyFormat,
    metadata: {
      name: meta.name,
      date: meta.raceDate,
      track: meta.track,
      series: meta.series,
      ...(meta.subSeries ? { subSeries: meta.subSeries } : {}),
      season: meta.season,
    },
    files,
    manifest: {
      site: m.site,
      seriesId: m.seriesId,
      factFormat: m.factFormat,
      files: m.files
        .filter((f) => files[f.key] !== undefined)
        .map((f) => ({
          key: f.key,
          name: f.name,
          url: f.url,
          sha256: f.sha256,
          bytes: f.bytes,
          role: f.role,
          ...(f.mark ? { mark: f.mark } : {}),
          ...(f.manual ? { manual: true } : {}),
        })),
      missing: m.missing,
    },
    ...(opts.force ? { force: true } : {}),
    ...(m.attachToRaceId ? { attachToRaceId: m.attachToRaceId } : {}),
  };
  return { body, skipped };
}

/**
 * Version sent with a push: the site version, plus a hash of any files the
 * owner added by hand ("<site version>+<hash>"), so adding a Redmist export
 * later counts as a change. Discovery compares the part before "+".
 */
export function pushVersion(m: Manifest, sent: Record<string, string>): string {
  const manual = m.files.filter((f) => f.manual && sent[f.key] !== undefined).map((f) => `${f.key}:${f.sha256}`).sort();
  return manual.length ? `${m.version}+${sha256(manual.join("|")).slice(0, 8)}` : m.version;
}

export function siteVersionPart(v: string | null | undefined): string | null {
  return v ? v.split("+")[0] : null;
}

/** One row of GET /api/admin/intake/races. */
export interface KnownRace {
  sourceKey: string;
  sourceVersion: string | null;
  resultsStatus: string | null;
  raceId: string;
  name: string;
  status: string;
  updatedAt: string;
}

export type CompareState = "new" | "changed" | "results-upgrade" | "unchanged";

/** New or changed sessions compared with the site's known races. */
export function compareWithKnown(sessions: RaceSession[], known: KnownRace[]): { session: RaceSession; state: CompareState; known?: KnownRace }[] {
  const byKey = new Map(known.map((k) => [k.sourceKey, k]));
  return sessions.map((s) => {
    const k = byKey.get(s.sourceKey);
    if (!k) return { session: s, state: "new" as const };
    if (resultsStatusRank(s.resultsStatus) > resultsStatusRank(k.resultsStatus)) return { session: s, state: "results-upgrade" as const, known: k };
    if (siteVersionPart(k.sourceVersion) !== s.version) return { session: s, state: "changed" as const, known: k };
    return { session: s, state: "unchanged" as const, known: k };
  });
}

export interface ApiConfig {
  url: string;
  token: string;
}

/** Read RACETRACE_API_URL / RACETRACE_API_TOKEN; null when either is unset. */
export function apiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig | null {
  const url = (env.RACETRACE_API_URL ?? "").trim().replace(/\/+$/, "");
  const token = (env.RACETRACE_API_TOKEN ?? "").trim();
  if (!url || !token) return null;
  return { url: /\/api$/.test(url) ? url : `${url}/api`, token };
}

export async function apiRequest<T>(cfg: ApiConfig, method: "GET" | "POST", path: string, body?: unknown, fetchImpl: typeof fetch = fetch): Promise<{ status: number; data: T }> {
  const res = await fetchImpl(`${cfg.url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, ...(body ? { "Content-Type": "application/json" } : {}), Accept: "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, data: data as T };
}

/** One row of GET /api/admin/intake/races?unkeyed=1: a race imported before source keys. */
export interface UnkeyedRace {
  raceId: string;
  name: string;
  date: string;
  track: string;
  series: string;
  season: number;
  status: string;
}

/** Session date minus race date, in days (site races are often dated on the event's first day). */
const daysAfter = (session: string, race: string) => (Date.parse(`${session}T00:00:00Z`) - Date.parse(`${race}T00:00:00Z`)) / 86400000;

/**
 * Day, length and race number from a session or race name: "Saturday - 8 Hour" → { day: "sat", hours: 8 },
 * "Sunday 7-Hour" → { day: "sun", hours: 7 }, "Pirelli GT4 Race 1" → { race: 1 }.
 */
export function sessionTraits(name: string): { day?: string; hours?: number; race?: number } {
  const n = name.toLowerCase();
  const day = n.match(/\b(fri|sat|sun)(?:day|urday)?\b/)?.[1];
  const hours = n.match(/\b(\d{1,2})\s*-?\s*h(?:ou)?rs?\b/)?.[1];
  const race = n.match(/\brace\s*(\d{1,2})\b/)?.[1];
  return { ...(day ? { day } : {}), ...(hours ? { hours: Number(hours) } : {}), ...(race ? { race: Number(race) } : {}) };
}

/** False when both names state a day, a race length or a race number and they differ (Saturday 8 Hour vs Sunday 7-Hour, Race 1 vs Race 2). */
export function sameSessionTraits(a: string, b: string): boolean {
  const x = sessionTraits(a);
  const y = sessionTraits(b);
  if (x.day && y.day && x.day !== y.day) return false;
  if (x.hours && y.hours && x.hours !== y.hours) return false;
  if (x.race && y.race && x.race !== y.race) return false;
  return true;
}

/**
 * Races on the site without a source key that a new session may be the same
 * race as: same Race.series, a race date from one day after to four days
 * before the session (older uploads are dated on the event's first day), and
 * no conflict in day or race length ("Saturday 8 Hour" never matches
 * "Sunday 7-Hour"). Closest date first. A suggestion: attaching is the
 * owner's call (`push --attach`, or `pull --attach-single-candidates`).
 */
export function attachCandidates(session: Pick<RaceSession, "raceDate" | "sessionName">, raceSeries: string, unkeyed: UnkeyedRace[]): UnkeyedRace[] {
  return unkeyed
    .filter((r) => {
      const d = daysAfter(session.raceDate, r.date);
      return r.series === raceSeries && d >= -1 && d <= 4 && sameSessionTraits(session.sessionName, r.name);
    })
    .sort((a, b) => Math.abs(daysAfter(session.raceDate, a.date)) - Math.abs(daysAfter(session.raceDate, b.date)) || a.name.localeCompare(b.name));
}

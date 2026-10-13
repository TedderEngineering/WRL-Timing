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
  return buf.toString("utf-8").replace(/^﻿/, "");
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

/**
 * Work folders and their manifest.json.
 *
 * A work folder (`intake-work/<sourceKey slug>/`) holds one session's files
 * under their original names, plus `manifest.json` with the URL, sha256, size
 * and fetch time of each. The manifest is the only list `push` and the
 * analysis steps read, so a file left over from an earlier pull (for example
 * the provisional results after the official ones arrived) is ignored.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { selectAlkamelFiles } from "./file-select.js";
import { encodePath } from "./http.js";
import type { HttpClient } from "./http.js";
import { safeFileName, sha256, slugForSourceKey } from "./names.js";
import { seriesById } from "./series.js";
import type {
  DownloadOptions,
  DownloadReport,
  IntakeMetadata,
  Manifest,
  ManifestFile,
  RaceSession,
  RemoteFile,
} from "./types.js";

export const MANIFEST_NAME = "manifest.json";

export function workDirFor(root: string, sourceKey: string): string {
  return resolve(root, slugForSourceKey(sourceKey));
}

export function readManifest(dir: string): Manifest | null {
  const p = join(dir, MANIFEST_NAME);
  if (!existsSync(p)) return null;
  const m = JSON.parse(readFileSync(p, "utf-8")) as Manifest;
  if (m.manifestVersion !== 1) throw new Error(`${p}: unsupported manifestVersion ${String(m.manifestVersion)}`);
  return m;
}

/** Write atomically (temp file + rename) so an interrupted pull never leaves half a manifest. */
export function writeManifest(dir: string, m: Manifest): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${MANIFEST_NAME}.tmp`);
  writeFileSync(tmp, JSON.stringify(m, null, 2) + "\n", "utf-8");
  renameSync(tmp, join(dir, MANIFEST_NAME));
}

/** Race name and Race.* fields for a session. */
export function metadataFor(s: RaceSession): IntakeMetadata {
  const def = seriesById(s.seriesId);
  const prefix = def?.namePrefix ?? s.seriesLabel;
  const name =
    s.site === "speedhive"
      ? `${/\bwrl\b|world racing league/i.test(s.event) ? "" : "WRL "}${s.event} — ${s.sessionName}`
      : `${prefix} ${s.sessionName} — ${s.event}`;
  return {
    name: name.replace(/\s+/g, " ").trim().slice(0, 200),
    raceDate: s.raceDate,
    track: s.track,
    series: def?.raceSeries ?? (s.site === "imsa" ? "IMSA" : s.site === "sro" ? "SRO" : "WRL"),
    ...(def?.subSeries ? { subSeries: def.subSeries } : s.seriesId.endsWith("-other") ? { subSeries: s.seriesLabel } : {}),
    season: s.season,
    event: s.event,
    sessionName: s.sessionName,
    startTime: s.startTime,
    championship: s.championship,
  };
}

export function newManifest(s: RaceSession, now: Date, prev: Manifest | null): Manifest {
  return {
    manifestVersion: 1,
    sourceKey: s.sourceKey,
    site: s.site,
    seriesId: s.seriesId,
    seriesLabel: s.seriesLabel,
    legacyFormat: s.legacyFormat,
    factFormat: s.factFormat,
    metadata: metadataFor(s),
    resultsStatus: s.resultsStatus,
    version: s.version,
    createdAt: prev?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    files: [],
    missing: [],
    warnings: [],
    ...(s.ids ? { ids: s.ids } : {}),
  };
}

/** Pick a local name that does not collide with another selected file. */
function localName(f: RemoteFile, taken: Set<string>): string {
  let n = safeFileName(f.name);
  if (taken.has(n.toLowerCase()) && f.subdir) n = safeFileName(`${f.subdir}__${f.name}`);
  let i = 2;
  const base = n;
  while (taken.has(n.toLowerCase())) {
    const dot = base.lastIndexOf(".");
    n = dot > 0 ? `${base.slice(0, dot)} (${i})${base.slice(dot)}` : `${base} (${i})`;
    i++;
  }
  taken.add(n.toLowerCase());
  return n;
}

/**
 * Download the selected files of an Alkamel session (IMSA, SRO, GR Cup) into
 * `dir`. Idempotent:
 *  - a file whose URL, index date and size match the manifest and whose local
 *    copy still has the recorded sha256 is not requested at all;
 *  - otherwise a conditional GET (If-None-Match / If-Modified-Since) is sent
 *    when the manifest has an ETag or Last-Modified; 304 means unchanged;
 *  - a re-fetched file with the same sha256 is reported unchanged.
 */
export async function downloadAlkamelSession(
  s: RaceSession,
  dir: string,
  http: HttpClient,
  opts: DownloadOptions = {}
): Promise<DownloadReport> {
  if (s.site === "speedhive" || s.legacyFormat === "speedhive" || s.legacyFormat === "wrl-website") {
    throw new Error("downloadAlkamelSession: not an Alkamel session");
  }
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? (() => new Date());
  mkdirSync(dir, { recursive: true });
  const prev = readManifest(dir);
  const m = newManifest(s, now(), prev);
  const sel = selectAlkamelFiles(s.legacyFormat as "imsa" | "sro" | "grcup", s.files);
  m.resultsStatus = sel.resultsStatus;
  m.missing = sel.missing;

  const report: DownloadReport = { dir, manifest: m, downloaded: [], unchanged: [], failed: [] };
  const taken = new Set<string>([MANIFEST_NAME, `${MANIFEST_NAME}.tmp`]);

  for (const sf of sel.files) {
    const old = prev?.files.find((f) => f.url === sf.file.url) ?? null;
    const name = old && !taken.has(old.name.toLowerCase()) ? (taken.add(old.name.toLowerCase()), old.name) : localName(sf.file, taken);
    const path = join(dir, name);
    const localSha = existsSync(path) ? sha256(readFileSync(path)) : null;
    const intact = !!old && localSha === old.sha256;

    const base: Omit<ManifestFile, "sha256" | "bytes" | "fetchedAt"> = {
      name,
      sourceName: sf.file.name,
      url: sf.file.url,
      role: sf.role,
      key: sf.key,
      parserSlot: sf.parserSlot,
      ...(sf.mark ? { mark: sf.mark } : {}),
      ...(sf.file.listedModified ? { listedModified: sf.file.listedModified } : {}),
      ...(sf.file.listedSize ? { listedSize: sf.file.listedSize } : {}),
    };

    if (
      !opts.force &&
      intact &&
      sf.file.listedModified &&
      old!.listedModified === sf.file.listedModified &&
      old!.listedSize === sf.file.listedSize
    ) {
      m.files.push({ ...old!, ...base, sha256: old!.sha256, bytes: old!.bytes, fetchedAt: old!.fetchedAt });
      report.unchanged.push(name);
      continue;
    }

    const headers: Record<string, string> = {};
    if (!opts.force && intact) {
      if (old!.etag) headers["If-None-Match"] = old!.etag;
      if (old!.lastModified) headers["If-Modified-Since"] = old!.lastModified;
    }
    try {
      const res = await http.get(sf.file.url, { headers });
      if (res.status === 304 && intact) {
        m.files.push({ ...old!, ...base, sha256: old!.sha256, bytes: old!.bytes, fetchedAt: old!.fetchedAt });
        report.unchanged.push(name);
        continue;
      }
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      if (res.body.length === 0) throw new Error("empty file");
      if (name.toLowerCase().endsWith(".json")) JSON.parse(res.body.toString("utf-8").replace(/^\uFEFF/, ""));
      const digest = sha256(res.body);
      const entry: ManifestFile = {
        ...base,
        sha256: digest,
        bytes: res.body.length,
        fetchedAt: now().toISOString(),
        ...(res.headers["etag"] ? { etag: res.headers["etag"] } : {}),
        ...(res.headers["last-modified"] ? { lastModified: res.headers["last-modified"] } : {}),
      };
      if (intact && digest === old!.sha256) {
        m.files.push({ ...entry, fetchedAt: old!.fetchedAt });
        report.unchanged.push(name);
      } else {
        writeFileSync(path, res.body);
        m.files.push(entry);
        report.downloaded.push(name);
        log(`  GET ${sf.file.name} (${(res.body.length / 1024).toFixed(0)} KB)`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      report.failed.push({ name: sf.file.name, error: msg });
      m.warnings.push(`Could not fetch ${sf.file.name}: ${msg}`);
    }
  }

  // Files the owner dropped in by hand stay in the manifest (see addManualFiles).
  for (const f of prev?.files ?? []) if (f.manual && existsSync(join(dir, f.name))) m.files.push(f);
  if (m.resultsStatus === "provisional") m.warnings.push("Results are provisional; rerun when official results are published.");
  writeManifest(dir, m);
  return report;
}

/** Site URL for an Alkamel results path ("Results/26_2026/…/file.CSV"). */
export function alkamelUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${encodePath(path.replace(/^\/+/, ""))}`;
}

/**
 * Header signatures of files the owner may add by hand (Redmist exports for
 * WRL: the flags CSV and the race-control log). Matching
 * client/src/lib/file-classifier.ts.
 */
const MANUAL_SIGNATURES: { role: "flags" | "control_log"; key: string; headers: string[] }[] = [
  { role: "flags", key: "flagsCsv", headers: ["flag", "start", "end"] },
  { role: "control_log", key: "controlLogCsv", headers: ["timestamp", "description"] },
];

/**
 * Add CSV files the owner placed in the folder by hand (not in the manifest)
 * whose header matches a known optional input. Returns the names added.
 */
export function addManualFiles(dir: string, m: Manifest, now: Date): string[] {
  const known = new Set(m.files.map((f) => f.name.toLowerCase()));
  const added: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".csv") || known.has(name.toLowerCase())) continue;
    const buf = readFileSync(join(dir, name));
    const header = buf.toString("utf-8").replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0].toLowerCase();
    const cols = header.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const sig = MANUAL_SIGNATURES.find((s) => s.headers.every((h) => cols.includes(h)));
    if (!sig || m.files.some((f) => f.key === sig.key)) continue;
    m.files.push({
      name,
      sourceName: name,
      url: "manual",
      role: sig.role,
      key: sig.key,
      parserSlot: m.legacyFormat === "speedhive" || m.legacyFormat === "wrl-website",
      sha256: sha256(buf),
      bytes: buf.length,
      fetchedAt: now.toISOString(),
      manual: true,
    });
    m.missing = m.missing.filter((x) => x.role !== sig.role);
    added.push(name);
  }
  return added;
}

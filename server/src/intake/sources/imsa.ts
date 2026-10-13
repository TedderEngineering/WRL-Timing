/**
 * IMSA results site (imsa.results.alkamelcloud.com): an Apache directory
 * index at /Results/<NN_YYYY>/<NN_Event>/<NN_Championship>/<YYYYMMDDHHMM_Session>/<files>.
 * Endurance races add "<NN>_Hour <N>" sub-folders with cumulative files.
 *
 * Reuses the knowledge of server/scripts/imsa-download.ts (championship
 * names, wanted files) and stage2/intake/imsa_downloader.py (directory crawl,
 * last-hour rule).
 */
import { parseApacheIndex, type IndexEntry } from "../parse-alkamel.js";
import { encodePath, type HttpClient } from "../http.js";
import { downloadAlkamelSession } from "../manifest.js";
import { seriesForChampionship, type SeriesSelection } from "../series.js";
import { classifySession } from "../series.js";
import { imsaSourceKey, parseSessionFolder, parseSourceKey, seasonYear } from "../source-key.js";
import type { DiscoverOptions, DownloadOptions, DownloadReport, RaceSession, RemoteFile } from "../types.js";
import { buildAlkamelSession, onOrAfter } from "./alkamel-common.js";
import { hourOfSubdir } from "../file-select.js";

export const IMSA_BASE = process.env.INTAKE_IMSA_BASE || "https://imsa.results.alkamelcloud.com";

function dirUrl(segments: string[]): string {
  return `${IMSA_BASE}/${encodePath(["Results", ...segments].join("/"))}/`;
}

async function listDir(http: HttpClient, segments: string[]): Promise<IndexEntry[]> {
  const res = await http.get(dirUrl(segments));
  if (res.status === 404 || res.status === 403) return [];
  if (res.status !== 200) throw new Error(`HTTP ${res.status} listing ${dirUrl(segments)}`);
  return parseApacheIndex(res.body.toString("utf-8"));
}

/**
 * Files of one session folder: files at its root, files in non-hour
 * sub-folders, and files in the last "Hour N" folder only.
 */
export async function listSessionFiles(http: HttpClient, segments: string[]): Promise<RemoteFile[]> {
  const entries = await listDir(http, segments);
  return collectSessionFiles(entries, async (sub) => listDir(http, [...segments, sub]), segments);
}

/** Pure part of listSessionFiles, given a lister for sub-folders. */
export async function collectSessionFiles(
  entries: IndexEntry[],
  listSub: (sub: string) => Promise<IndexEntry[]>,
  segments: string[]
): Promise<RemoteFile[]> {
  const toFile = (e: IndexEntry, subdir?: string): RemoteFile => ({
    url: `${IMSA_BASE}/${encodePath(["Results", ...segments, ...(subdir ? [subdir] : []), e.name].join("/"))}`,
    name: e.name,
    ...(subdir ? { subdir } : {}),
    ...(e.modified ? { listedModified: e.modified } : {}),
    ...(e.size ? { listedSize: e.size } : {}),
  });
  const files: RemoteFile[] = entries.filter((e) => !e.isDir).map((e) => toFile(e));
  const dirs = entries.filter((e) => e.isDir);
  const hourDirs = dirs.filter((d) => hourOfSubdir(d.name) !== null);
  const lastHour = hourDirs.sort((a, b) => hourOfSubdir(b.name)! - hourOfSubdir(a.name)!)[0];
  for (const d of dirs) {
    if (hourOfSubdir(d.name) !== null && d !== lastHour) continue;
    for (const e of await listSub(d.name)) if (!e.isDir) files.push(toFile(e, d.name));
  }
  return files;
}

export async function discoverImsa(http: HttpClient, sel: SeriesSelection, opts: DiscoverOptions): Promise<RaceSession[]> {
  const log = opts.log ?? (() => undefined);
  const seasons = (await listDir(http, [])).filter((e) => e.isDir && seasonYear(e.name) === opts.season);
  if (seasons.length === 0) {
    log(`IMSA: no season folder for ${opts.season}`);
    return [];
  }
  const season = seasons[0].name;
  const out: RaceSession[] = [];
  const events = (await listDir(http, [season])).filter((e) => e.isDir && /^\d+_/.test(e.name));
  for (const ev of events) {
    const champs = (await listDir(http, [season, ev.name])).filter((e) => e.isDir && /^\d+_/.test(e.name));
    for (const ch of champs) {
      const def = seriesForChampionship(sel, ch.name);
      if (!def) continue;
      const sessions = (await listDir(http, [season, ev.name, ch.name])).filter((e) => e.isDir && /^\d{12}_/.test(e.name));
      for (const s of sessions) {
        const sf = parseSessionFolder(s.name)!;
        if (!opts.allSessions && classifySession(sf.name) !== "race") continue;
        if (!onOrAfter(sf.date, opts.since)) continue;
        log(`IMSA: ${ev.name} / ${ch.name} / ${s.name}`);
        const files = await listSessionFiles(http, [season, ev.name, ch.name, s.name]);
        const rs = buildAlkamelSession({
          site: "imsa",
          sourceKey: imsaSourceKey(season, ev.name, ch.name, s.name),
          def,
          championship: ch.name,
          seasonFolder: season,
          eventFolder: ev.name,
          sessionFolder: s.name,
          files,
        });
        if (rs && files.length > 0) out.push(rs);
      }
    }
  }
  return out;
}

/** Session for a known source key (no discovery crawl). */
export async function resolveImsa(http: HttpClient, sourceKey: string): Promise<RaceSession> {
  const p = parseSourceKey(sourceKey);
  if (p.site !== "imsa") throw new Error(`Not an IMSA source key: ${sourceKey}`);
  const def = seriesForChampionship({ site: "imsa", defs: [], wildcard: true }, p.championship)!;
  const files = await listSessionFiles(http, [p.season, p.event, p.championship, p.sessionFolder]);
  if (files.length === 0) throw new Error(`IMSA: no files at ${dirUrl([p.season, p.event, p.championship, p.sessionFolder])}`);
  const rs = buildAlkamelSession({
    site: "imsa",
    sourceKey: imsaSourceKey(p.season, p.event, p.championship, p.sessionFolder),
    def,
    championship: p.championship,
    seasonFolder: p.season,
    eventFolder: p.event,
    sessionFolder: p.sessionFolder,
    files,
  });
  if (!rs) throw new Error(`IMSA: cannot read session folder "${p.sessionFolder}"`);
  return rs;
}

export function downloadImsa(s: RaceSession, dir: string, http: HttpClient, opts?: DownloadOptions): Promise<DownloadReport> {
  return downloadAlkamelSession(s, dir, http, opts);
}

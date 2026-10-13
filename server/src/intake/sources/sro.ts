/**
 * SRO America results (usac.alkamelna.com/?series=06_SRO): Pirelli GT4
 * America, GR Cup North America, GT World Challenge America, GT America,
 * TC America, McLaren Trophy America.
 *
 * The Results directories return 403, so file links come from the HTML page:
 *   /?series=06_SRO&season=26_2026&evvent=<event>
 * whose links look like
 *   Results/06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610101000_Race 1/23_AnalysisEnduranceWithSections_Race 1.CSV
 *
 * Reuses server/scripts/alkamel-download.ts (dropdown and link parsing) and
 * stage2/intake/sro_downloader.py (file names).
 */
import { groupSroLinks, parseResultLinks, parseSelectOptions } from "../parse-alkamel.js";
import { type HttpClient } from "../http.js";
import { alkamelUrl, downloadAlkamelSession } from "../manifest.js";
import { classifySession, seriesForChampionship, type SeriesSelection } from "../series.js";
import { parseSessionFolder, parseSourceKey, seasonFolder, seasonYear, sroSourceKey } from "../source-key.js";
import type { DiscoverOptions, DownloadOptions, DownloadReport, RaceSession, RemoteFile } from "../types.js";
import { buildAlkamelSession, onOrAfter } from "./alkamel-common.js";

export const SRO_BASE = process.env.INTAKE_SRO_BASE || "https://usac.alkamelna.com";
export const SRO_SITE_SERIES = process.env.INTAKE_SRO_SERIES || "06_SRO";

export function sroPageUrl(siteSeries: string, season?: string, event?: string): string {
  const u = new URL(`${SRO_BASE}/`);
  u.searchParams.set("series", siteSeries);
  if (season !== undefined) u.searchParams.set("season", season);
  if (event !== undefined) u.searchParams.set("evvent", event);
  return u.toString();
}

/** Sessions on one event page, filtered by series selection (null = keep all). */
export function sessionsFromEventPage(html: string, sel: SeriesSelection | null, opts: Pick<DiscoverOptions, "since" | "allSessions">): RaceSession[] {
  const out: RaceSession[] = [];
  for (const g of groupSroLinks(parseResultLinks(html))) {
    const def = seriesForChampionship(sel ?? { site: "sro", defs: [], wildcard: true }, g.subSeries);
    if (!def) continue;
    const sf = parseSessionFolder(g.sessionFolder);
    if (!sf) continue;
    if (!opts.allSessions && classifySession(sf.name) !== "race") continue;
    if (!onOrAfter(sf.date, opts.since)) continue;
    const files: RemoteFile[] = g.files.map((f) => ({
      url: alkamelUrl(SRO_BASE, f.path),
      name: f.name,
      ...(f.subdir ? { subdir: f.subdir } : {}),
    }));
    const rs = buildAlkamelSession({
      site: "sro",
      sourceKey: sroSourceKey(g.siteSeries, g.season, g.event, g.subSeries, g.sessionFolder),
      def,
      championship: g.subSeries,
      seasonFolder: g.season,
      eventFolder: g.event,
      sessionFolder: g.sessionFolder,
      files,
    });
    if (rs) out.push(rs);
  }
  return out;
}

export async function discoverSro(http: HttpClient, sel: SeriesSelection, opts: DiscoverOptions): Promise<RaceSession[]> {
  const log = opts.log ?? (() => undefined);
  const first = await http.getText(sroPageUrl(SRO_SITE_SERIES));
  const seasons = parseSelectOptions(first, "season");
  const season = seasons.find((o) => seasonYear(o.value) === opts.season)?.value ?? seasonFolder(opts.season);
  const seasonHtml = await http.getText(sroPageUrl(SRO_SITE_SERIES, season, ""));
  const events = parseSelectOptions(seasonHtml, "evvent").filter((o) => o.value);
  if (events.length === 0) log(`SRO: no events listed for ${season}`);
  const out: RaceSession[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    log(`SRO: ${ev.label || ev.value}`);
    const html = await http.getText(sroPageUrl(SRO_SITE_SERIES, season, ev.value));
    for (const s of sessionsFromEventPage(html, sel, opts)) {
      if (seen.has(s.sourceKey)) continue;
      seen.add(s.sourceKey);
      out.push(s);
    }
  }
  return out;
}

export async function resolveSro(http: HttpClient, sourceKey: string): Promise<RaceSession> {
  const p = parseSourceKey(sourceKey);
  if (p.site !== "sro") throw new Error(`Not an SRO source key: ${sourceKey}`);
  const html = await http.getText(sroPageUrl(p.siteSeries, p.season, p.event));
  const want = sroSourceKey(p.siteSeries, p.season, p.event, p.subSeries, p.sessionFolder);
  const s = sessionsFromEventPage(html, null, { allSessions: true }).find((x) => x.sourceKey === want);
  if (!s) throw new Error(`SRO: session not listed on ${sroPageUrl(p.siteSeries, p.season, p.event)}: ${want}`);
  return s;
}

export function downloadSro(s: RaceSession, dir: string, http: HttpClient, opts?: DownloadOptions): Promise<DownloadReport> {
  return downloadAlkamelSession(s, dir, http, opts);
}

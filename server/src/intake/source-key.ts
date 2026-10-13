/**
 * Stable race identity (`Race.sourceKey`).
 *
 * A source key names one race session on one timing site, so reruns of the
 * intake update the same race instead of creating a duplicate:
 *
 *   imsa:<season>/<event>/<championship>/<session folder>
 *     imsa:26_2026/21_Road Atlanta/02_IMSA Michelin Pilot Challenge/202610021140_Race
 *   sro:<site series>/<season>/<event>/<sub-series>/<session folder>
 *     sro:06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610101000_Race 1
 *   speedhive:session:<session id>
 *     speedhive:session:11748965
 *
 * The Alkamel keys are the site's own folder names, decoded and whitespace-
 * normalised, so the same session gives the same key whether it was found in a
 * directory index, an event page link, or typed by hand. Files inside the
 * session (results going from provisional to official, an added Drive Time
 * file) never change the key: they change the session's `version`.
 */
import { safeDecode } from "./http.js";
import type { SiteId } from "./types.js";

export const SOURCE_KEY_PATTERN = /^(imsa|sro):[^/\s][^\n]{0,400}$|^speedhive:session:\d{1,12}$/;

export function normalizeSegment(seg: string): string {
  const s = safeDecode(seg).normalize("NFC").replace(/\s+/g, " ").trim();
  if (!s || s === "." || s === "..") throw new Error(`Empty or relative path segment in source key: "${seg}"`);
  if (s.includes("/")) throw new Error(`Path segment contains "/": "${seg}"`);
  return s;
}

export function imsaSourceKey(season: string, event: string, championship: string, sessionFolder: string): string {
  return `imsa:${[season, event, championship, sessionFolder].map(normalizeSegment).join("/")}`;
}

export function sroSourceKey(
  siteSeries: string,
  season: string,
  event: string,
  subSeries: string,
  sessionFolder: string
): string {
  return `sro:${[siteSeries, season, event, subSeries, sessionFolder].map(normalizeSegment).join("/")}`;
}

export function speedhiveSourceKey(sessionId: string | number): string {
  const id = String(sessionId).trim();
  if (!/^\d{1,12}$/.test(id)) throw new Error(`Not a Speedhive session id: "${sessionId}"`);
  return `speedhive:session:${Number(id)}`;
}

export type ParsedSourceKey =
  | { site: "imsa"; season: string; event: string; championship: string; sessionFolder: string }
  | { site: "sro"; siteSeries: string; season: string; event: string; subSeries: string; sessionFolder: string }
  | { site: "speedhive"; sessionId: number };

export function parseSourceKey(key: string): ParsedSourceKey {
  const k = key.trim();
  const colon = k.indexOf(":");
  const site = k.slice(0, colon) as SiteId;
  const rest = k.slice(colon + 1);
  if (site === "speedhive") {
    const m = rest.match(/^session:(\d{1,12})$/);
    if (!m) throw new Error(`Bad Speedhive source key "${key}" (expected speedhive:session:<id>)`);
    return { site, sessionId: Number(m[1]) };
  }
  const segs = rest.split("/").map(normalizeSegment);
  if (site === "imsa") {
    if (segs.length !== 4) throw new Error(`Bad IMSA source key "${key}" (expected 4 path segments)`);
    const [season, event, championship, sessionFolder] = segs;
    return { site, season, event, championship, sessionFolder };
  }
  if (site === "sro") {
    if (segs.length !== 5) throw new Error(`Bad SRO source key "${key}" (expected 5 path segments)`);
    const [siteSeries, season, event, subSeries, sessionFolder] = segs;
    return { site, siteSeries, season, event, subSeries, sessionFolder };
  }
  throw new Error(`Unknown source key site in "${key}" (expected imsa:, sro: or speedhive:)`);
}

/** Re-serialise a key in canonical form (decoding, whitespace). */
export function canonicalSourceKey(key: string): string {
  const p = parseSourceKey(key);
  switch (p.site) {
    case "imsa":
      return imsaSourceKey(p.season, p.event, p.championship, p.sessionFolder);
    case "sro":
      return sroSourceKey(p.siteSeries, p.season, p.event, p.subSeries, p.sessionFolder);
    case "speedhive":
      return speedhiveSourceKey(p.sessionId);
  }
}

/**
 * Speedhive web or API URL → id. Accepts
 * https://speedhive.mylaps.com/sessions/11748965, …/events/3197245,
 * eventresults-api …/sessions/11748965/classification, or a bare number
 * (taken as a session id).
 */
export function parseSpeedhiveRef(ref: string): { kind: "session" | "event"; id: number } {
  const s = ref.trim();
  if (/^\d{1,12}$/.test(s)) return { kind: "session", id: Number(s) };
  const m = s.match(/\/(sessions|events)\/(\d{1,12})(?:[/?#]|$)/i);
  if (!m) throw new Error(`Not a Speedhive session or event URL: "${ref}"`);
  return { kind: m[1].toLowerCase() === "events" ? "event" : "session", id: Number(m[2]) };
}

/** "202610021140_Race 1" → { stamp, name, date "2026-10-02", time "11:40" } */
export function parseSessionFolder(folder: string): { stamp: string; name: string; date: string; time: string } | null {
  const m = folder.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})_(.+)$/);
  if (!m) return null;
  return { stamp: `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`, name: m[6].trim(), date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

/** "26_2026" → 2026 */
export function seasonYear(folder: string): number | null {
  const m = folder.match(/^\d+_(\d{4})$/);
  return m ? Number(m[1]) : null;
}

/** "2026" → "26_2026" (Alkamel season folder). */
export function seasonFolder(year: number): string {
  return `${String(year).slice(-2)}_${year}`;
}

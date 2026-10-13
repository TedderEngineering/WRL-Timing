/**
 * Pure parsing of Alkamel results pages (no network): the IMSA site's Apache
 * directory index, and the SRO America page's dropdowns and result links.
 */
import { decodeEntities, safeDecode } from "./http.js";

export interface IndexEntry {
  /** Decoded name, without a trailing slash. */
  name: string;
  /** href as written in the page. */
  href: string;
  isDir: boolean;
  /** "Last modified" column, normalised to "YYYY-MM-DD HH:MM" when recognised. */
  modified?: string;
  /** "Size" column as shown ("1.2M", "532K", "17"), absent for folders ("-"). */
  size?: string;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function normaliseDate(s: string): string {
  const iso = s.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if (iso) return `${iso[1]} ${iso[2].slice(0, 5)}`;
  const dmy = s.match(/(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}:\d{2})/);
  if (dmy && MONTHS[dmy[2].toLowerCase()]) return `${dmy[3]}-${MONTHS[dmy[2].toLowerCase()]}-${dmy[1]} ${dmy[4]}`;
  return s.trim();
}

/**
 * Parse an Apache "Index of" page. Handles both the <pre> layout and the
 * HTML-table layout (FancyIndexing). Sort links (?C=…), the parent directory
 * and absolute links are skipped. Names come from the href (link text is
 * truncated by Apache for long names).
 */
export function parseApacheIndex(html: string): IndexEntry[] {
  const out: IndexEntry[] = [];
  const seen = new Set<string>();
  const re = /<a\s+[^>]*?href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a\s|<\/tr>|\r?\n|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = decodeEntities(m[1]);
    if (!href || href.startsWith("?") || href.startsWith("/") || href.startsWith("#") || /^[a-z]+:/i.test(href)) continue;
    if (href === "../" || href === "./" || href.startsWith("../")) continue;
    const decoded = safeDecode(href);
    const isDir = decoded.endsWith("/");
    const name = decoded.replace(/\/+$/, "");
    if (!name || name.includes("/") || seen.has(name)) continue;
    seen.add(name);
    const tail = decodeEntities(m[3].replace(/<[^>]*>/g, " ")).replace(/ /g, " ");
    const dm = tail.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?|\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2})/);
    const entry: IndexEntry = { name, href, isDir };
    if (dm) {
      entry.modified = normaliseDate(dm[1]);
      const after = tail.slice((dm.index ?? 0) + dm[1].length);
      const sm = after.match(/^\s*(\d+(?:\.\d+)?[KMGT]?)\b/);
      if (sm && !isDir) entry.size = sm[1];
    }
    out.push(entry);
  }
  return out;
}

export interface SelectOption {
  value: string;
  label: string;
  selected: boolean;
}

/** Options of `<select name="…">` (attribute order, quoting and case tolerated). */
export function parseSelectOptions(html: string, selectName: string): SelectOption[] {
  const selRe = new RegExp(`<select\\b[^>]*\\bname\\s*=\\s*["']?${selectName}["']?[^>]*>([\\s\\S]*?)</select>`, "i");
  const sm = html.match(selRe);
  if (!sm) return [];
  const out: SelectOption[] = [];
  const optRe = /<option\b([^>]*)>([\s\S]*?)(?=<\/option>|<option\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = optRe.exec(sm[1])) !== null) {
    const attrs = m[1];
    const vm = attrs.match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const label = decodeEntities(m[2].replace(/<[^>]*>/g, "")).trim();
    const value = vm ? decodeEntities(vm[1] ?? vm[2] ?? vm[3] ?? "") : label;
    out.push({ value, label, selected: /\bselected\b/i.test(attrs) });
  }
  return out;
}

/**
 * Result-file links on an Alkamel event page, as decoded site-relative paths
 * ("Results/06_SRO/26_2026/…/file.CSV"). Accepts relative, root-relative and
 * absolute hrefs. The Results directories themselves return 403 on the SRO
 * site, so these links are the only way to see what a session offers.
 */
export function parseResultLinks(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let href = decodeEntities(m[1] ?? m[2] ?? "").trim();
    href = href.replace(/^https?:\/\/[^/]+/i, "").replace(/^\.?\/+/, "");
    if (!/^Results\//i.test(href)) continue;
    href = href.split("#")[0].split("?")[0];
    const path = href
      .split("/")
      .map((p) => safeDecode(p.replace(/\+/g, "%20")))
      .join("/");
    if (path.endsWith("/") || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

export interface SroLinkSession {
  siteSeries: string;
  season: string;
  event: string;
  subSeries: string;
  sessionFolder: string;
  files: { path: string; name: string; subdir?: string }[];
}

/**
 * Group SRO result links into sessions. Link layout:
 *   Results/<site series>/<season>/<event>/<sub-series>/<YYYYMMDDHHMM_Session>[/<subdir>…]/<file>
 */
export function groupSroLinks(paths: string[]): SroLinkSession[] {
  const map = new Map<string, SroLinkSession>();
  for (const p of paths) {
    const parts = p.split("/");
    if (parts.length < 7 || parts[0].toLowerCase() !== "results") continue;
    const [, siteSeries, season, event, subSeries, sessionFolder] = parts;
    if (!/^\d{12}_/.test(sessionFolder)) continue;
    const name = parts[parts.length - 1];
    const subdir = parts.length > 7 ? parts.slice(6, -1).join("/") : undefined;
    const k = [siteSeries, season, event, subSeries, sessionFolder].join("/");
    let s = map.get(k);
    if (!s) {
      s = { siteSeries, season, event, subSeries, sessionFolder, files: [] };
      map.set(k, s);
    }
    s.files.push({ path: p, name, ...(subdir ? { subdir } : {}) });
  }
  return [...map.values()];
}

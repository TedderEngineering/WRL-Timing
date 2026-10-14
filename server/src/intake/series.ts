/**
 * Series catalogue: which championships the intake looks for, on which site,
 * and how their races are named and parsed.
 *
 * `--series` on the CLI takes one or more ids, or a site wildcard:
 * `imsa-*` (every IMSA championship on the IMSA results site), `sro-*`
 * (every sub-series on the SRO America page).
 */
import type { FactFormat, LegacyFormat, SiteId } from "./types.js";

export interface SeriesDef {
  id: string;
  site: SiteId;
  label: string;
  /** Matches the championship / sub-series folder name (number prefix stripped). */
  match: RegExp;
  /** Race.series value. */
  raceSeries: string;
  /** Race.subSeries value (IMSA championships). */
  subSeries?: string;
  /** Prefix of the race name, e.g. "Pirelli GT4". */
  namePrefix: string;
  legacyFormat: LegacyFormat;
  factFormat: FactFormat;
}

export const SERIES: SeriesDef[] = [
  // ── IMSA results site (imsa.results.alkamelcloud.com) ───────────────────
  { id: "imsa-mpc", site: "imsa", label: "IMSA Michelin Pilot Challenge", match: /michelin\s+pilot\s+challenge/i, raceSeries: "IMSA", subSeries: "Pilot Challenge", namePrefix: "Michelin Pilot Challenge", legacyFormat: "imsa", factFormat: "alkamel-imsa" },
  { id: "imsa-wtsc", site: "imsa", label: "IMSA WeatherTech SportsCar Championship", match: /weathertech\s+sportsc/i, raceSeries: "IMSA", subSeries: "WeatherTech", namePrefix: "WeatherTech", legacyFormat: "imsa", factFormat: "alkamel-imsa" },
  { id: "imsa-endurance", site: "imsa", label: "IMSA Airbnb Endurance Challenge", match: /airbnb\s+endurance/i, raceSeries: "IMSA", subSeries: "Endurance Challenge", namePrefix: "Endurance Challenge", legacyFormat: "imsa", factFormat: "alkamel-imsa" },
  { id: "imsa-vprc", site: "imsa", label: "IMSA VP Racing SportsCar Challenge", match: /vp\s+racing/i, raceSeries: "IMSA", subSeries: "VP Racing", namePrefix: "VP Racing SportsCar Challenge", legacyFormat: "imsa", factFormat: "alkamel-imsa" },
  { id: "imsa-mx5", site: "imsa", label: "Mazda MX-5 Cup", match: /mx-?5\s+cup/i, raceSeries: "IMSA", subSeries: "MX-5 Cup", namePrefix: "MX-5 Cup", legacyFormat: "imsa", factFormat: "alkamel-imsa" },
  { id: "imsa-pccna", site: "imsa", label: "Porsche Carrera Cup North America", match: /porsche\s+carrera/i, raceSeries: "IMSA", subSeries: "Porsche Carrera Cup", namePrefix: "Porsche Carrera Cup", legacyFormat: "imsa", factFormat: "alkamel-imsa" },
  { id: "imsa-lst", site: "imsa", label: "Lamborghini Super Trofeo North America", match: /lamborghini\s+super\s+trofeo/i, raceSeries: "IMSA", subSeries: "Lamborghini Super Trofeo", namePrefix: "Lamborghini Super Trofeo", legacyFormat: "imsa", factFormat: "alkamel-imsa" },
  { id: "imsa-mustang", site: "imsa", label: "Ford Mustang Challenge", match: /ford\s+mustang/i, raceSeries: "IMSA", subSeries: "Mustang Challenge", namePrefix: "Mustang Challenge", legacyFormat: "imsa", factFormat: "alkamel-imsa" },

  // ── SRO America (usac.alkamelna.com/?series=06_SRO) ─────────────────────
  { id: "sro-gt4", site: "sro", label: "Pirelli GT4 America", match: /pirelli\s+gt4\s+america|^gt4\s+america/i, raceSeries: "SRO", namePrefix: "Pirelli GT4", legacyFormat: "sro", factFormat: "alkamel-sro" },
  { id: "sro-grcup", site: "sro", label: "Toyota GR Cup North America", match: /gr\s+cup/i, raceSeries: "GR_CUP", namePrefix: "GR Cup", legacyFormat: "grcup", factFormat: "alkamel-grcup" },
  { id: "sro-gtwca", site: "sro", label: "GT World Challenge America", match: /gt\s+world\s+challenge/i, raceSeries: "SRO", subSeries: "GT World Challenge America", namePrefix: "GT World Challenge America", legacyFormat: "sro", factFormat: "alkamel-sro" },
  { id: "sro-gta", site: "sro", label: "GT America", match: /^gt\s+america/i, raceSeries: "SRO", subSeries: "GT America", namePrefix: "GT America", legacyFormat: "sro", factFormat: "alkamel-sro" },
  { id: "sro-tca", site: "sro", label: "TC America", match: /tc\s+america/i, raceSeries: "SRO", subSeries: "TC America", namePrefix: "TC America", legacyFormat: "sro", factFormat: "alkamel-sro" },
  { id: "sro-mclaren", site: "sro", label: "McLaren Trophy America", match: /mclaren\s+trophy/i, raceSeries: "SRO", subSeries: "McLaren Trophy America", namePrefix: "McLaren Trophy", legacyFormat: "sro", factFormat: "alkamel-sro" },

  // ── WRL ────────────────────────────────────────────────────────────────
  // RedMist (api.redmist.racing) is the WRL source from 2026: lap data with pit-lane flags, and the
  // Flagtronics pit report (pit-in / pit-out times, in-lap and out-lap) where the event ran it. The
  // chart still goes through the Speedhive-format legacy parser (parse-redmist.ts writes its CSVs).
  { id: "wrl", site: "redmist", label: "World Racing League", match: /.*/, raceSeries: "WRL", namePrefix: "WRL", legacyFormat: "speedhive", factFormat: "redmist" },
  // Speedhive, for races RedMist holds no lap history for (all of 2025).
  { id: "wrl-speedhive", site: "speedhive", label: "World Racing League", match: /.*/, raceSeries: "WRL", namePrefix: "WRL", legacyFormat: "speedhive", factFormat: "speedhive" },
];

/** Fallbacks for championships on a site that no catalogue entry names. */
export function fallbackSeries(site: "imsa" | "sro", rawName: string): SeriesDef {
  const label = rawName.replace(/^\d+_/, "").trim();
  return site === "imsa"
    ? { id: "imsa-other", site, label, match: /.*/, raceSeries: "IMSA", subSeries: label, namePrefix: label, legacyFormat: "imsa", factFormat: "alkamel-imsa" }
    : { id: "sro-other", site, label, match: /.*/, raceSeries: "SRO", subSeries: label, namePrefix: label, legacyFormat: "sro", factFormat: "alkamel-sro" };
}

export interface SeriesSelection {
  site: SiteId;
  /** Specific series; empty with `wildcard` = every championship on the site. */
  defs: SeriesDef[];
  wildcard: boolean;
}

/**
 * Resolve `--series` ids (comma-separated allowed) to per-site selections.
 * Throws on an unknown id, listing the valid ones.
 */
export function resolveSeries(ids: string[]): SeriesSelection[] {
  const bySite = new Map<SiteId, SeriesSelection>();
  const get = (site: SiteId) => {
    let s = bySite.get(site);
    if (!s) {
      s = { site, defs: [], wildcard: false };
      bySite.set(site, s);
    }
    return s;
  };
  for (const raw of ids.flatMap((x) => x.split(",")).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (raw === "imsa-*" || raw === "imsa") get("imsa").wildcard = true;
    else if (raw === "sro-*" || raw === "sro") get("sro").wildcard = true;
    else {
      const def = SERIES.find((s) => s.id === raw);
      if (!def) {
        throw new Error(`Unknown series "${raw}". Valid: ${SERIES.map((s) => s.id).join(", ")}, imsa-*, sro-*`);
      }
      const sel = get(def.site);
      if (!sel.defs.includes(def)) sel.defs.push(def);
    }
  }
  return [...bySite.values()];
}

/** The catalogue entry for a championship folder, if the selection wants it. */
export function seriesForChampionship(sel: SeriesSelection, rawName: string): SeriesDef | null {
  const name = rawName.replace(/^\d+_/, "").trim();
  const known = SERIES.filter((s) => s.site === sel.site).find((s) => s.match.test(name)) ?? null;
  if (sel.defs.length > 0 && known && sel.defs.includes(known)) return known;
  if (sel.wildcard) return known ?? fallbackSeries(sel.site as "imsa" | "sro", rawName);
  return null;
}

export function seriesById(id: string): SeriesDef | undefined {
  return SERIES.find((s) => s.id === id);
}

/** Race | Qualify | Practice | other, from a session name. */
export function classifySession(name: string): "race" | "qualify" | "practice" | "other" {
  const n = name.toLowerCase();
  if (/qualif/.test(n) && !/qualifying\s+race/.test(n)) return "qualify";
  if (/practice|\bfp\d|warm[- ]?up|test/.test(n)) return "practice";
  if (/\brace\b|\bhours?\b|\bhr\b|\d+\s*h\b|enduro|feature|sprint/.test(n)) return "race";
  return "other";
}

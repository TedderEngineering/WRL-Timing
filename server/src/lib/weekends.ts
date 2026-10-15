/**
 * The Events page lists race weekends: every race at one track within a few days, whatever
 * event row or series it was filed under. Older uploads spelled tracks many ways ("COTA",
 * "Circuit of the Americas MC", "SONOMA", "VIRginia…") and created several events for one
 * weekend; grouping here, by a normalised track name and the race dates, shows one card per
 * weekend without rewriting any stored data (GUI spec §9.1).
 */

/** Canonical track names, tried in order against the stored track (and event) name. */
const TRACKS: [RegExp, string][] = [
  [/circu?i?t of the americas|^cota\b/i, "Circuit of the Americas"],
  [/sonoma/i, "Sonoma Raceway"],
  [/virginia international/i, "VIRginia International Raceway"],
  [/eagle'?s canyon/i, "Eagles Canyon Raceway"],
  [/daytona|roar before the 24/i, "Daytona International Speedway"],
  [/thunderhill/i, "Thunderhill Raceway Park"],
  [/st\.?[\s-]*petersburg/i, "St. Petersburg Street Course"],
  [/indianapolis motor speedway/i, "Indianapolis Motor Speedway"],
  [/laguna seca/i, "WeatherTech Raceway Laguna Seca"],
  [/watkins glen/i, "Watkins Glen International"],
  [/road atlanta/i, "Michelin Raceway Road Atlanta"],
  [/road america/i, "Road America"],
  [/mid-?ohio/i, "Mid-Ohio Sports Car Course"],
  [/canadian tire|\bctmp\b|mosport/i, "Canadian Tire Motorsport Park"],
  [/sebring/i, "Sebring International Raceway"],
  [/barber/i, "Barber Motorsports Park"],
  [/high plains/i, "High Plains Raceway"],
  [/utah motorsports|\bumc\b/i, "Utah Motorsports Campus"],
  [/long beach/i, "Long Beach Street Circuit"],
  [/detroit/i, "Detroit Street Course"],
  [/charlotte/i, "Charlotte Motor Speedway"],
  [/arlington/i, "Grand Prix of Arlington"],
];

/** The track's display name; unknown tracks keep their stored name, tidied. */
export function canonicalTrack(name: string): string {
  const s = name.trim();
  for (const [re, canon] of TRACKS) if (re.test(s)) return canon;
  return s.replace(/\s+/g, " ");
}

export function isKnownTrack(name: string): boolean {
  return TRACKS.some(([re]) => re.test(name));
}

/**
 * True when a name is only a track ("Sonoma Raceway", "COTA", "Circuit of the Americas MC"),
 * not an event or race named after one ("WeatherTech Raceway Laguna Seca 120",
 * "Grand Prix of St. Petersburg", "ROAR Before the 24").
 */
export function isJustTrack(name: string): boolean {
  return isKnownTrack(name) && !/\d|grand prix|championship|challenge|classic|hours|petit|battle|roval|annual|endurance|roar/i.test(name);
}

export type Family = "IMSA" | "SRO" | "GR Cup" | "WRL" | "Other";

/** The filter group a race belongs to (by sanctioning body; GR Cup has its own chip). */
export function raceFamilyLabel(series: string, name: string): Family {
  const s = `${series} ${name}`.toLowerCase().replace(/_/g, " ");
  if (/\bgr cup\b|toyota/.test(s)) return "GR Cup";
  if (/\bwrl\b|world racing league/.test(s)) return "WRL";
  if (/\bsro\b|gt4|gtwc|gt world challenge|tc america|mclaren|gt america|igtc/.test(s)) return "SRO";
  if (/imsa|weathertech|pilot challenge|porsche|carrera|mustang|lamborghini|super trofeo|mx-?5|vp racing|vprc|hsr|\blst\b|pccna/.test(s)) return "IMSA";
  return "Other";
}

/** Championship names found anywhere in a series name or a timing-site folder name. */
export const CHAMPIONSHIP_WORDS: [RegExp, string][] = [
  [/weathertech sportscar|^imsa weathertech/i, "WeatherTech"],
  [/pilot challenge|\bmpc\b/i, "Pilot Challenge"],
  [/vp racing|\bvprc\b/i, "VP Racing Challenge"],
  [/mx-?5/i, "MX-5 Cup"],
  [/super trofeo|lamborghini|\blst\b/i, "Super Trofeo"],
  [/carrera cup|\bpccna\b/i, "Carrera Cup"],
  [/mustang/i, "Mustang Challenge"],
  [/\bhsr\b/i, "HSR"],
  [/gt4/i, "GT4 America"],
  [/gt world challenge|\bgtwc\b/i, "GT World Challenge"],
  [/\bgt america\b/i, "GT America"],
  [/\btc america\b/i, "TC America"],
  [/mclaren/i, "McLaren Trophy"],
  [/\bgr cup\b|toyota/i, "GR Cup"],
  [/airbnb endurance/i, "Airbnb Endurance Challenge"],
];

/** The labels themselves, longest first, plus WRL (the standard names start with one). */
const STANDARD_LABELS = [...new Set([...CHAMPIONSHIP_WORDS.map(([, l]) => l), "WRL"])].sort((a, b) => b.length - a.length);

/**
 * The championship from a timing-site source key: its championship folder only, because the
 * event folder can hold a sponsor's name ("WeatherTech Raceway Laguna Seca").
 */
export function championshipFromSourceKey(sourceKey: string | null | undefined): string | null {
  if (!sourceKey) return null;
  const [site, path = ""] = sourceKey.split(/:(.*)/s);
  const parts = decodeURIComponent(path).split("/");
  const folder = site === "imsa" ? parts[2] : site === "sro" ? parts[3] : undefined;
  if (!folder) return null;
  const clean = folder.replace(/^\d+_/, "").replace(/_/g, " ");
  return CHAMPIONSHIP_WORDS.find(([re]) => re.test(clean))?.[1] ?? null;
}

export interface RaceLabel {
  /** "Pilot Challenge", "GR Cup"… or null when nothing says. */
  championship: string | null;
  /** "Race 1", "Saturday 8 Hour", "Fox Factory 120". */
  title: string;
  /** The event name the race was filed under ("Michelin GT Challenge at VIR"), if any. */
  eventName: string | null;
}

/**
 * Splits a stored race name ("IMSA VPRC Race 1 — Michelin GT Challenge at VIR",
 * "Saturday 8-Hour", "GR Cup Race 1 — COTA", "Fox Factory 120") into what the race row shows.
 * The championship comes from the name, else the timing-site folder, else the series field.
 */
export function raceLabel(name: string, series: string, sourceKey?: string | null, track?: string): RaceLabel {
  const [headRaw, ...rest] = name.split(/\s+[—–]\s+/);
  const head = headRaw.trim();
  const tail = rest.join(" — ").trim() || null;
  const eventName = tail && !isJustTrack(tail) ? tail : null;

  // The championship named in the race name, and what is left once it (and its maker or
  // sanctioning prefix) is taken out: "IMSA VPRC Race 1" → "Race 1"; "Porsche Carrera Cup" → "".
  let championship: string | null = null;
  let remainder = head;
  // A name already in the standard form starts with the championship's own label
  // ("GT4 America Race 1", "WRL Saturday 8 Hour"): take it off whole.
  const lower = head.toLowerCase();
  const asLabel = STANDARD_LABELS.find((l) => lower === l.toLowerCase() || lower.startsWith(`${l.toLowerCase()} `));
  const inName = asLabel ? null : CHAMPIONSHIP_WORDS.find(([re]) => re.test(head));
  if (asLabel) {
    championship = asLabel;
    remainder = head.slice(asLabel.length).trim();
  } else if (inName) {
    championship = inName[1];
    remainder = head.replace(new RegExp(inName[0].source, "gi"), " ");
    remainder = remainder.replace(/\b(IMSA|Porsche|Lamborghini|Ford|Mazda|Whelen|Pirelli|Toyota|Challenge|Cup|North America)\b/gi, " ");
    remainder = remainder.replace(/\s+/g, " ").trim();
  }
  championship ??= championshipFromSourceKey(sourceKey) ?? CHAMPIONSHIP_WORDS.find(([re]) => re.test(series.replace(/_/g, " ")))?.[1] ?? null;

  // "Race1" → "Race 1"; "8-Hour" → "8 Hour"; "GP Arlington Race 1" → "Race 1".
  const tidy = (t: string) => {
    let x = t.replace(/\bRace(\d)/i, "Race $1").replace(/(\d)-Hour/i, "$1 Hour").replace(/^IMSA\s+/i, "").trim();
    const m = x.match(/^(.+?)\s+((?:Qualifying\s+)?Race\b.*)$/i);
    // Only this weekend's own track: "CTMP Race 2 Makeup" run at VIR keeps its CTMP.
    if (m && isJustTrack(m[1]) && (!track || canonicalTrack(m[1]) === track)) x = m[2];
    return x;
  };
  let title: string;
  if (asLabel || inName) title = remainder ? tidy(remainder) : eventName ?? "Race";
  else title = tidy(head);
  return { championship, title, eventName };
}

export interface WeekendRaceIn {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  track: string;
  series: string;
  status: string;
  totalCars: number | null;
  maxLap: number | null;
  resultsStatus: string | null;
  hasStory: boolean;
  eventId: string | null;
  eventName: string | null;
  sourceKey?: string | null;
}

export interface WeekendRace {
  id: string;
  eventId: string | null;
  name: string;
  championship: string | null;
  title: string;
  family: Family;
  date: string;
  cars: number | null;
  laps: number | null;
  status: string;
  resultsStatus: string | null;
  hasStory: boolean;
}

export interface Weekend {
  /** Stable key: canonical track + first date. */
  key: string;
  track: string;
  /** The weekend's event name when the races carry one ("28th Annual Motul Petit Le Mans"). */
  title: string | null;
  startDate: string;
  endDate: string;
  season: string;
  families: Family[];
  races: WeekendRace[];
}

/** Races at the same track whose dates are at most this many days apart form one weekend. */
const GAP_DAYS = 3;
const FAMILY_ORDER: Family[] = ["IMSA", "SRO", "GR Cup", "WRL", "Other"];

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000;

export function groupWeekends(races: WeekendRaceIn[]): Weekend[] {
  const byTrack = new Map<string, WeekendRaceIn[]>();
  for (const r of races) {
    // ROAR Before the 24 was filed with the event name as its track.
    const src = isJustTrack(r.track) || !r.eventName || !isKnownTrack(r.eventName) ? r.track : r.eventName;
    const track = canonicalTrack(src);
    const list = byTrack.get(track) ?? [];
    list.push(r);
    byTrack.set(track, list);
  }

  const weekends: Weekend[] = [];
  for (const [track, list] of byTrack) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    let group: WeekendRaceIn[] = [];
    const flush = () => {
      if (group.length) weekends.push(makeWeekend(track, group));
      group = [];
    };
    for (const r of list) {
      if (group.length && dayNum(r.date) - dayNum(group[group.length - 1].date) > GAP_DAYS) flush();
      group.push(r);
    }
    flush();
  }
  return weekends.sort((a, b) => b.startDate.localeCompare(a.startDate) || a.track.localeCompare(b.track));
}

function makeWeekend(track: string, group: WeekendRaceIn[]): Weekend {
  const races: WeekendRace[] = group.map((r) => {
    const label = raceLabel(r.name, r.series, r.sourceKey, track);
    return {
      id: r.id,
      eventId: r.eventId,
      name: r.name,
      championship: label.championship,
      title: label.title,
      family: raceFamilyLabel(r.series, r.name),
      date: r.date,
      cars: r.totalCars,
      laps: r.maxLap,
      status: r.status,
      resultsStatus: r.resultsStatus,
      hasStory: r.hasStory,
    };
  });
  races.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) ||
      (a.championship ?? "").localeCompare(b.championship ?? "") ||
      a.title.localeCompare(b.title, undefined, { numeric: true })
  );

  // Two unnumbered races of one championship ("Pirelli GT4 — Sonoma Raceway" twice): number them by date.
  const bare = new Map<string, WeekendRace[]>();
  for (const r of races) if (r.title === "Race" && r.championship) bare.set(r.championship, [...(bare.get(r.championship) ?? []), r]);
  for (const list of bare.values()) if (list.length > 1) list.forEach((r, i) => (r.title = `Race ${i + 1}`));

  // The weekend's name: the event name most races carry, when it is not just the track.
  const counts = new Map<string, number>();
  for (const r of group) {
    const n = raceLabel(r.name, r.series, r.sourceKey).eventName;
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const title = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const families = FAMILY_ORDER.filter((f) => races.some((r) => r.family === f));
  const startDate = group[0].date;
  return {
    key: `${track}|${startDate}`,
    track,
    title,
    startDate,
    endDate: group[group.length - 1].date,
    season: startDate.slice(0, 4),
    families,
    races,
  };
}

/**
 * One naming standard for every race, now that each race is tied to its timing session.
 *
 *   "<Championship> <Session> — <Event or track>"
 *
 *   GR Cup Race 1 — Circuit of the Americas
 *   VP Racing Challenge Race 1 — Michelin GT Challenge at VIR
 *   Pilot Challenge — Fox Factory 120
 *   WeatherTech — Rolex 24 at Daytona
 *   WRL Sunday 7 Hour — Road America
 *
 * The championship and the session come from the timing site (so a race typed in by hand
 * as "Saturday 7 Hour" becomes the session's "Sunday 7 Hour"). The event title is kept from
 * the race's current name when it has one ("Michelin GT Challenge at VIR", "Fox Factory 120"),
 * because the timing sites name only the track; otherwise the track's canonical name is used.
 */
import { CHAMPIONSHIP_WORDS, canonicalTrack, isJustTrack, raceLabel } from "../lib/weekends.js";

export interface SessionIdentity {
  site: string;
  /** Championship folder or organisation on the site ("02_IMSA Michelin Pilot Challenge"). */
  championship: string;
  sessionName: string;
  track: string;
  raceDate: string;
  season: number;
}

export interface CurrentRace {
  name: string;
  series: string;
  track: string;
  sourceKey: string;
}

/**
 * "Saturday - 8 Hour" / "Saturday 8 hour" / "Saturday 8" / "Barber - Sunday - 7 hour" / "Race1"
 * → "Saturday 8 Hour" / "Sunday 7 Hour" / "Race 1".
 */
export function tidySession(name: string): string {
  return name
    .replace(/\s+-\s+/g, " ")
    // Speedhive puts the track before the day ("Barber Sunday 7 hour"); the name ends with it anyway.
    .replace(/^.*?\b(?=(Thursday|Friday|Saturday|Sunday)\b)/i, "")
    .replace(/(\d)\s*-?\s*hours?\b/gi, (_m, d: string) => `${d} Hour`)
    .replace(/^((?:Thursday|Friday|Saturday|Sunday) \d+)$/i, "$1 Hour")
    .replace(/\bRace(\d)/i, "Race $1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Spelling slips carried in some stored names. */
const TYPOS: [RegExp, string][] = [
  [/\^R/g, "'"], // "O^RReilly" (an apostrophe mangled on upload)
  [/O'RReilly/g, "O'Reilly"],
  [/\bVirgina\b/g, "Virginia"],
  [/\bCircut\b/gi, "Circuit"],
];
export function fixTypos(s: string): string {
  return TYPOS.reduce((t, [re, to]) => t.replace(re, to), s);
}

function championshipOf(s: SessionIdentity, current: CurrentRace): string | null {
  if (s.site === "redmist" || s.site === "speedhive") return "WRL";
  const folder = s.championship.replace(/^\d+_/, "").replace(/_/g, " ");
  return CHAMPIONSHIP_WORDS.find(([re]) => re.test(folder))?.[1] ?? raceLabel(current.name, current.series, current.sourceKey).championship;
}

/** A title the race already carries that names the event or race, not the session or track. */
function eventTitle(current: CurrentRace): string | null {
  const label = raceLabel(current.name, current.series, current.sourceKey);
  if (label.eventName) return label.eventName;
  const t = label.title;
  if (!t || /^(race|qualifying|heat|sprint|feature|saturday|sunday|friday|thursday)\b/i.test(t)) return null;
  if (label.championship && t.toLowerCase() === label.championship.toLowerCase()) return null;
  if (isJustTrack(t)) return null;
  return t;
}

export function standardRaceName(s: SessionIdentity, current: CurrentRace): string {
  const championship = championshipOf(s, current);
  let session = tidySession(s.sessionName);
  // A championship's only race is just "Race": the name says "Pilot Challenge — Fox Factory 120".
  if (/^race$/i.test(session)) session = "";
  const head = [championship, session].filter(Boolean).join(" ") || tidySession(current.name);
  const event = eventTitle(current);
  const tail = event && event.toLowerCase() !== (championship ?? "").toLowerCase() ? event : canonicalTrack(s.track || current.track);
  return fixTypos(`${head} — ${tail}`).replace(/\s+/g, " ").trim().slice(0, 200);
}

export interface IdentityChange {
  raceId: string;
  sourceKey: string;
  from: { name: string; date: string; season: number };
  to: { name: string; date: string; season: number };
}

/** The changes that would bring a race in line with its session; null when it already is. */
export function identityChange(
  race: CurrentRace & { raceId: string; date: string; season: number },
  s: SessionIdentity
): IdentityChange | null {
  const to = { name: standardRaceName(s, race), date: s.raceDate, season: s.season };
  if (to.name === race.name && to.date === race.date && to.season === race.season) return null;
  return { raceId: race.raceId, sourceKey: race.sourceKey, from: { name: race.name, date: race.date, season: race.season }, to };
}

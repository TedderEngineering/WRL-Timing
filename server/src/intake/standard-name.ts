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
  // "O\u0092Reilly": a Windows-1252 apostrophe read as the C1 control U+0092 (shown as "^R"),
  // or any other control character where a quote was meant.
  [/[\u0000-\u001f\u0091\u0092]/g, "'"],
  [/[\u0093\u0094]/g, '"'],
  [/\^R/g, "'"],
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
  return (
    CHAMPIONSHIP_WORDS.find(([re]) => re.test(folder))?.[1] ??
    raceLabel(current.name, current.series, current.sourceKey).championship ??
    // A championship we have no label for: the site's own folder name, better than none.
    (folder.trim() || null)
  );
}

/**
 * The session without what the rest of the name already says: a leading championship
 * ("WRL High Plains 13 Hour"), words the championship ends with ("Indianapolis 8 Hour" +
 * "8 Hour Race"), or the track's own words before the race length ("High Plains 13 Hour").
 */
function sessionPart(session: string, championship: string | null, track: string): string {
  let words = session.split(" ").filter(Boolean);
  const lc = (w: string) => w.toLowerCase();
  if (championship) {
    const cw = championship.split(" ").map(lc);
    if (cw.every((w, i) => lc(words[i] ?? "") === w)) words = words.slice(cw.length);
    // The longest run of words the championship ends with and the session starts with.
    for (let n = Math.min(cw.length, words.length); n > 0; n--) {
      if (cw.slice(-n).every((w, i) => lc(words[i]) === w)) {
        words = words.slice(n);
        break;
      }
    }
  }
  const trackWords = new Set(canonicalTrack(track).split(/\s+/).map(lc));
  let k = 0;
  while (k < words.length && trackWords.has(lc(words[k]))) k++;
  if (k > 0 && /^(\d|race\b|thursday|friday|saturday|sunday)/i.test(words.slice(k).join(" "))) words = words.slice(k);
  return words.join(" ");
}

/** Looks like a championship and session, not an event: "America Race 1", "WRL Saturday 8 Hour". */
const SESSION_LIKE = /^(?:wrl\s+)?(?:\S+\s+){0,2}?(?:(?:qualifying\s+)?race(?:\s*\d+)?|(?:thursday|friday|saturday|sunday)(?:\s+\d+\s*hours?)?)$/i;

/**
 * A title the race already carries that names the event or the race ("Michelin GT Challenge at
 * VIR", "Fox Factory 120"), not its championship, session or track. It must give the same answer
 * for a name this module produced, so running `names` twice changes nothing.
 */
function eventTitle(current: CurrentRace): string | null {
  const label = raceLabel(current.name, current.series, current.sourceKey);
  // With "<head> — <tail>", only the tail can be the event; a bare name ("Fox Factory 120") may be one itself.
  const hasTail = /\s[—–]\s/.test(current.name);
  const t = fixTypos((hasTail ? label.eventName : label.eventName ?? label.title) ?? "").trim();
  if (!t) return null;
  // "Mid-Ohio - Sunday - 7 hour" is a session with the track in front of it.
  if (SESSION_LIKE.test(t) || SESSION_LIKE.test(tidySession(t)) || isJustTrack(t)) return null;
  if (/^(race|qualifying|heat|sprint|feature|saturday|sunday|friday|thursday)\b/i.test(t)) return null;
  const champ = (label.championship ?? "").toLowerCase();
  if (champ && (t.toLowerCase() === champ || t.toLowerCase().startsWith(`${champ} `))) return null;
  if (/^wrl\b/i.test(t)) return null;
  return t;
}

export function standardRaceName(s: SessionIdentity, current: CurrentRace): string {
  const championship = championshipOf(s, current);
  const track = s.track || current.track;
  let session = sessionPart(tidySession(s.sessionName), championship, track);
  // A championship's only race is just "Race": the name says "Pilot Challenge — Fox Factory 120".
  if (/^race$/i.test(session)) session = "";
  const head = [championship, session].filter(Boolean).join(" ") || tidySession(current.name.split(/\s+[—–]\s+/)[0]);
  const event = eventTitle(current);
  const tail = event && event.toLowerCase() !== (championship ?? "").toLowerCase() ? event : canonicalTrack(track);
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

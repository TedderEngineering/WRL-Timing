/**
 * Re-import planning: which timing session is each race already on the site?
 *
 * Races uploaded by hand before the intake have no source key, their series
 * is spelled several ways ("GR CUP", "GR_CUP", "GTWC", a championship name),
 * several championships race on one IMSA weekend, and a few races are on the
 * site twice. Dates alone cannot pair them. The planner pairs a race with a
 * session by the cars that ran: same series family, a session date from two
 * days before to four days after the race's date, the same car numbers and
 * (nearly) the same lap count, and no clash in day, length or race number.
 *
 *   exact      one session matches clearly: safe to re-import in place
 *   unsure     a likely session, but the cars or laps differ, or two sessions fit
 *   duplicate  another race on the site matches the same session better
 *   not-found  no session of the family that weekend has these cars
 *
 * Pure: the CLI supplies the races, the sessions and the sessions' cars.
 */
import { sameSessionTraits } from "./push.js";
import type { RaceSession } from "./types.js";

export type Family = "imsa" | "sro" | "wrl";

/** One race on the site without a source key (GET /admin/intake/races?unkeyed=1&cars=1). */
export interface SiteRace {
  raceId: string;
  name: string;
  date: string;
  track: string;
  series: string;
  subSeries?: string;
  season: number;
  status: string;
  maxLap: number | null;
  totalCars?: number | null;
  cars?: string[];
}

/** The cars that ran in a session and its length, from its parsed lap file. */
export interface SessionPrint {
  cars: string[];
  maxLap: number;
}

export type PlanState = "exact" | "unsure" | "duplicate" | "not-found";

export interface PlanRow {
  raceId: string;
  raceName: string;
  raceDate: string;
  raceSeries: string;
  raceStatus: string;
  state: PlanState;
  sourceKey?: string;
  session?: { seriesId: string; event: string; sessionName: string; date: string };
  carOverlap?: number;
  lapCounts?: [number | null, number];
  note: string;
}

/** Series family of a race on the site, from its series (and sub-series) text. */
export function raceFamily(series: string, subSeries?: string | null): Family | null {
  const s = `${series} ${subSeries ?? ""}`.toLowerCase().replace(/_/g, " ");
  if (/\bwrl\b|world racing league/.test(s)) return "wrl";
  if (/\bsro\b|gt4|gtwc|gt world challenge|gr cup|toyota|tc america|mclaren|gt america|igtc/.test(s)) return "sro";
  if (/imsa|weathertech|pilot challenge|porsche|carrera|mustang|lamborghini|super trofeo|mx-?5|vp racing|hsr/.test(s)) return "imsa";
  return null;
}

export function sessionFamily(s: Pick<RaceSession, "site">): Family {
  return s.site === "imsa" ? "imsa" : s.site === "sro" ? "sro" : "wrl";
}

/** "007" and "7" are one car to the legacy parser; compare numbers the same way. */
export function normCar(c: string): string {
  const t = String(c).trim().toUpperCase();
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

const daysAfter = (session: string, race: string) => (Date.parse(`${session}T00:00:00Z`) - Date.parse(`${race}T00:00:00Z`)) / 86400000;

/** Share of cars in common, against the larger field (so a subset does not score 1). */
export function carOverlap(a: string[], b: string[]): number {
  const A = new Set(a.map(normCar));
  const B = new Set(b.map(normCar));
  if (A.size === 0 || B.size === 0) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.max(A.size, B.size);
}

const lapsClose = (a: number | null, b: number) => a === null || Math.abs(a - b) <= Math.max(2, Math.round(0.05 * Math.max(a, b)));

interface Candidate {
  s: RaceSession;
  overlap: number;
  lapsOk: boolean;
  traitsOk: boolean;
  score: number;
}

/**
 * Of two listings of the same race, the one the intake uses: WRL from RedMist from 2026 and
 * from Speedhive for 2025 (as `discover` does); otherwise the first source key, so reruns agree.
 */
function preferListing(a: RaceSession, b: RaceSession): RaceSession {
  const rank = (s: RaceSession) => (s.site === "redmist" ? (s.season >= 2026 ? 0 : 1) : s.site === "speedhive" ? (s.season >= 2026 ? 1 : 0) : 0);
  return rank(a) !== rank(b) ? (rank(a) < rank(b) ? a : b) : a.sourceKey <= b.sourceKey ? a : b;
}

export function planReimport(races: SiteRace[], sessionsIn: RaceSession[], prints: Map<string, SessionPrint>): PlanRow[] {
  // One candidate per race even when it is listed twice with identical results (and names that
  // do not disagree: two same-day races with one field and one lap count stay apart).
  // Two listings are the same race when they are on the same day, their names don't disagree,
  // and their results agree: 90% of cars in common and close lap counts (two timing sites, or
  // two events on one site, rarely list a race identically).
  const sameRace = (x: RaceSession, y: RaceSession) => {
    const px = prints.get(x.sourceKey);
    const py = prints.get(y.sourceKey);
    return !!px && !!py && x.raceDate === y.raceDate && sameSessionTraits(x.sessionName, y.sessionName) && carOverlap(px.cars, py.cars) >= 0.9 && lapsClose(px.maxLap, py.maxLap);
  };
  const sessions: RaceSession[] = [];
  for (const s of sessionsIn) {
    const i = sessions.findIndex((o) => sameRace(o, s));
    if (i < 0) sessions.push(s);
    else sessions[i] = preferListing(sessions[i], s);
  }

  const rows: PlanRow[] = [];
  const best = new Map<string, Candidate>(); // raceId → its best candidate
  for (const r of races) {
    const fam = raceFamily(r.series, r.subSeries);
    const base: Omit<PlanRow, "state" | "note"> = { raceId: r.raceId, raceName: r.name, raceDate: r.date, raceSeries: r.series, raceStatus: r.status };
    if (!fam) {
      rows.push({ ...base, state: "not-found", note: `Unknown series "${r.series}"` });
      continue;
    }
    const cands: Candidate[] = sessions
      .filter((s) => sessionFamily(s) === fam)
      .filter((s) => {
        const d = daysAfter(s.raceDate, r.date);
        return d >= -2 && d <= 4;
      })
      .map((s) => {
        const p = prints.get(s.sourceKey);
        const overlap = p && r.cars?.length ? carOverlap(r.cars, p.cars) : 0;
        const lapsOk = p ? lapsClose(r.maxLap, p.maxLap) : false;
        const traitsOk = sameSessionTraits(r.name, s.sessionName);
        const d = daysAfter(s.raceDate, r.date);
        // Between equal fields (a sprint weekend's two races), the same lap count and the same
        // date tell them apart.
        const lapsExact = !!p && r.maxLap === p.maxLap;
        const score = overlap - (lapsOk ? 0 : 0.25) - (traitsOk ? 0 : 0.6) - 0.01 * Math.abs(d) + (lapsExact ? 0.1 : 0) + (d === 0 ? 0.05 : 0);
        return { s, overlap, lapsOk, traitsOk, score };
      })
      .sort((a, b) => b.score - a.score);
    const top = cands[0];
    if (!top || top.overlap < 0.5) {
      const near = cands.filter((c) => c.overlap > 0).length;
      rows.push({
        ...base,
        state: "not-found",
        note: !r.cars?.length ? "The race has no car list on the site" : cands.length ? `${cands.length} session(s) that weekend, none with these cars${near ? "" : ""}` : "No session of this series that weekend",
      });
      continue;
    }
    const second = cands[1];
    const clear = !second || top.score - second.score >= 0.15;
    const exact = top.overlap >= 0.9 && top.lapsOk && top.traitsOk && clear;
    const p = prints.get(top.s.sourceKey)!;
    rows.push({
      ...base,
      state: exact ? "exact" : "unsure",
      sourceKey: top.s.sourceKey,
      session: { seriesId: top.s.seriesId, event: top.s.event, sessionName: top.s.sessionName, date: top.s.raceDate },
      carOverlap: Math.round(top.overlap * 100) / 100,
      lapCounts: [r.maxLap, p.maxLap],
      note: exact
        ? "Same cars and laps"
        : [
            top.overlap < 0.9 ? `${Math.round(top.overlap * 100)}% of cars in common` : "",
            !top.lapsOk ? `laps ${r.maxLap ?? "?"} on the site vs ${p.maxLap} at the source` : "",
            !top.traitsOk ? "the names disagree (day, length or race number)" : "",
            !clear ? `also fits ${second!.s.sessionName} (${second!.s.raceDate})` : "",
          ]
            .filter(Boolean)
            .join("; "),
    });
    best.set(r.raceId, top);
  }

  // Two site races on one session: the closer match keeps it, the other is a duplicate.
  const bySession = new Map<string, PlanRow[]>();
  for (const row of rows) if (row.sourceKey && row.state !== "not-found") bySession.set(row.sourceKey, [...(bySession.get(row.sourceKey) ?? []), row]);
  for (const group of bySession.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (best.get(b.raceId)?.score ?? 0) - (best.get(a.raceId)?.score ?? 0) || (a.raceStatus === "PUBLISHED" ? -1 : 1));
    const keeper = group[0];
    for (const dup of group.slice(1)) {
      dup.state = "duplicate";
      dup.note = `Same session as "${keeper.raceName}" (${keeper.raceId}); one of the two can be deleted`;
    }
  }
  const order: Record<PlanState, number> = { exact: 0, unsure: 1, duplicate: 2, "not-found": 3 };
  return rows.sort((a, b) => order[a.state] - order[b.state] || b.raceDate.localeCompare(a.raceDate));
}

/** Sessions worth fetching: those that could be one of the races (same family, the race's weekend). */
export function candidateSessions(races: SiteRace[], sessions: RaceSession[]): RaceSession[] {
  return sessions.filter((s) =>
    races.some((r) => {
      if (raceFamily(r.series, r.subSeries) !== sessionFamily(s)) return false;
      const d = daysAfter(s.raceDate, r.date);
      return d >= -2 && d <= 4;
    })
  );
}

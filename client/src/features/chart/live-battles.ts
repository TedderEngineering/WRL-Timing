/**
 * RaceTrace Live, Strategy: the focus car's battles with the class cars around it, from the live
 * strategy (live-strategy.ts) and each car's pace over its last PACE_LAPS green laps:
 *
 *   PUSH            catching the car ahead, and on its tail before the battle's horizon
 *   PUSH HARDER     catching too slowly (or not), but a pace it has run lately gets there
 *   OUT OF REACH    not this stint at any pace it has run lately
 *   DEFEND          the car behind catches it before the horizon: the pace that keeps it clear
 *   SAFE            the car behind is not catching it before the horizon
 *   PASSES IN PITS  the car ahead owes a stop more: ahead once it stops, no need to fight it
 *   NET RIVAL       the car behind owes a stop fewer: ahead of it after the stops; the pace to beat it
 *   CAUTION         under a caution the field bunches: no targets until the green
 *
 * The horizon is the first of: the focus car's next stop, the rival's, the flag. "On its tail" is
 * within CATCH_S. Every figure is an estimate from this race so far and moves with each lap.
 */
import type { RaceChartData } from "@shared/types";
import { greenPace } from "./live-strategy";
import { PACE_LAPS } from "./live-gaps";
import type { CarStrategy, LiveStrategy } from "./live-strategy";
import { STINT_SLACK } from "./live-strategy";

/** On a car's tail: within this many seconds. */
export const CATCH_S = 1.0;
/** Lately: its fastest laps among this many of its last green laps. */
const RECENT_LAPS = 15;

export type BattleKind = "push" | "push_harder" | "out_of_reach" | "defend" | "safe" | "passes_in_pits" | "net_rival" | "caution";

export interface Battle {
  kind: BattleKind;
  /** The rival (chart key), ahead or behind on the road in class. */
  rival: number;
  side: "ahead" | "behind";
  /** Same team: shown, but marked. */
  teammate: boolean;
  /** Seconds between the two at the line now. */
  gapS: number;
  /** How fast the gap closes (s/lap; + it closes). */
  closingS: number | null;
  /** Laps until on its tail / caught, when that happens before the horizon. */
  inLaps: number | null;
  /** The lap that happens on (the focus car's laps). */
  onLap: number | null;
  /** Laps the battle has, and what ends it. */
  horizon: number;
  until: "your stop" | "its stop" | "the flag";
  /** The lap time to run (s): keep at or under it. */
  targetS: number | null;
  /** Its pace now (s/lap). */
  paceS: number | null;
  /** After both have stopped: seconds the focus car is ahead (+) or behind (−). */
  netS: number | null;
}

type Fcy = Set<number>;
const fcyOf = (data: RaceChartData): Fcy => {
  const s = new Set<number>();
  for (const [a, b] of data.fcy ?? []) for (let l = a; l <= b; l++) s.add(l);
  return s;
};

/** A car's pace over its last PACE_LAPS green laps, and the best it has run lately (its 3 fastest of the last RECENT_LAPS). */
export function recentPace(data: RaceChartData, key: number, fcy = fcyOf(data)): { now: number | null; best: number | null } {
  const laps = data.cars[String(key)]?.laps ?? [];
  const now = greenPace(laps, data, fcy, PACE_LAPS);
  const xs: number[] = [];
  for (let i = laps.length - 1; i > 0 && xs.length < RECENT_LAPS; i--) {
    const l = laps[i];
    if (l.pit === 0 && laps[i - 1].pit === 0 && l.ltSec > 1 && l.ltSec < data.greenPaceCutoff && !fcy.has(l.l)) xs.push(l.ltSec);
  }
  const fast = [...xs].sort((a, b) => a - b).slice(0, 3);
  return { now, best: fast.length === 3 ? fast.reduce((a, b) => a + b, 0) / 3 : null };
}

/** Laps left in a car's stint before it must stop; Infinity when it can reach the flag. */
function stintLeft(c: CarStrategy): number {
  if (c.stopsToGo === 0 || c.stintCap === null) return Infinity;
  return Math.max(0, c.lastStopLap + Math.floor(c.stintCap * (1 + STINT_SLACK)) - c.laps);
}

const squash = (s: string) =>
  s
    .replace(/\s*\([^()]*\)\s*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export function sameTeam(a: string, b: string): boolean {
  const x = squash(a);
  return !!x && x === squash(b);
}

/** The focus car's battles: the class car directly ahead and directly behind on the road. */
export function liveBattles(s: LiveStrategy, data: RaceChartData): Battle[] {
  if (!s.focus) return [];
  const f = s.focus.car;
  if (f.stopped) return [];
  const running = s.cars.filter((c) => !c.stopped);
  const i = running.indexOf(f);
  const neighbours: [CarStrategy, "ahead" | "behind"][] = [];
  if (i > 0) neighbours.push([running[i - 1], "ahead"]);
  if (i >= 0 && i + 1 < running.length) neighbours.push([running[i + 1], "behind"]);
  const fcy = fcyOf(data);
  const fp = recentPace(data, f.num, fcy);
  const out: Battle[] = [];
  for (const [r, side] of neighbours) {
    const rp = recentPace(data, r.num, fcy);
    const gapS = Math.abs(r.gapS - f.gapS);
    const lapsToFlag = s.timeToGoS !== null && fp.now ? s.timeToGoS / fp.now : Infinity;
    const ends: [number, Battle["until"]][] = [
      [stintLeft(f), "your stop"],
      [stintLeft(r), "its stop"],
      [lapsToFlag, "the flag"],
    ];
    const [horizonRaw, until] = ends.reduce((a, b) => (b[0] < a[0] ? b : a));
    const horizon = Number.isFinite(horizonRaw) ? Math.max(0, Math.floor(horizonRaw)) : 0;
    const netS = f.netGapS !== null && r.netGapS !== null ? r.netGapS - f.netGapS : null;
    const base: Battle = {
      kind: "safe",
      rival: r.num,
      side,
      teammate: sameTeam(f.team, r.team),
      gapS,
      closingS: null,
      inLaps: null,
      onLap: null,
      horizon,
      until,
      targetS: null,
      paceS: fp.now,
      netS,
    };
    if (s.caution) {
      out.push({ ...base, kind: "caution" });
      continue;
    }
    if (fp.now === null || rp.now === null) continue;
    const owesF = f.stopsToGo ?? 0;
    const owesR = r.stopsToGo ?? 0;
    if (side === "ahead") {
      // Ahead on the road, but a stop more to make: the focus car is ahead once it stops.
      if (owesR > owesF && netS !== null && netS > 0) {
        out.push({ ...base, kind: "passes_in_pits" });
        continue;
      }
      const closing = rp.now - fp.now;
      const need = gapS - CATCH_S;
      const b = { ...base, closingS: closing };
      if (closing > 0 && need / closing <= horizon) {
        const n = Math.max(1, Math.ceil(need / closing));
        out.push({ ...b, kind: "push", inLaps: n, onLap: f.laps + n, targetS: fp.now });
        continue;
      }
      // The pace that catches it before the horizon, and whether it has run that lately.
      const req = horizon > 0 ? rp.now - need / horizon : null;
      const reach = req !== null && fp.best !== null && req >= fp.best;
      out.push({ ...b, kind: reach ? "push_harder" : "out_of_reach", targetS: reach ? req : null });
      continue;
    }
    // Behind on the road, but a stop fewer to make: ahead of the focus car after the stops.
    if (owesR < owesF && netS !== null && netS < 0) {
      const lapsLeft = Number.isFinite(lapsToFlag) ? lapsToFlag : null;
      const deficit = -netS;
      out.push({ ...base, kind: "net_rival", targetS: lapsLeft ? rp.now - (deficit + CATCH_S) / lapsLeft : null });
      continue;
    }
    const closing = fp.now - rp.now;
    const room = gapS - CATCH_S;
    const b = { ...base, closingS: closing };
    if (closing > 0 && room / closing <= horizon) {
      const n = Math.max(1, Math.floor(Math.max(0, room) / closing));
      out.push({ ...b, kind: "defend", inLaps: n, onLap: f.laps + n, targetS: horizon > 0 ? rp.now + room / horizon : rp.now });
      continue;
    }
    out.push({ ...b, kind: "safe" });
  }
  return out;
}

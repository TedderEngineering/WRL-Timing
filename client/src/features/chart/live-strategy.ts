/**
 * RaceTrace Live: Strategy. From the live chart alone (laps, pit markers, cautions, time to go),
 * for each car of a class:
 *
 *   - stops still to make, from the long stints the class has run so far (fuel and driver time
 *     make a stint, and the cars of a class run near the same length), with STINT_SLACK to spare;
 *   - the order after those stops ("net"), each car's gap to the class leader plus a green stop's
 *     time lost for each stop it still owes, less the leader's;
 *   - a projected finish, the net gaps moved on at each car's green pace to the flag;
 *
 * and for the focus car its pit window (the earliest lap to stop and still make no more stops
 * than now, the last lap its longest stint reaches) and where it rejoins if it stops now, with
 * what a stop under the current caution saves.
 *
 * Every figure is an estimate from this race's own stints and stops; it moves with each update.
 * The times are each car's summed lap times (the chart's own convention, as the Gaps panel).
 */
import type { AnnotationData, RaceChartData } from "@shared/types";
import { isGreenFlag } from "./flags";
import { MIN_PACE_LAPS, PACE_LAPS } from "./live-gaps";
import { LONG_STOP_S } from "./long-stops";

type Lap = RaceChartData["cars"][string]["laps"][number];

/** A stint counts towards the class's stint length when it is at least this share of the longest. */
export const STINT_SHARE = 0.8;
/**
 * A last stint can run this much longer than the class's long stints (the stints so far end where
 * the teams chose to stop, not always at the end of the fuel): back-tested on finished races,
 * without it the cars are given a stop they do not make near the end.
 */
export const STINT_SLACK = 0.15;
/** At least this many such stints in the class before stops to go are estimated. */
export const MIN_STINTS = 3;
/** A stop losing less than this is a pass through the pit lane (no fuel), not a stop. */
export const DRIVE_THROUGH_S = 45;
/** Without a stop under caution yet, one is taken to lose this share of a green stop. */
export const CAUTION_SHARE = 0.35;
/** Pace for the projection: the median of the car's last this many green laps (steadier than the last few). */
export const PROJECTION_LAPS = 10;
/** A caution stop is measured against the laps other cars finished within this many seconds of its own. */
const CAUTION_REF_S = 45;
/** A car this many paces past the latest crossing has stopped (or is in the garage). */
const STOPPED_PACES = 3;

export const CAUTION_FLAGS = new Set(["Yellow", "Code 35", "Code 60", "Red"]);

export interface Stop {
  lap: number;
  /** Time lost against green pace (s), when the timing measured it. */
  lostS: number | null;
  caution: boolean;
  kind: "stop" | "garage" | "drive_through";
}

export interface CarStrategy {
  num: number;
  cls: string;
  team: string;
  posClass: number;
  laps: number;
  /** Green pace (s/lap) over its last laps; null without enough green laps. */
  pace: number | null;
  stops: Stop[];
  /** The in-lap of its last stop (0 before the first). */
  lastStopLap: number;
  /** Laps since its last stop (the stint it is on). */
  stintLaps: number;
  /** Its longest stint between stops so far (laps), not counting the one it is on. */
  longestStint: number;
  /** Laps its stint can run (the class's, or its own longest when longer). Null before the class has run enough stints. */
  stintCap: number | null;
  /** Stops still needed to reach the flag; null when the stint length or pace is not known yet. */
  stopsToGo: number | null;
  /** Seconds behind the class leader at the line now. */
  gapS: number;
  /** Behind the leader once both have made the stops they owe (green stops). */
  netGapS: number | null;
  netPos: number | null;
  /** Behind the leader at the flag, at today's paces. */
  projGapS: number | null;
  projPos: number | null;
  /** Not crossing the line any more (stopped, or a long stay in the garage). */
  stopped: boolean;
}

export interface PitWindow {
  /** The earliest lap it can stop and still need no more stops than now. */
  from: number;
  /** The last lap its longest stint reaches from its last stop. */
  to: number;
  /** Stops still needed, this one included. */
  stopsToGo: number;
}

export interface PitNow {
  /** A stop now under the current flag: time lost (s). */
  lostS: number;
  caution: boolean;
  /** What it saves against a green stop (s); only under a caution. */
  savesS: number | null;
  /** Class position it rejoins in (the cars on track keep going). */
  rejoinPos: number;
  /** Measured from this race's stops, or taken as a share of a green stop. */
  measured: boolean;
}

export interface LiveStrategy {
  cls: string;
  cars: CarStrategy[];
  /** Time lost to a green stop / a stop under caution in this race (s); null before one is measured. */
  greenStopS: number | null;
  cautionStopS: number | null;
  cautionMeasured: boolean;
  /** The class's stint length (laps); null before it has run MIN_STINTS long stints. */
  stintLength: number | null;
  timeToGoS: number | null;
  caution: boolean;
  focus: { car: CarStrategy; window: PitWindow | null; pitNow: PitNow | null } | null;
}

export interface LiveStrategyInput {
  data: RaceChartData;
  annotations: AnnotationData | null;
  focusNum: number;
  flag: string | null;
  /** Race time still to run (s); null when the timing does not say. */
  timeToGoS: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function fcySet(data: RaceChartData): Set<number> {
  const s = new Set<number>();
  for (const [a, b] of data.fcy ?? []) for (let l = a; l <= b; l++) s.add(l);
  return s;
}

/** The car's stops: from the pit markers (as the Position Trace); a pit-lane start on lap 1 is not one. */
export function stopsOf(data: RaceChartData, annotations: AnnotationData | null, key: string, clock = raceClock(data)): Stop[] {
  const laps = data.cars[key]?.laps ?? [];
  const fcy = fcySet(data);
  const caution = (l: number) => {
    const lap = laps.find((x) => x.l === l);
    return fcy.has(l) || (!!lap?.flag && !isGreenFlag(lap.flag));
  };
  const marks = (annotations?.[key]?.pits ?? []).filter((p) => p.kind !== "retirement" && p.l > 1);
  if (marks.length) {
    return marks
      .map((m): Stop => {
        const lost = typeof m.pitTiming?.totalPitLoss === "number" ? m.pitTiming.totalPitLoss : null;
        const ctx = m.pitTiming?.context;
        const kind: Stop["kind"] =
          m.kind === "garage" || m.isGarage || (lost !== null && lost >= LONG_STOP_S)
            ? "garage"
            : m.kind === "drive_through" || m.pitTiming?.isDriveThrough || (lost !== null && lost < DRIVE_THROUGH_S)
              ? "drive_through"
              : "stop";
        const under = ctx ? ctx !== "green" : caution(m.l);
        // Under a caution: against the cars on track, unless the race's analysis measured it so.
        const lostS = under && m.pitTiming?.lossMethod !== "fcy_neighbours" && m.pitTiming?.lossMethod !== "fcy_lap_field" ? cautionLoss(data, key, m.l, clock) : lost;
        return { lap: m.l, lostS: kind === "stop" ? lostS : lost, caution: under, kind };
      })
      .sort((a, b) => a.lap - b.lap);
  }
  // No markers: the laps' pit flags, a visit over two laps counted once.
  const out: Stop[] = [];
  for (let i = 0; i < laps.length; i++) {
    const d = laps[i];
    if (d.pit !== 1 || d.l <= 1 || (i > 0 && laps[i - 1].pit === 1)) continue;
    const under = caution(d.l);
    out.push({ lap: d.l, lostS: under ? cautionLoss(data, key, d.l, clock) : null, caution: under, kind: d.ltSec >= LONG_STOP_S ? "garage" : "stop" });
  }
  return out;
}

/** Green pace: the average of the car's last PACE_LAPS green laps (no pit laps or out-laps, no caution). */
export function greenPace(laps: Lap[], data: RaceChartData, fcy: Set<number>, n = PACE_LAPS): number | null {
  const xs: number[] = [];
  for (let i = laps.length - 1; i >= 0 && xs.length < n; i--) {
    const l = laps[i];
    const prev = laps[i - 1];
    const out = !!prev && (prev.pit !== 0 || prev.ltSec >= data.greenPaceCutoff);
    if (l.pit === 0 && !out && l.ltSec > 1 && l.ltSec < data.greenPaceCutoff && !fcy.has(l.l) && (!l.flag || isGreenFlag(l.flag))) xs.push(l.ltSec);
  }
  if (xs.length < MIN_PACE_LAPS) return null;
  return n > PACE_LAPS ? median(xs) : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Time lost to a stop under a caution: its in- and out-lap against the laps the cars on track
 * finished at about the same moments (the timing's own figure is against green pace, which a
 * caution lap is not).
 */
function cautionLoss(data: RaceChartData, key: string, lap: number, clock: Map<string, Map<number, number>>): number | null {
  const laps = data.cars[key]?.laps ?? [];
  const i = laps.findIndex((x) => x.l === lap);
  if (i < 0 || i + 1 >= laps.length) return null;
  const at = clock.get(key)!;
  const refAt = (t: number) => {
    const xs: number[] = [];
    for (const [k, c] of Object.entries(data.cars)) {
      if (k === key) continue;
      const ck = clock.get(k)!;
      for (let j = 1; j < c.laps.length; j++) {
        const l = c.laps[j];
        const e = ck.get(l.l)!;
        if (Math.abs(e - t) <= CAUTION_REF_S && l.pit === 0 && c.laps[j - 1].pit === 0 && l.ltSec > 1 && l.ltSec < LONG_STOP_S) xs.push(l.ltSec);
      }
    }
    return median(xs);
  };
  const a = refAt(at.get(laps[i].l)!);
  const b = refAt(at.get(laps[i + 1].l)!);
  return a === null || b === null ? null : laps[i].ltSec + laps[i + 1].ltSec - a - b;
}

/** Every car's summed lap times at each of its laps. */
export function raceClock(data: RaceChartData): Map<string, Map<number, number>> {
  return new Map(Object.entries(data.cars).map(([k, c]) => [k, elapsedAt(c.laps)]));
}

/** Summed lap times at each lap (the chart's time axis). */
function elapsedAt(laps: Lap[]): Map<number, number> {
  const m = new Map<number, number>();
  let t = 0;
  for (const l of laps) {
    t += l.ltSec > 0 ? l.ltSec : 0;
    m.set(l.l, t);
  }
  return m;
}

const isCaution = (flag: string | null) => !!flag && CAUTION_FLAGS.has(flag);

export function liveStrategy({ data, annotations, focusNum, flag, timeToGoS }: LiveStrategyInput): LiveStrategy | null {
  const focus = data.cars[String(focusNum)];
  if (!focus) return null;
  const cls = focus.cls;
  const keys = Object.keys(data.cars).filter((k) => data.cars[k].cls === cls && data.cars[k].laps.length > 0);
  if (!keys.length) return null;
  const fcy = fcySet(data);
  const caution = isCaution(flag);

  // The race's stops, all classes: a green stop's and a caution stop's time lost.
  const greenLost: number[] = [];
  const cautionLost: number[] = [];
  const stopsBy = new Map<string, Stop[]>();
  const clock = raceClock(data);
  for (const k of Object.keys(data.cars)) {
    const st = stopsOf(data, annotations, k, clock);
    stopsBy.set(k, st);
    for (const s of st) if (s.kind === "stop" && s.lostS !== null) (s.caution ? cautionLost : greenLost).push(s.lostS);
  }
  const clsGreen = keys.flatMap((k) => (stopsBy.get(k) ?? []).filter((s) => s.kind === "stop" && !s.caution && s.lostS !== null).map((s) => s.lostS!));
  const greenStopS = median(clsGreen.length >= 3 ? clsGreen : greenLost);
  const measuredCaution = median(cautionLost);
  const cautionStopS = measuredCaution ?? (greenStopS !== null ? greenStopS * CAUTION_SHARE : null);

  // "Now": the latest crossing in the class (summed lap times).
  const elapsed = clock;
  const lastT = (k: string) => {
    const laps = data.cars[k].laps;
    return elapsed.get(k)!.get(laps[laps.length - 1].l) ?? 0;
  };
  const now = Math.max(...keys.map(lastT));

  // Stints between stops (fuel stops and garage visits end one; a drive-through does not).
  const rows = keys.map((k) => {
    const car = data.cars[k];
    const laps = car.laps;
    const lapsDone = laps[laps.length - 1].l;
    const ends = (stopsBy.get(k) ?? []).filter((s) => s.kind !== "drive_through").map((s) => s.lap);
    const stints: number[] = [];
    let from = 0;
    for (const e of ends) {
      if (e > from) stints.push(e - from);
      from = e;
    }
    const pace = greenPace(laps, data, fcy, PROJECTION_LAPS);
    const stopped = now - lastT(k) > STOPPED_PACES * (pace ?? data.greenPaceCutoff);
    return { k, car, lapsDone, stints, lastStopLap: from, pace, stopped };
  });

  // The class's stint length: the long stints (within STINT_SHARE of the longest) it has run, and
  // never shorter than a stint a running car is on now (early stops are often short ones).
  const all = rows.flatMap((r) => r.stints);
  const onNow = Math.max(0, ...rows.filter((r) => !r.stopped).map((r) => r.lapsDone - r.lastStopLap));
  const longest = Math.max(0, ...all);
  const long = all.filter((s) => s >= longest * STINT_SHARE);
  const stintLength = long.length >= MIN_STINTS ? Math.round(Math.max(median(long)!, onNow)) : null;

  // The class leader: the most laps, then the earliest to complete them.
  const order = [...rows].sort((a, b) => b.lapsDone - a.lapsDone || lastT(a.k) - lastT(b.k));
  const lead = order[0];
  const leadAt = elapsed.get(lead.k)!;
  const gapOf = (r: (typeof rows)[number]) => {
    const t = lastT(r.k);
    const lt = leadAt.get(r.lapsDone);
    // Behind at the line: its time at its last lap against the leader's at the same lap.
    return lt === undefined ? 0 : Math.max(0, t - lt);
  };
  const refPace = lead.pace ?? median(rows.map((r) => r.pace).filter((p): p is number => p !== null));

  const cars: CarStrategy[] = order.map((r, i) => {
    const longestStint = Math.max(0, ...r.stints);
    const stintCap = stintLength === null ? null : Math.max(stintLength, longestStint);
    const stintLaps = r.lapsDone - r.lastStopLap;
    let stopsToGo: number | null = null;
    if (stintCap !== null && r.pace !== null && timeToGoS !== null && !r.stopped) {
      const lapsLeft = Math.max(0, timeToGoS / r.pace);
      const reach = stintCap * (1 + STINT_SLACK);
      stopsToGo = Math.max(0, Math.ceil((stintLaps + lapsLeft - reach) / stintCap));
    }
    return {
      num: Number(r.k),
      cls,
      team: r.car.team,
      posClass: i + 1,
      laps: r.lapsDone,
      pace: r.pace,
      stops: stopsBy.get(r.k) ?? [],
      lastStopLap: r.lastStopLap,
      stintLaps,
      longestStint,
      stintCap,
      stopsToGo,
      gapS: i === 0 ? 0 : gapOf(r),
      netGapS: null,
      netPos: null,
      projGapS: null,
      projPos: null,
      stopped: r.stopped,
    };
  });

  // Net and projected order: cars still running, with stops to go known.
  const leadStops = cars[0].stopsToGo;
  if (greenStopS !== null) {
    const running = cars.filter((c) => !c.stopped && c.stopsToGo !== null);
    for (const c of running) c.netGapS = c.gapS + ((c.stopsToGo ?? 0) - (leadStops ?? 0)) * greenStopS;
    const base = Math.min(...running.map((c) => c.netGapS!));
    for (const c of running) c.netGapS = c.netGapS! - base;
    [...running].sort((a, b) => a.netGapS! - b.netGapS!).forEach((c, i) => (c.netPos = i + 1));
    if (timeToGoS !== null && refPace) {
      const lapsLeft = timeToGoS / refPace;
      for (const c of running) c.projGapS = c.netGapS! + (c.pace !== null ? (c.pace - refPace) * lapsLeft : 0);
      const pb = Math.min(...running.map((c) => c.projGapS!));
      for (const c of running) c.projGapS = c.projGapS! - pb;
      [...running].sort((a, b) => a.projGapS! - b.projGapS!).forEach((c, i) => (c.projPos = i + 1));
    }
  }

  const fc = cars.find((c) => c.num === focusNum)!;
  let window: PitWindow | null = null;
  if (fc.stintCap !== null && fc.stopsToGo !== null && fc.stopsToGo > 0 && fc.pace !== null && timeToGoS !== null) {
    const finishLap = fc.laps + timeToGoS / fc.pace;
    const to = fc.lastStopLap + Math.floor(fc.stintCap * (1 + STINT_SLACK));
    const from = Math.max(fc.laps + 1, Math.ceil(finishLap - fc.stopsToGo * fc.stintCap * (1 + STINT_SLACK)));
    window = { from: Math.min(from, to), to, stopsToGo: fc.stopsToGo };
  }
  let pitNow: PitNow | null = null;
  const lost = caution ? cautionStopS : greenStopS;
  if (lost !== null && !fc.stopped) {
    const after = fc.gapS + lost;
    // Every car on track less than the stop's time lost behind it (and every car ahead) is ahead after.
    const ahead = cars.filter((c) => c !== fc && !c.stopped && c.gapS < after);
    pitNow = {
      lostS: lost,
      caution,
      savesS: caution && greenStopS !== null ? Math.max(0, greenStopS - lost) : null,
      rejoinPos: ahead.length + 1,
      measured: caution ? measuredCaution !== null : greenStopS !== null,
    };
  }

  return {
    cls,
    cars,
    greenStopS,
    cautionStopS,
    cautionMeasured: measuredCaution !== null,
    stintLength,
    timeToGoS,
    caution,
    focus: { car: fc, window, pitNow },
  };
}

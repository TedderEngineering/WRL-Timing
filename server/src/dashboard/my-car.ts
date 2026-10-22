/**
 * "Your car's latest race" (engagement plan C): the facts for one followed car in one race,
 * from the chart data the import stored, and its story from the published Race Analysis
 * Package when there is one.
 *
 * Wording rules (ENGAGEMENT_PRINCIPLES, stories): facts only, no blame, nothing stronger than
 * "possible". A weak result is simply not given a badge: the fastest-lap rank is only stated
 * when it is in the class's top three.
 */
import { pitVisitLaps } from "./pit-visits.js";
import type { Prose } from "../analysis/schema/package-types.js";
import { normCar } from "../intake/reimport.js";
import { carHighlights, type Highlight } from "./highlights.js";

interface LapRow {
  l: number;
  p: number;
  cp: number;
  ltSec: number;
  flag?: string;
  pit: number;
}
interface ChartCar {
  num: number | string;
  /** The published number when it differs from num ("4A", "007"). */
  label?: string;
  team: string;
  cls: string;
  make?: string;
  vehicle?: string;
  status?: string;
  finishPos: number;
  finishPosClass: number;
  laps: LapRow[];
}
interface ChartData {
  maxLap: number;
  cars: Record<string, ChartCar>;
  classCarCounts?: Record<string, number>;
}
interface Settle {
  l: number;
  p: number;
  su: string;
  /** From the race's analysis package: class positions before the stop and after the cycle closed. */
  cpBefore?: number;
  cpAfter?: number;
  /** The in-lap of the stop the cycle result belongs to. */
  stopLap?: number | null;
  /** The cycle never closed for the car (it retired, or the flag fell first). */
  open?: boolean;
}
interface PitMarker {
  l: number;
  pitTiming?: { totalPitLoss?: number | null; isDriveThrough?: boolean; context?: string } | null;
  /** The class pit cycle, from the analysis package. */
  cycle?: { id: string; ordinal: number } | null;
}
type Annotations = Record<string, { settles?: Settle[]; pits?: PitMarker[] } | undefined>;

export interface PitCycleResult {
  /** 1-based order of the car's settled cycles. */
  cycle: number;
  lap: number;
  /** Class positions before the cycle and once it settled. */
  before: number;
  after: number;
  net: number;
  /** The car's stop in this cycle (its in-lap), when one is found. */
  stopLap?: number | null;
  /** The cycle never closed for the car: after is where it ran on its last lap. */
  open?: boolean;
  /** The stop was a drive-through, or made under a caution. */
  driveThrough?: boolean;
  caution?: boolean;
  /** The stop's time lost ranked against the class's stops in the same pit cycle, when in the top three of three or more. */
  quickest?: { rank: number; of: number } | null;
}

export interface CarFacts {
  carKey: string;
  number: string;
  team: string;
  cls: string;
  vehicle: string | null;
  /** Official finish, null when not classified (DNF, DSQ, DNS, NC). */
  finishClass: number | null;
  finishOverall: number | null;
  classSize: number | null;
  status: string | null;
  /**
   * The car took the chequered flag. False for a car that stopped before the end, even when the
   * results still classify it (SRO and IMSA classify cars that retired late).
   */
  finished: boolean;
  laps: number;
  raceLaps: number;
  bestLap: { sec: number; lap: number } | null;
  /** Only when 1st–3rd in class (no badge for a weak result). */
  bestLapClassRank: number | null;
  pitCycles: PitCycleResult[];
  /** Pit stops: every pit-lane visit (pit-visits.ts), and their in-laps. */
  stops: number;
  stopLaps: number[];
  /**
   * Class benchmarks (engagement plan E), as facts: pit loss and fastest lap ranks in the top
   * three of the class, and places gained over the pit cycles when that is a gain. The same
   * rules as the race page (client/src/features/chart/benchmarks.ts).
   */
  benchmarks: string[];
  /** What went right, ranked (dashboard/highlights.ts): the share card shows the first, the card the first three. */
  highlights: Highlight[];
}

/** The chart's key for a race entry's number ("007" and "7" are one car). */
export function chartKeyFor(data: ChartData, carNumber: string): string | null {
  const want = String(carNumber).trim();
  const keys = Object.keys(data.cars);
  // The published number first: "007" and "7" can be two cars (utils/carNumbers.ts).
  const exact = keys.find((k) => (data.cars[k].label ?? k) === want);
  if (exact) return exact;
  const same = keys.filter((k) => normCar(data.cars[k].label ?? k) === normCar(want));
  return same.length === 1 ? same[0] : null;
}

function bestLapOf(laps: LapRow[]): { sec: number; lap: number } | null {
  let best: { sec: number; lap: number } | null = null;
  for (const l of laps) {
    // Green laps only, not the in-lap of a stop.
    if (l.pit === 1 || (l.flag && !["GF", "GREEN", "G"].includes(l.flag.toUpperCase())) || !(l.ltSec > 0)) continue;
    if (!best || l.ltSec < best.sec) best = { sec: l.ltSec, lap: l.l };
  }
  return best;
}

/**
 * The car's pit cycles in class positions, as the chart's class view draws them: before = the
 * class position on the last lap before the stop where the car held its pre-cycle overall
 * position; after = the class position on the lap the cycle settled.
 */
export function classPitCycles(laps: LapRow[], settles: Settle[]): PitCycleResult[] {
  const out: PitCycleResult[] = [];
  for (const s of settles) {
    if (typeof s.cpBefore === "number" && typeof s.cpAfter === "number") {
      out.push({
        cycle: out.length + 1,
        lap: s.l,
        before: s.cpBefore,
        after: s.cpAfter,
        net: s.cpBefore - s.cpAfter,
        ...(typeof s.stopLap === "number" ? { stopLap: s.stopLap } : {}),
        ...(s.open ? { open: true } : {}),
      });
      continue;
    }
    const at = laps.find((l) => l.l === s.l);
    const was = Number(/Was P(\d+)/.exec(s.su)?.[1]);
    const stop = [...laps].reverse().find((l) => l.l < s.l && l.pit === 1);
    const before = stop && Number.isFinite(was) ? [...laps].reverse().find((l) => l.l < stop.l && l.p === was) : undefined;
    if (!at || !before) continue;
    out.push({ cycle: out.length + 1, lap: s.l, before: before.cp, after: at.cp, net: before.cp - at.cp });
  }
  return out;
}

/** "Quickest stop of 7 in GTO, lap 63" (the class's same pit cycle): the stop's lap, not a class cycle number the card doesn't show. */
const QUICKEST = ["", "Quickest", "2nd quickest", "3rd quickest"];

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

/**
 * A stop's time lost when it can be ranked: a stop (not a drive-through) under green, as time
 * lost under a caution is measured against other cars, not green pace.
 */
function rankableLoss(p: PitMarker): number | null {
  const t = p.pitTiming;
  if (!t || t.isDriveThrough || (t.context && t.context !== "green")) return null;
  return typeof t.totalPitLoss === "number" && t.totalPitLoss > 0 ? t.totalPitLoss : null;
}

function stopsWithTiming(ann: Annotations | null, key: string): PitMarker[] {
  return [...(ann?.[key]?.pits ?? [])].filter((p) => p.pitTiming).sort((a, b) => a.l - b.l);
}

/**
 * Each pit cycle's stop: the car's last stop before the cycle settled (and after the previous
 * one), whether it was a drive-through or under a caution, and how its time lost ranked in the
 * class's same pit cycle (top three of three or more only, as the benchmarks).
 */
export function withStops(data: ChartData, ann: Annotations | null, key: string, cycles: PitCycleResult[]): PitCycleResult[] {
  const car = data.cars[key];
  const pitLaps = car.laps.filter((l) => l.pit === 1).map((l) => l.l);
  const markers = stopsWithTiming(ann, key);
  const classKeys = Object.keys(data.cars).filter((k) => k !== key && data.cars[k].cls === car.cls);
  const others = classKeys.map((k) => stopsWithTiming(ann, k));
  return cycles.map((c, i) => {
    const after = i > 0 ? cycles[i - 1].lap : 0;
    // The stop the cycle result belongs to (the package says), else the last pit lap before it settled.
    const stopLap = c.stopLap ?? [...pitLaps].reverse().find((l) => l < c.lap && l > after) ?? null;
    if (stopLap === null) return { ...c, stopLap: null, quickest: null };
    const m = markers.find((p) => p.l === stopLap);
    const t = m?.pitTiming;
    let quickest: PitCycleResult["quickest"] = null;
    const loss = m ? rankableLoss(m) : null;
    if (m?.cycle && loss !== null) {
      const field = [loss, ...others.map((o) => o.find((p) => p.cycle?.id === m.cycle!.id)).map((p) => (p ? rankableLoss(p) : null)).filter((v): v is number => typeof v === "number")];
      const rank = field.filter((v) => v < loss).length + 1;
      if (field.length >= 3 && rank <= 3) quickest = { rank, of: field.length };
    }
    return { ...c, stopLap, driveThrough: !!t?.isDriveThrough, caution: !!t?.context && t.context !== "green", quickest };
  });
}

export function classBenchmarks(data: ChartData, ann: Annotations | null, key: string, cycles: PitCycleResult[]): string[] {
  const car = data.cars[key];
  const classKeys = Object.keys(data.cars).filter((k) => data.cars[k].cls === car.cls);
  const out: string[] = [];
  const rankOf = (mine: number, all: number[]) => all.filter((v) => v < mine).length + 1;

  const mine = stopsWithTiming(ann, key);
  const others = classKeys.map((k) => stopsWithTiming(ann, k));
  mine.forEach((stop, i) => {
    const loss = rankableLoss(stop);
    if (loss === null) return;
    // The class pit cycle when the package gives one, else the class's same stop (1st, 2nd…).
    const cycle = stop.cycle;
    const field = (cycle ? others.map((o) => o.find((p) => p.cycle?.id === cycle.id)) : others.map((o) => o[i]))
      .map((p) => (p ? rankableLoss(p) : null))
      .filter((v): v is number => typeof v === "number");
    const rank = rankOf(loss, field);
    if (field.length >= 3 && rank <= 3) {
      out.push(`${QUICKEST[rank]} stop of ${field.length} in ${car.cls}${cycle ? "" : `'s ${ordinal(i + 1)} stops`}, lap ${stop.l}`);
    }
  });

  const best = bestLapOf(car.laps)?.sec;
  if (best !== undefined) {
    const field = classKeys.map((k) => bestLapOf(data.cars[k].laps)?.sec).filter((v): v is number => typeof v === "number");
    const rank = rankOf(best, field);
    if (field.length >= 3 && rank <= 3) out.push(`Fastest lap ${ordinal(rank)} of ${field.length} in ${car.cls}`);
  }

  const gained = cycles.reduce((a, c) => a + c.net, 0);
  if (gained > 0) out.push(`Gained ${gained} place${gained === 1 ? "" : "s"} over ${cycles.length} pit cycle${cycles.length === 1 ? "" : "s"} in ${car.cls}`);
  return out;
}

/**
 * Whether a car took the chequered flag: it ran the full distance, or its last crossing came after
 * the winner's finish (a lapped car still running). A car that stopped earlier did not, whatever
 * the results call it. Lap times add up to each car's race time (the grid offset is a few seconds,
 * hence the margin).
 */
export function tookFlag(data: ChartData, car: ChartCar, status: string | null): boolean {
  if (status && /^(dns|dsq|dnf|ret|retired|not running|nc)\b/.test(status)) return false;
  if (car.laps.length >= data.maxLap) return true;
  const total = (c: ChartCar) => c.laps.reduce((a, l) => a + (l.ltSec > 0 ? l.ltSec : 0), 0);
  const full = Object.values(data.cars).filter((c) => c.laps.length >= data.maxLap);
  if (!full.length) return true;
  const winnerEnd = Math.min(...full.map(total));
  return total(car) >= winnerEnd - 30;
}

export function carFacts(data: ChartData, ann: Annotations | null, carNumber: string): CarFacts | null {
  const key = chartKeyFor(data, carNumber);
  if (!key) return null;
  const car = data.cars[key];
  const status = car.status ? car.status.toLowerCase() : null;
  const entries = Object.keys(data.cars).length;
  // As the race page: DSQ, not classified and DNS have no position; a DNF can still be classified.
  const classified = !(status && ["dsq", "nc", "dns"].includes(status)) && car.finishPos > 0 && car.finishPos <= entries;

  const best = bestLapOf(car.laps);
  let bestLapClassRank: number | null = null;
  if (best) {
    const rivals = Object.values(data.cars)
      .filter((c) => c.cls === car.cls)
      .map((c) => bestLapOf(c.laps)?.sec)
      .filter((s): s is number => typeof s === "number");
    const rank = rivals.filter((s) => s < best.sec).length + 1;
    bestLapClassRank = rank <= 3 ? rank : null;
  }

  const pitCycles = withStops(data, ann, key, classPitCycles(car.laps, ann?.[key]?.settles ?? []));
  const finished = tookFlag(data, car, status);
  const facts: CarFacts = {
    carKey: key,
    number: car.label ?? String(car.num ?? key),
    team: car.team,
    cls: car.cls,
    vehicle: car.vehicle || car.make || null,
    finishClass: classified ? car.finishPosClass || null : null,
    finishOverall: classified ? car.finishPos : null,
    classSize: data.classCarCounts?.[car.cls] ?? Object.values(data.cars).filter((c) => c.cls === car.cls).length,
    status,
    finished,
    laps: car.laps.length,
    raceLaps: data.maxLap,
    bestLap: best,
    bestLapClassRank,
    pitCycles,
    ...(() => {
      const stopLaps = pitVisitLaps(car.laps, ann?.[key]?.pits);
      return { stops: stopLaps.length, stopLaps };
    })(),
    benchmarks: classBenchmarks(data, ann, key, pitCycles),
    highlights: [],
  };
  facts.highlights = carHighlights(data as any, ann as any, key, facts);
  return facts;
}

export interface CarStory {
  headline: Prose;
  paragraphs: Prose[];
  /** Lookups to render {car:…}, {class:…} tokens, as on the recap. */
  cars: Record<string, { team: string; make: string; drivers: string[]; driverNumbers: number[] }>;
  classes: Record<string, string>;
}

type Pkg = Record<string, any>;

/** The car's story from a published package, or null when the package has none for it. */
export function extractCarStory(pkg: Pkg, carNumber: string): CarStory | null {
  const story = (pkg.carStories ?? []).find((s: any) => normCar(String(s.car)) === normCar(carNumber));
  if (!story?.headline?.text) return null;
  const cars: CarStory["cars"] = {};
  for (const e of pkg.entries ?? []) {
    cars[e.car] = {
      team: e.team ?? "",
      make: e.make && e.make !== "TBD" ? e.make : "",
      drivers: (e.drivers ?? []).map((d: any) => d.name),
      driverNumbers: (e.drivers ?? []).map((d: any) => d.number),
    };
  }
  const classes = Object.fromEntries((pkg.metadata?.classes ?? []).map((c: any) => [c.id, c.name ?? c.id]));
  return { headline: story.headline, paragraphs: story.paragraphs ?? [], cars, classes };
}

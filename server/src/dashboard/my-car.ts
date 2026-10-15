/**
 * "Your car's latest race" (engagement plan C): the facts for one followed car in one race,
 * from the chart data the import stored, and its story from the published Race Analysis
 * Package when there is one.
 *
 * Wording rules (ENGAGEMENT_PRINCIPLES, stories): facts only, no blame, nothing stronger than
 * "possible". A weak result is simply not given a badge: the fastest-lap rank is only stated
 * when it is in the class's top three.
 */
import type { Prose } from "../analysis/schema/package-types.js";
import { normCar } from "../intake/reimport.js";

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
}
type Annotations = Record<string, { settles?: Settle[] } | undefined>;

export interface PitCycleResult {
  /** 1-based order of the car's settled cycles. */
  cycle: number;
  lap: number;
  /** Class positions before the cycle and once it settled. */
  before: number;
  after: number;
  net: number;
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
  laps: number;
  raceLaps: number;
  bestLap: { sec: number; lap: number } | null;
  /** Only when 1st–3rd in class (no badge for a weak result). */
  bestLapClassRank: number | null;
  pitCycles: PitCycleResult[];
}

/** The chart's key for a race entry's number ("007" and "7" are one car). */
export function chartKeyFor(data: ChartData, carNumber: string): string | null {
  if (data.cars[carNumber]) return carNumber;
  return Object.keys(data.cars).find((k) => normCar(k) === normCar(carNumber)) ?? null;
}

function bestLapOf(laps: LapRow[]): { sec: number; lap: number } | null {
  let best: { sec: number; lap: number } | null = null;
  for (const l of laps) {
    // Green laps only, not the in-lap of a stop.
    if (l.pit === 1 || (l.flag && l.flag !== "GF") || !(l.ltSec > 0)) continue;
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
    const at = laps.find((l) => l.l === s.l);
    const was = Number(/Was P(\d+)/.exec(s.su)?.[1]);
    const stop = [...laps].reverse().find((l) => l.l < s.l && l.pit === 1);
    const before = stop && Number.isFinite(was) ? [...laps].reverse().find((l) => l.l < stop.l && l.p === was) : undefined;
    if (!at || !before) continue;
    out.push({ cycle: out.length + 1, lap: s.l, before: before.cp, after: at.cp, net: before.cp - at.cp });
  }
  return out;
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

  return {
    carKey: key,
    number: String(car.num ?? key),
    team: car.team,
    cls: car.cls,
    vehicle: car.vehicle || car.make || null,
    finishClass: classified ? car.finishPosClass || null : null,
    finishOverall: classified ? car.finishPos : null,
    classSize: data.classCarCounts?.[car.cls] ?? Object.values(data.cars).filter((c) => c.cls === car.cls).length,
    status,
    laps: car.laps.length,
    raceLaps: data.maxLap,
    bestLap: best,
    bestLapClassRank,
    pitCycles: classPitCycles(car.laps, ann?.[key]?.settles ?? []),
  };
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

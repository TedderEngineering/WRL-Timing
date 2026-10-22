/**
 * Highlights: what went right for a car (or a driver) in one race, ranked, from the race's chart
 * data. Every highlight is a fact measured against the class; a weak result is simply not a
 * highlight (never "slowest", never "worst"). Co-drivers are never compared with each other.
 *
 * Each highlight has a score: how much its kind matters (the result first, then race pace,
 * strategy, laps led, places gained, then the fastest lap and the rest) times how strong it is
 * (1st beats 3rd; 1st of 16 beats 1st of 3). The card's share image shows the top one; the
 * dashboard card and the race email list the top three.
 */
import { normCar } from "../intake/reimport.js";
import { pitVisitLaps } from "./pit-visits.js";
import { sameDriver } from "../utils/driverNames.js";
import { stintAverage, stintsOf } from "./my-driver.js";
import type { CarFacts } from "./my-car.js";

interface Lap {
  l: number;
  p: number;
  cp: number;
  ltSec: number;
  flag?: string;
  pit: number;
}
interface Car {
  num: number | string;
  label?: string;
  cls: string;
  status?: string;
  finishPos: number;
  finishPosClass: number;
  laps: Lap[];
}
interface Chart {
  maxLap: number;
  cars: Record<string, Car>;
}
type Ann = Record<string, { pits?: { l: number; inDriver?: string; outDriver?: string }[] } | undefined>;

export type HighlightKind =
  | "result"
  | "race_pace"
  | "fewest_stops"
  | "laps_led"
  | "places_gained"
  | "pit_cycles"
  | "fastest_lap"
  | "quickest_stop"
  | "consistency"
  | "best_stint"
  | "passes"
  | "clean_run"
  | "brought_home"
  | "driver_best_lap"
  | "driver_best_stint"
  | "driver_laps_led"
  | "driver_places_gained"
  | "longest_stint";

export interface Highlight {
  kind: HighlightKind;
  text: string;
  score: number;
}

/** How much each kind matters (before its strength). */
const WEIGHT: Record<HighlightKind, number> = {
  result: 100,
  race_pace: 60,
  fewest_stops: 55,
  laps_led: 52,
  places_gained: 45,
  fastest_lap: 42,
  pit_cycles: 40,
  best_stint: 38,
  consistency: 35,
  passes: 33,
  quickest_stop: 30,
  clean_run: 5,
  brought_home: 90,
  driver_best_lap: 60,
  driver_best_stint: 55,
  driver_laps_led: 50,
  driver_places_gained: 45,
  longest_stint: 30,
};

/** Ranks shown: the class top three. */
const TOP = 3;
/** Fewer cars than this, and no rank is a highlight. */
const MIN_FIELD = 3;
/** Laps over this share of the car's median green lap are not racing laps. */
const SLOW = 1.25;
/** A car's race pace counts when it ran at least this share of the class winner's laps. */
const PACE_MIN_SHARE = 0.5;

const GREEN = new Set(["GF", "GREEN", "G"]);
const isGreen = (l: Lap) => !l.flag || GREEN.has(l.flag.toUpperCase());
const ORD = ["", "", "2nd", "3rd"];
const best = (rank: number) => (rank === 1 ? "Best" : `${ORD[rank]}-best`);
const fast = (rank: number) => (rank === 1 ? "Fastest" : `${ORD[rank]} fastest`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Strength of a rank in a field: 1 for 1st of a large field, less for lower ranks and small fields. */
export function strength(rank: number, field: number): number {
  const byRank = 1 - (rank - 1) / TOP;
  const byField = Math.min(1, 0.5 + field / 20);
  return Math.max(0, byRank) * byField;
}

/** The racing laps: green, not a pit lap or an out-lap, not far over the car's median lap. */
export function racingLaps(laps: Lap[]): number[] {
  const pit = new Set(laps.filter((l) => l.pit === 1).map((l) => l.l));
  const xs = laps.filter((l) => l.ltSec > 0 && l.pit !== 1 && !pit.has(l.l - 1) && isGreen(l)).map((l) => l.ltSec);
  if (!xs.length) return [];
  const sorted = [...xs].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  return xs.filter((t) => t <= med * SLOW);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/** 1-based rank of `mine` among `all` (lower is better); ties share the better rank. */
const rankOf = (mine: number, all: number[]) => all.filter((v) => v < mine - 1e-9).length + 1;

function fmtLap(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

/** On-track passes in class: a class rival ahead at the previous crossing and behind at this one, neither car pitting, under green. */
function passesOf(key: string, cars: [string, Car][]): number {
  const me = cars.find(([k]) => k === key)![1];
  const byLap = (c: Car) => new Map(c.laps.map((l) => [l.l, l]));
  const mine = byLap(me);
  const pitted = (c: Car) => {
    const s = new Set<number>();
    for (const l of c.laps) if (l.pit === 1) [l.l, l.l + 1].forEach((x) => s.add(x));
    return s;
  };
  const myPit = pitted(me);
  let n = 0;
  for (const [k, c] of cars) {
    if (k === key) continue;
    const theirs = byLap(c);
    const theirPit = pitted(c);
    for (const l of me.laps) {
      const prevMe = mine.get(l.l - 1);
      const prevThem = theirs.get(l.l - 1);
      const now = theirs.get(l.l);
      if (!prevMe || !prevThem || !now || !isGreen(l) || myPit.has(l.l) || theirPit.has(l.l)) continue;
      if (prevThem.cp < prevMe.cp && now.cp > l.cp) n++;
    }
  }
  return n;
}

/** The car's highlights, best first. */
export function carHighlights(data: Chart, ann: Ann | null, key: string, f: CarFacts): Highlight[] {
  const car = data.cars[key];
  if (!car) return [];
  const cls = car.cls;
  const classCars = Object.entries(data.cars).filter(([, c]) => c.cls === cls && c.laps.length);
  const n = classCars.length;
  const out: Highlight[] = [];
  const add = (kind: HighlightKind, text: string, s: number) => s > 0 && out.push({ kind, text, score: Math.round(WEIGHT[kind] * s * 10) / 10 });

  // The result: a class podium (a car that took the flag; else "classified").
  if (f.finishClass !== null && f.finishClass <= TOP && f.finished !== false) {
    const overall = f.finishOverall === 1 ? " and the race overall" : f.finishOverall && f.finishOverall <= 3 ? `, P${f.finishOverall} overall` : "";
    add("result", f.finishClass === 1 ? `Won ${cls}${overall}` : `P${f.finishClass} in ${cls}${overall}`, f.finishClass === 1 ? 1 : f.finishClass === 2 ? 0.8 : 0.7);
  }
  if (n < MIN_FIELD) return finish(out, f);

  const leaderLaps = Math.max(...classCars.map(([, c]) => c.laps.length));
  const racing = new Map(classCars.map(([k, c]) => [k, racingLaps(c.laps)]));
  const eligible = classCars.filter(([k, c]) => c.laps.length >= PACE_MIN_SHARE * leaderLaps && (racing.get(k)?.length ?? 0) >= 10);
  const mineRacing = racing.get(key) ?? [];
  const meEligible = eligible.some(([k]) => k === key);

  // Race pace: the average racing lap.
  if (meEligible && eligible.length >= MIN_FIELD) {
    const all = eligible.map(([k]) => mean(racing.get(k)!));
    const r = rankOf(mean(mineRacing), all);
    if (r <= TOP) add("race_pace", `${best(r)} race pace in ${cls}`, strength(r, eligible.length));
    // Consistency: the smallest spread of racing laps.
    const spreads = eligible.map(([k]) => sd(racing.get(k)!));
    const rc = rankOf(sd(mineRacing), spreads);
    if (rc <= TOP) add("consistency", rc === 1 ? `Most consistent laps in ${cls}` : `${ORD[rc]}-most consistent laps in ${cls}`, strength(rc, eligible.length));
  }

  // Fewest pit stops, among the cars that ran (almost) the full distance: counted as every page
  // counts them (pit-visits.ts: every pit-lane visit; a visit flagged over several laps once).
  const stopsOf = (c: Car) => {
    const k = classCars.find(([, x]) => x === c)?.[0];
    return pitVisitLaps(c.laps, k ? ann?.[k]?.pits : undefined).length;
  };
  const full = classCars.filter(([, c]) => c.laps.length >= leaderLaps - 1);
  if (full.length >= MIN_FIELD && full.some(([k]) => k === key)) {
    const mine = stopsOf(car);
    const others = full.filter(([k]) => k !== key).map(([, c]) => stopsOf(c));
    const fewer = others.filter((s) => s > mine).length;
    const tied = others.filter((s) => s === mine).length;
    if (!others.some((s) => s < mine) && fewer > 0) {
      add("fewest_stops", tied ? `${plural(mine, "pit stop")}, joint fewest in ${cls}` : `${plural(mine, "pit stop")}, fewest in ${cls}`, (fewer / others.length) * (tied ? 0.8 : 1));
    }
  }

  // Laps led: overall first, else in class; stronger the larger the share of the race.
  const ledOverall = car.laps.filter((l) => l.p === 1).length;
  const ledClass = car.laps.filter((l) => l.cp === 1).length;
  const share = (x: number) => Math.min(1, 0.4 + x / Math.max(1, data.maxLap));
  if (ledOverall > 0) add("laps_led", `Led the race for ${plural(ledOverall, "lap")}`, share(ledOverall) * 1.1);
  else if (ledClass > 0) add("laps_led", `Led ${cls} for ${plural(ledClass, "lap")}`, share(ledClass));

  // Places gained in class, from the first crossing to the result.
  const start = car.laps[0]?.cp;
  if (start && f.finishClass !== null && start - f.finishClass >= 3) {
    const g = start - f.finishClass;
    add("places_gained", `Up ${plural(g, "place")} in ${cls}, P${start} to P${f.finishClass}`, Math.min(1, 0.5 + g / 10));
  }

  // The pit cycles' net gain.
  const net = f.pitCycles.reduce((a, c) => a + c.net, 0);
  if (net > 0) add("pit_cycles", `Gained ${plural(net, "place")} over the pit cycles`, Math.min(1, 0.4 + net / 8));

  // The fastest lap in class (green laps, no in-lap: as the car's own best lap).
  if (f.bestLap) {
    const bestGreen = (c: Car) => Math.min(...c.laps.filter((l) => l.pit !== 1 && isGreen(l) && l.ltSec > 0).map((l) => l.ltSec), Infinity);
    const bests = classCars.map(([, c]) => bestGreen(c)).filter((x) => Number.isFinite(x));
    const r = rankOf(f.bestLap.sec, bests);
    if (r <= TOP) add("fastest_lap", `${fast(r)} lap in ${cls}, ${fmtLap(f.bestLap.sec)}`, strength(r, bests.length));
  }

  // The car's quickest stop in a class pit cycle.
  const q = f.pitCycles.filter((c) => c.quickest).sort((a, b) => a.quickest!.rank - b.quickest!.rank || b.quickest!.of - a.quickest!.of)[0];
  if (q?.quickest) {
    const word = q.quickest.rank === 1 ? "Quickest" : `${ORD[q.quickest.rank]} quickest`;
    add("quickest_stop", `${word} stop of ${q.quickest.of} in ${cls}${q.stopLap ? `, lap ${q.stopLap}` : ""}`, strength(q.quickest.rank, q.quickest.of));
  }

  // The best stint average in class (any car's stint of 10 racing laps or more).
  const stintAvgs = classCars.flatMap(([k, c]) => {
    const avg = stintAverage(c.laps);
    return stintsOf(c.laps, ann?.[k]?.pits ?? [], null).map((s) => ({ k, s, a: avg(s) })).filter((x) => x.a.avgLapS !== null && x.a.avgLaps >= 10);
  });
  const mineStints = stintAvgs.filter((x) => x.k === key).sort((a, b) => a.a.avgLapS! - b.a.avgLapS!);
  if (mineStints.length && stintAvgs.length >= MIN_FIELD) {
    const top = mineStints[0];
    const r = rankOf(top.a.avgLapS!, stintAvgs.map((x) => x.a.avgLapS!));
    if (r <= TOP) add("best_stint", `${best(r)} stint average in ${cls}, laps ${top.s.start}–${top.s.end}`, strength(r, stintAvgs.length));
  }

  // On-track passes in class.
  const passes = classCars.map(([k]) => passesOf(k, classCars));
  const mineP = passesOf(key, classCars);
  if (mineP > 0) {
    const r = passes.filter((x) => x > mineP).length + 1;
    if (r <= TOP) add("passes", `${r === 1 ? "Most" : `${ORD[r]}-most`} passes on track in ${cls} (${mineP})`, strength(r, n));
  }

  return finish(out, f);
}

/** Best first; a clean run only when nothing else is a highlight. */
function finish(out: Highlight[], f: CarFacts): Highlight[] {
  if (!out.length && f.finished !== false && f.laps >= f.raceLaps - 1 && !f.status) out.push({ kind: "clean_run", text: "Ran the full distance", score: WEIGHT.clean_run });
  return out.sort((a, b) => b.score - a.score);
}

// ─── Drivers ─────────────────────────────────────────────────────────────────

/** A driver's highlights in the car, best first: measured against every driver in the class, never the co-drivers alone. */
export function driverHighlights(
  data: Chart,
  ann: Ann | null,
  key: string,
  name: string,
  entryDriversByCar: Record<string, string[]>,
  f: CarFacts | null
): Highlight[] {
  const car = data.cars[key];
  if (!car) return [];
  const cls = car.cls;
  const classCars = Object.entries(data.cars).filter(([, c]) => c.cls === cls && c.laps.length);
  const out: Highlight[] = [];
  const add = (kind: HighlightKind, text: string, s: number) => s > 0 && out.push({ kind, text, score: Math.round(WEIGHT[kind] * s * 10) / 10 });
  const driversOf = (k: string) => entryDriversByCar[k] ?? entryDriversByCar[normCar(data.cars[k].label ?? k)] ?? [];

  // Every class car's stints with their drivers, racing laps and averages.
  const all = classCars.flatMap(([k, c]) => {
    const names = driversOf(k);
    const avg = stintAverage(c.laps);
    return stintsOf(c.laps, ann?.[k]?.pits ?? [], names.length === 1 ? names[0] : null, names).map((s) => ({ k, c, s, a: avg(s) }));
  });
  const mine = all.filter((x) => x.k === key && x.s.driver && sameDriver(x.s.driver, name));
  if (!mine.length) return [];
  const known = all.filter((x) => x.s.driver);
  const lapsIn = (x: (typeof all)[number]) => x.c.laps.filter((l) => l.l >= x.s.start && l.l <= x.s.end);

  // Brought the car home: drove its last stint, and the car took the flag.
  const myLast = all.filter((x) => x.k === key).sort((a, b) => b.s.end - a.s.end)[0];
  if (f && f.finished !== false && f.finishClass !== null && myLast?.s.driver && sameDriver(myLast.s.driver, name)) {
    const pos = f.finishClass;
    add("brought_home", pos === 1 ? `Brought #${f.number} home to the ${cls} win` : `Brought #${f.number} home P${pos} in ${cls}`, pos === 1 ? 1 : pos <= TOP ? 0.75 : 0.4);
  }

  // The best lap among every named driver in the class.
  const driverBest = new Map<string, number>();
  for (const x of known) {
    const b = Math.min(...racingLapsOf(lapsIn(x), x.c.laps), Infinity);
    if (!Number.isFinite(b)) continue;
    const id = `${x.k}|${x.s.driver!.toLowerCase()}`;
    driverBest.set(id, Math.min(driverBest.get(id) ?? Infinity, b));
  }
  const myBest = Math.min(...mine.map((x) => Math.min(...racingLapsOf(lapsIn(x), x.c.laps), Infinity)));
  if (Number.isFinite(myBest) && driverBest.size >= MIN_FIELD) {
    const r = rankOf(myBest, [...driverBest.values()]);
    if (r <= TOP) add("driver_best_lap", `${fast(r)} lap of any ${cls} driver, ${fmtLap(myBest)}`, strength(r, driverBest.size));
  }

  // The best stint average of any stint in the class.
  const avgs = known.filter((x) => x.a.avgLapS !== null && x.a.avgLaps >= 10);
  const myAvg = mine.filter((x) => x.a.avgLapS !== null && x.a.avgLaps >= 10).sort((a, b) => a.a.avgLapS! - b.a.avgLapS!)[0];
  if (myAvg && avgs.length >= MIN_FIELD) {
    const r = rankOf(myAvg.a.avgLapS!, avgs.map((x) => x.a.avgLapS!));
    if (r <= TOP) add("driver_best_stint", `${best(r)} stint average in ${cls}, laps ${myAvg.s.start}–${myAvg.s.end}`, strength(r, avgs.length));
  }

  // Laps led while driving.
  const myLaps = mine.flatMap(lapsIn);
  const ledO = myLaps.filter((l) => l.p === 1).length;
  const ledC = myLaps.filter((l) => l.cp === 1).length;
  const share = (x: number) => Math.min(1, 0.4 + x / Math.max(1, data.maxLap));
  if (ledO > 0) add("driver_laps_led", `Led the race for ${plural(ledO, "lap")}`, share(ledO) * 1.1);
  else if (ledC > 0) add("driver_laps_led", `Led ${cls} for ${plural(ledC, "lap")}`, share(ledC));

  // Places gained in class over the driver's stints (start of each stint to its end).
  let gained = 0;
  for (const x of mine) {
    const laps = lapsIn(x);
    const before = x.c.laps.find((l) => l.l === x.s.start - 1) ?? laps[0];
    const after = laps[laps.length - 1];
    if (before && after) gained += before.cp - after.cp;
  }
  if (gained >= 2) add("driver_places_gained", `Gained ${plural(gained, "place")} in ${cls} at the wheel`, Math.min(1, 0.4 + gained / 8));

  // The longest stint of any in the class.
  const lens = known.map((x) => x.s.end - x.s.start + 1);
  const myLong = Math.max(...mine.map((x) => x.s.end - x.s.start + 1));
  if (lens.length >= MIN_FIELD) {
    const r = lens.filter((v) => v > myLong).length + 1;
    if (r <= TOP) add("longest_stint", `${r === 1 ? "Longest" : `${ORD[r]}-longest`} stint in ${cls}, ${plural(myLong, "lap")}`, strength(r, lens.length));
  }

  return out.sort((a, b) => b.score - a.score);
}

/** A stint's racing laps, judged against the whole car's median (not the stint's own). */
function racingLapsOf(laps: Lap[], all: Lap[]): number[] {
  const keep = new Set(racingLaps(all));
  const pit = new Set(all.filter((l) => l.pit === 1).map((l) => l.l));
  return laps.filter((l) => l.ltSec > 0 && l.pit !== 1 && !pit.has(l.l - 1) && isGreen(l) && keep.has(l.ltSec)).map((l) => l.ltSec);
}

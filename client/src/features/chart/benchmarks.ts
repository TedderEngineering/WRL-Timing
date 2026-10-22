/**
 * Class benchmarks (engagement plan E): where a car's race stood in its class, as facts.
 *
 *   "Quickest stop of 7 in GTO"              its stop's time lost against the class's same pit cycle
 *   "3rd quickest stop of 24 in GS's 2nd stops"  (no pit cycles: against every class car's same stop)
 *   "Fastest lap 2nd of 24 in GS"            its best green lap against the class's
 *   "Gained 4 places over 3 pit cycles"      the pit cycles' settled results added up
 *
 * Each also says when (`at`: the stop's lap, the best lap's, the laps the cycles settled on).
 *
 * The rule: never "worst" or "slowest". A weak result is simply not given a badge: ranks are
 * only stated in the top three (with at least three cars to rank), and pit cycles only when
 * they gained places overall. The server's "Your car" card uses the same rules
 * (server/src/dashboard/my-car.ts).
 */
import type { AnnotationData, LapData, RaceChartData, SettleMarker } from "@shared/types";
import { classCycle } from "./pit-band";
import { stopsOf } from "./pit-stops";
import { isGreenFlag } from "./flags";

export interface Benchmark {
  kind: "pit_loss" | "fastest_lap" | "pit_cycles";
  text: string;
  /** When it happened: "lap 23", "laps 23, 47, 71" (the notes on the race page show it). */
  at: string;
}

/** "lap 23"; several: "laps 23, 47, 71", or "laps 23–150" for more than three. */
export function lapsAt(laps: number[]): string {
  const xs = [...new Set(laps)].sort((a, b) => a - b);
  if (xs.length === 0) return "";
  if (xs.length === 1) return `lap ${xs[0]}`;
  return xs.length <= 3 ? `laps ${xs.join(", ")}` : `laps ${xs[0]}–${xs[xs.length - 1]}`;
}

const TOP = 3;
const MIN_FIELD = 3;

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** Best green-flag lap that is not an in-lap. */
export function bestGreenLap(laps: LapData[]): number | null {
  return bestGreenLapOf(laps)?.ltSec ?? null;
}

/** That lap itself (its number and time). */
export function bestGreenLapOf(laps: LapData[]): LapData | null {
  let best: LapData | null = null;
  for (const l of laps) {
    if (l.pit === 1 || (l.flag && !isGreenFlag(l.flag)) || !(l.ltSec > 0)) continue;
    if (best === null || l.ltSec < best.ltSec) best = l;
  }
  return best;
}

/** 1 + the number of values strictly better (lower); ties share the better rank. */
const rankOf = (mine: number, all: number[]) => all.filter((v) => v < mine).length + 1;

/**
 * A stop's time lost, when it can be ranked: a normal stop (not a drive-through) under green.
 * Under a caution the package measures time lost against cars on track, not green pace.
 */
function stopLoss(t: { totalPitLoss?: number | null; isDriveThrough?: boolean; context?: string } | undefined): number | null {
  if (!t || t.isDriveThrough || (t.context && t.context !== "green")) return null;
  const v = t.totalPitLoss;
  return typeof v === "number" && v > 0 ? v : null;
}

/**
 * The car's class pit cycles: before = class position on the last lap before the stop where it
 * held its pre-cycle overall position, after = class position where the cycle settled (the
 * chart's class view, pit-band.ts settleLabels).
 */
export function classCycleNets(laps: LapData[], settles: { l: number; su: string; cpBefore?: number; cpAfter?: number }[]): number[] {
  return classCycleResults(laps, settles).map((r) => r.net);
}

/** The same, with the lap each cycle settled on (pit-band.ts classCycle, as the chart labels them). */
export function classCycleResults(laps: LapData[], settles: { l: number; p?: number; lb?: string; c?: string; su: string; cpBefore?: number; cpAfter?: number }[]): { net: number; l: number }[] {
  const out: { net: number; l: number }[] = [];
  for (const s of settles) {
    const c = classCycle({ p: 0, lb: "", c: "", ...s } as SettleMarker, laps);
    if (c) out.push({ net: c.net, l: s.l });
  }
  return out;
}

const QUICKEST = ["", "Quickest", "2nd quickest", "3rd quickest"];

export function classBenchmarks(data: RaceChartData, annotations: AnnotationData | null, carNum: number): Benchmark[] {
  const car = data.cars[String(carNum)];
  if (!car) return [];
  const classCars = (data.classGroups[car.cls] ?? Object.keys(data.cars).map(Number)).filter((n) => data.cars[String(n)]?.cls === car.cls);
  const out: Benchmark[] = [];

  // Pit loss in each of the car's stops against its class pit cycle (from the analysis package),
  // or, without one, against the class's same stop. Server: dashboard/my-car.ts classBenchmarks.
  if (annotations) {
    const mine = stopsOf(data, annotations, carNum);
    const others = classCars.map((n) => stopsOf(data, annotations, n));
    mine.forEach((s, i) => {
      const loss = stopLoss(s.timing);
      if (loss === null) return;
      const cycle = s.cycle;
      const field = (cycle ? others.map((o) => o.find((x) => x.cycle?.id === cycle.id)) : others.map((o) => o[i]))
        .map((x) => stopLoss(x?.timing))
        .filter((v): v is number => v !== null);
      if (field.length < MIN_FIELD) return;
      const rank = rankOf(loss, field);
      if (rank <= TOP) {
        out.push({
          kind: "pit_loss",
          // The stop's lap (`at`) says which stop; a class pit-cycle number would not match the car's own count.
          text: `${QUICKEST[rank]} stop of ${field.length} in ${car.cls}${cycle ? "" : `'s ${ordinal(i + 1)} stops`}`,
          at: lapsAt([s.pitLap]),
        });
      }
    });
  }

  // Fastest lap against the class.
  const bestLap = bestGreenLapOf(car.laps);
  if (bestLap !== null) {
    const best = bestLap.ltSec;
    const field = classCars.map((n) => bestGreenLap(data.cars[String(n)].laps)).filter((v): v is number => v !== null);
    const rank = rankOf(best, field);
    if (field.length >= MIN_FIELD && rank <= TOP) out.push({ kind: "fastest_lap", text: `Fastest lap ${ordinal(rank)} of ${field.length} in ${car.cls}`, at: lapsAt([bestLap.l]) });
  }

  // Places gained over the pit cycles, when they add up to a gain.
  const cycles = classCycleResults(car.laps, annotations?.[String(carNum)]?.settles ?? []);
  const gained = cycles.reduce((a, b) => a + b.net, 0);
  if (gained > 0) {
    out.push({
      kind: "pit_cycles",
      text: `Gained ${gained} place${gained === 1 ? "" : "s"} over ${cycles.length} pit cycle${cycles.length === 1 ? "" : "s"} in ${car.cls}`,
      at: lapsAt(cycles.map((c) => c.l)),
    });
  }
  return out;
}

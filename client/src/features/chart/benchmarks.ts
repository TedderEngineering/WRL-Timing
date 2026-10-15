/**
 * Class benchmarks (engagement plan E): where a car's race stood in its class, as facts.
 *
 *   "Pit loss 3rd of 24 in GS's 2nd stops"   its stop against every class car's same stop
 *   "Fastest lap 2nd of 24 in GS"            its best green lap against the class's
 *   "Gained 4 places over 3 pit cycles"      the pit cycles' settled results added up
 *
 * The rule: never "worst" or "slowest". A weak result is simply not given a badge: ranks are
 * only stated in the top three (with at least three cars to rank), and pit cycles only when
 * they gained places overall. The server's "Your car" card uses the same rules
 * (server/src/dashboard/my-car.ts).
 */
import type { AnnotationData, LapData, RaceChartData } from "@shared/types";
import { stopsOf } from "./pit-stops";

export interface Benchmark {
  kind: "pit_loss" | "fastest_lap" | "pit_cycles";
  text: string;
}

const TOP = 3;
const MIN_FIELD = 3;

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** Best green-flag lap that is not an in-lap. */
export function bestGreenLap(laps: LapData[]): number | null {
  let best: number | null = null;
  for (const l of laps) {
    if (l.pit === 1 || (l.flag && l.flag !== "GF") || !(l.ltSec > 0)) continue;
    if (best === null || l.ltSec < best) best = l.ltSec;
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
  const out: number[] = [];
  for (const s of settles) {
    if (typeof s.cpBefore === "number" && typeof s.cpAfter === "number") {
      out.push(s.cpBefore - s.cpAfter);
      continue;
    }
    const at = laps.find((l) => l.l === s.l);
    const was = Number(/Was P(\d+)/.exec(s.su)?.[1]);
    const stop = [...laps].reverse().find((l) => l.l < s.l && l.pit === 1);
    const before = stop && Number.isFinite(was) ? [...laps].reverse().find((l) => l.l < stop.l && l.p === was) : undefined;
    if (at && before) out.push(before.cp - at.cp);
  }
  return out;
}

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
          text: `Pit loss ${ordinal(rank)} of ${field.length} in ${cycle ? `${car.cls} pit cycle ${cycle.ordinal}` : `${car.cls}'s ${ordinal(i + 1)} stops`}`,
        });
      }
    });
  }

  // Fastest lap against the class.
  const best = bestGreenLap(car.laps);
  if (best !== null) {
    const field = classCars.map((n) => bestGreenLap(data.cars[String(n)].laps)).filter((v): v is number => v !== null);
    const rank = rankOf(best, field);
    if (field.length >= MIN_FIELD && rank <= TOP) out.push({ kind: "fastest_lap", text: `Fastest lap ${ordinal(rank)} of ${field.length} in ${car.cls}` });
  }

  // Places gained over the pit cycles, when they add up to a gain.
  const nets = classCycleNets(car.laps, annotations?.[String(carNum)]?.settles ?? []);
  const gained = nets.reduce((a, b) => a + b, 0);
  if (gained > 0) {
    out.push({
      kind: "pit_cycles",
      text: `Gained ${gained} place${gained === 1 ? "" : "s"} over ${nets.length} pit cycle${nets.length === 1 ? "" : "s"} in ${car.cls}`,
    });
  }
  return out;
}

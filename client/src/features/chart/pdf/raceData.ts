/**
 * Per-car figures the race PDFs print: finishing order, stops, racing laps, lap statistics. The
 * same rules as the tabs: verified stops when the race has them (pit notes with a kind), racing
 * laps without lap 1, pit in- and out-laps or caution laps.
 */
import type { AnnotationData, CarData, LapData, RaceChartData } from "@shared/types";
import { hasVerifiedStops } from "../strategy-engine";

export interface CarEntry {
  key: string;
  car: CarData;
  label: string;
}

export function fcySet(data: RaceChartData): Set<number> {
  const s = new Set<number>();
  for (const [a, b] of data.fcy) for (let l = a; l <= b; l++) s.add(l);
  return s;
}

const green = (l: LapData, fcy: Set<number>) => !fcy.has(l.l) && (!l.flag || ["GF", "GREEN", "G"].includes(l.flag.toUpperCase()));

/** Classified cars by position, then the rest by laps run. */
export function finishOrder(entries: CarEntry[], by: "class" | "overall"): CarEntry[] {
  const entriesN = entries.length;
  const pos = (e: CarEntry) => {
    const p = by === "class" ? e.car.finishPosClass : e.car.finishPos;
    return p && p < 999 && (by === "class" || p <= entriesN * 3) ? p : Infinity;
  };
  return [...entries].sort((a, b) => pos(a) - pos(b) || b.car.laps.length - a.car.laps.length || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export function entriesOf(data: RaceChartData, cls?: string): CarEntry[] {
  return Object.entries(data.cars)
    .filter(([, c]) => !cls || c.cls === cls)
    .map(([key, car]) => ({ key, car, label: car.label ?? String(car.num) }));
}

export function classesOf(data: RaceChartData): string[] {
  return [...new Set(Object.values(data.cars).map((c) => c.cls))].sort();
}

/** The laps a stop covers: from its in-lap, plus the out-lap after it. */
export interface StopMark {
  lap: number;
  kind: "stop" | "garage" | "penalty";
}

/** The car's pit visits: the verified stops when the race has them, else runs of pit-flagged laps. */
export function stopsOf(data: RaceChartData, annotations: AnnotationData | null | undefined, key: string): StopMark[] {
  if (annotations && hasVerifiedStops(annotations)) {
    return (annotations[key]?.pits ?? [])
      .filter((p) => p.kind && p.kind !== "retirement")
      .sort((a, b) => a.l - b.l)
      .map((p) => ({ lap: p.l, kind: p.kind === "garage" ? "garage" : p.kind === "stop" ? "stop" : "penalty" }));
  }
  const car = data.cars[key];
  const out: StopMark[] = [];
  let prev = -2;
  for (const l of car?.laps ?? []) {
    if (l.pit !== 1) continue;
    if (l.l !== prev + 1 && l.l !== 1) out.push({ lap: l.l, kind: l.ltSec > 900 ? "garage" : "stop" });
    prev = l.l;
  }
  return out;
}

/** Laps that are racing laps: not lap 1, not a pit in- or out-lap, not under caution, timed. */
export function racingLaps(car: CarData, fcy: Set<number>, stops: StopMark[]): LapData[] {
  const out = new Set<number>();
  for (const l of car.laps) if (l.pit === 1) out.add(l.l).add(l.l + 1);
  for (const s of stops) out.add(s.lap).add(s.lap + 1);
  return car.laps.filter((l) => l.l > 1 && !out.has(l.l) && green(l, fcy) && l.ltSec > 0);
}

export interface LapStats {
  best: { t: number; lap: number } | null;
  /** The quickest average of 10 consecutive racing laps. */
  best10: number | null;
  /** Average and spread of racing laps within 110% of the car's best. */
  avg: number | null;
  sd: number | null;
  racingLaps: number;
}

export function lapStats(laps: LapData[]): LapStats {
  if (!laps.length) return { best: null, best10: null, avg: null, sd: null, racingLaps: 0 };
  const best = laps.reduce((b, l) => (l.ltSec < b.ltSec ? l : b));
  const within = laps.filter((l) => l.ltSec <= best.ltSec * 1.1).map((l) => l.ltSec);
  const avg = within.reduce((a, b) => a + b, 0) / within.length;
  const sd = Math.sqrt(within.reduce((a, x) => a + (x - avg) ** 2, 0) / within.length);
  let best10: number | null = null;
  const byLap = new Map(laps.map((l) => [l.l, l.ltSec]));
  for (const l of laps) {
    let sum = 0;
    let ok = true;
    for (let k = 0; k < 10; k++) {
      const t = byLap.get(l.l + k);
      if (t === undefined) {
        ok = false;
        break;
      }
      sum += t;
    }
    if (ok && (best10 === null || sum / 10 < best10)) best10 = sum / 10;
  }
  return { best: { t: best.ltSec, lap: best.l }, best10, avg, sd, racingLaps: laps.length };
}

/** Positions gained in class from the first lap to the finish (positive = gained). */
export function classPlacesGained(car: CarData): number | null {
  const first = car.laps.find((l) => l.cp > 0 && l.cp < 999);
  const fin = car.finishPosClass && car.finishPosClass < 999 ? car.finishPosClass : car.laps[car.laps.length - 1]?.cp;
  return first && fin ? first.cp - fin : null;
}

/** "P3", or the car's status when it has no classified position. */
export function finishText(car: CarData, by: "class" | "overall", entries: number): string {
  const p = by === "class" ? car.finishPosClass : car.finishPos;
  const st = car.status?.toLowerCase();
  if (st === "dsq") return "DSQ";
  if (st === "dns") return "DNS";
  if (!p || p >= 999 || p > entries * 3) return st === "dnf" ? "DNF" : "NC";
  return String(p);
}

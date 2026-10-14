import type { AnnotationData, PitTimingData, RaceChartData } from "@shared/types";

export interface StopRow {
  carNum: number;
  team: string;
  cls: string;
  /** The car's in-lap. */
  pitLap: number;
  /** 1 = the car's first stop. */
  stopNumber: number;
  timing: PitTimingData;
  /** Out-lap time; the whole out-lap when the import could not split off the pit lane. */
  outLap: number | null;
  /** True when outLap is the whole lap (the pit box is before the timing line). */
  outLapWhole: boolean;
  isFocus: boolean;
}

export interface StopCycle {
  stopNumber: number;
  cls: string;
  firstLap: number;
  lastLap: number;
  rows: StopRow[];
}

/** A car's stops with pit timing, in order (the "Start" marker has none). */
export function stopsOf(data: RaceChartData, annotations: AnnotationData, carNum: number): StopRow[] {
  const car = data.cars[String(carNum)];
  const pits = annotations[String(carNum)]?.pits ?? [];
  if (!car) return [];
  return pits
    .filter((p) => p.pitTiming)
    .sort((a, b) => a.l - b.l)
    .map((p, i) => {
      const t = p.pitTiming!;
      let outLap: number | null = t.outLapTime ?? null;
      let outLapWhole = false;
      if (outLap === null || outLap <= 0) {
        // The import drops the out-lap when it cannot split off the pit-lane time (pit box
        // before the timing line). The lap itself is still known: show it whole.
        const next = car.laps.find((l) => l.l > p.l && l.pit === 0);
        outLap = next && next.ltSec > 0 ? next.ltSec : null;
        outLapWhole = outLap !== null;
      }
      return { carNum, team: car.team, cls: car.cls, pitLap: p.l, stopNumber: i + 1, timing: t, outLap, outLapWhole, isFocus: false };
    });
}

/**
 * The pit cycle of the focus car's stop nearest the selected lap: the same stop (first, second…)
 * of every car in its class. A class does its stops in rounds, so this is the round the stop
 * belongs to, wherever on track each car took it; cars that pitted near the same lap in other
 * classes, or on another round, are not part of it.
 */
export function classStopCycle(
  data: RaceChartData,
  annotations: AnnotationData,
  focusNum: number,
  activeLap: number,
  window = 3
): StopCycle | null {
  const focus = data.cars[String(focusNum)];
  if (!focus) return null;
  const own = stopsOf(data, annotations, focusNum);
  const near = own
    .filter((s) => Math.abs(s.pitLap - activeLap) <= window)
    .sort((a, b) => Math.abs(a.pitLap - activeLap) - Math.abs(b.pitLap - activeLap))[0];
  if (!near) return null;
  const rows: StopRow[] = [];
  for (const n of data.classGroups[focus.cls] ?? []) {
    const s = stopsOf(data, annotations, n)[near.stopNumber - 1];
    if (s) rows.push({ ...s, isFocus: n === focusNum });
  }
  const laps = rows.map((r) => r.pitLap);
  return { stopNumber: near.stopNumber, cls: focus.cls, firstLap: Math.min(...laps), lastLap: Math.max(...laps), rows };
}

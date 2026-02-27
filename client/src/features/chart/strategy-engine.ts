import type { RaceChartData, AnnotationData } from "@shared/types";

export interface StrategyMetrics {
  carNum: number;
  team: string;
  cls: string;
  classPos: number;
  overallPos: number;
  stintCount: number;
  avgGreenPace: number;
  bestLap: number;
  totalPitTime: number;
  avgPitDuration: number;
  yellowPitPct: number;
  greenLapCount: number;
  strategyScore: number;
}

export function computeStrategyMetrics(
  data: RaceChartData,
  _annotations: AnnotationData,
): StrategyMetrics[] {
  // Pre-build FCY lap set
  const fcyLaps = new Set<number>();
  for (const [start, end] of data.fcy) {
    for (let l = start; l <= end; l++) fcyLaps.add(l);
  }

  // Raw metrics per car (score filled in after class normalization)
  const raw: StrategyMetrics[] = [];

  for (const [numStr, car] of Object.entries(data.cars)) {
    const carNum = Number(numStr);
    const laps = car.laps;

    // ── Green-flag laps ───────────────────────────────────────────
    const greenTimes: number[] = [];
    for (const d of laps) {
      if (d.pit !== 0) continue;
      if (d.ltSec <= 1) continue;
      if (d.ltSec >= data.greenPaceCutoff) continue;
      if (fcyLaps.has(d.l)) continue;
      greenTimes.push(d.ltSec);
    }

    const avgGreenPace =
      greenTimes.length > 0
        ? greenTimes.reduce((s, t) => s + t, 0) / greenTimes.length
        : 0;

    const bestLap =
      greenTimes.length > 0 ? Math.min(...greenTimes) : 0;

    // ── Pit laps ──────────────────────────────────────────────────
    const pitLaps = laps.filter((d) => d.pit === 1);
    let totalPitTime = 0;
    let yellowPitCount = 0;

    for (const d of pitLaps) {
      // Estimate pit delta: pit lap time minus average green pace
      if (avgGreenPace > 0 && d.ltSec > 1) {
        totalPitTime += Math.max(0, d.ltSec - avgGreenPace);
      }
      if (fcyLaps.has(d.l)) yellowPitCount++;
    }

    const avgPitDuration =
      pitLaps.length > 0 ? totalPitTime / pitLaps.length : 0;

    const yellowPitPct =
      pitLaps.length > 0 ? (yellowPitCount / pitLaps.length) * 100 : 0;

    // ── Stints ────────────────────────────────────────────────────
    let stintCount = 1;
    for (const d of laps) {
      if (d.pit === 1) stintCount++;
    }

    raw.push({
      carNum,
      team: car.team,
      cls: car.cls,
      classPos: car.finishPosClass,
      overallPos: car.finishPos,
      stintCount,
      avgGreenPace,
      bestLap,
      totalPitTime,
      avgPitDuration,
      yellowPitPct,
      greenLapCount: greenTimes.length,
      strategyScore: 0, // computed below
    });
  }

  // ── Strategy score: normalize per class, then weight ────────────
  const byClass = new Map<string, StrategyMetrics[]>();
  for (const m of raw) {
    let arr = byClass.get(m.cls);
    if (!arr) { arr = []; byClass.set(m.cls, arr); }
    arr.push(m);
  }

  for (const classCars of byClass.values()) {
    const n = classCars.length;
    if (n === 0) continue;

    // Collect values for normalization (only cars with data)
    const paces = classCars.filter((c) => c.avgGreenPace > 0).map((c) => c.avgGreenPace);
    const pitTimes = classCars.map((c) => c.totalPitTime);
    const yellowPcts = classCars.map((c) => c.yellowPitPct);

    // Consistency: stddev of green lap times per car
    const stddevs: Map<number, number> = new Map();
    for (const m of classCars) {
      const car = data.cars[String(m.carNum)];
      const greens: number[] = [];
      for (const d of car.laps) {
        if (d.pit !== 0 || d.ltSec <= 1 || d.ltSec >= data.greenPaceCutoff || fcyLaps.has(d.l)) continue;
        greens.push(d.ltSec);
      }
      if (greens.length > 1) {
        const mean = greens.reduce((s, t) => s + t, 0) / greens.length;
        const variance = greens.reduce((s, t) => s + (t - mean) ** 2, 0) / greens.length;
        stddevs.set(m.carNum, Math.sqrt(variance));
      } else {
        stddevs.set(m.carNum, 0);
      }
    }
    const allStddevs = classCars.map((c) => stddevs.get(c.carNum) ?? 0);

    for (const m of classCars) {
      // 40% pace rank: lower avgGreenPace = better
      const paceScore = m.avgGreenPace > 0
        ? normalize(m.avgGreenPace, paces, true)
        : 0;

      // 30% yellow pit pct: higher = better (smart strategy)
      const yellowScore = normalize(m.yellowPitPct, yellowPcts, false);

      // 20% pit efficiency: lower totalPitTime = better
      const pitScore = normalize(m.totalPitTime, pitTimes, true);

      // 10% consistency: lower stddev = better
      const sd = stddevs.get(m.carNum) ?? 0;
      const consistScore = normalize(sd, allStddevs, true);

      m.strategyScore = Math.round(
        paceScore * 0.4 + yellowScore * 0.3 + pitScore * 0.2 + consistScore * 0.1,
      );
    }
  }

  // Sort by classPos ascending
  raw.sort((a, b) => a.classPos - b.classPos);
  return raw;
}

/**
 * Normalize a value within a set of values to 0-100.
 * If invert=true, lower raw value → higher score (better).
 * If invert=false, higher raw value → higher score (better).
 */
function normalize(val: number, all: number[], invert: boolean): number {
  if (all.length <= 1) return 50;
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (max === min) return 50;
  const ratio = (val - min) / (max - min); // 0..1
  return invert ? (1 - ratio) * 100 : ratio * 100;
}

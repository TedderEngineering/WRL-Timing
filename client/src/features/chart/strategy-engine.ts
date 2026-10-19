import type { RaceChartData, AnnotationData } from "@shared/types";

// ─── Data types ──────────────────────────────────────────────────────────────

export interface StintData {
  n: number;       // stint number (1-based)
  laps: number;    // total laps in stint
  gl: number;      // green laps
  yl: number;      // yellow laps
  pace: number;    // avg green pace (seconds), 0 if no green laps
  deg: number;     // degradation (s/lap), 0 if can't compute
  ps: number;      // class position at start of stint
  pe: number;      // class position at end of stint
}

export interface PitData {
  lap: number;     // the in-lap
  /** Seconds in the pit lane (verified stops), or the pit lap's time over green pace (lap flags); null when not timed. */
  dur: number | null;
  pb: number;      // class position before pit
  pa: number;      // class position after pit
  yel: boolean;    // under yellow flag
  /** "stop" (service), "garage" (behind the wall) or "penalty" (drive-through, stop-and-go: not a stop). */
  kind: "stop" | "garage" | "penalty";
}

export interface RaceConditions {
  totalLaps: number;
  yellowLaps: number;
  greenLaps: number;
  pctYellow: number;
}

export interface ClassStats {
  count: number;
  avgPace: number;   // seconds
  bestPace: number;  // seconds
  avgStops: number;
  avgStint: number;  // laps
}

export interface InsightData {
  type: string;
  cls: string;
  title: string;
  text: string;
}

export interface StrategyMetrics {
  carNum: number;
  /** The car number to show ("4A", "007"); carNum is the chart key. */
  carLabel: string;
  team: string;
  cls: string;
  classPos: number;
  overallPos: number;
  stintCount: number;
  /** Pit stops: service stops and garage visits, not drive-throughs or penalties. */
  stops: number;
  /** Stops and penalties with no pit-lane time; totalPitTime leaves them out. */
  untimedStops: number;
  /** Garage visits (counted as stops; their time is not in totalPitTime). */
  garageVisits: number;
  /** True when the stops come from the race's verified pit stops, false when from the laps' pit flags. */
  verified: boolean;
  avgGreenPace: number;
  bestLap: number;
  totalPitTime: number;
  avgPitDuration: number;
  yellowPitPct: number;
  greenLapCount: number;
  /** 0-100 within the class; -1 when the car ran too little of the race to be scored (see SCORE_MIN_DISTANCE). */
  strategyScore: number;
  lapsCompleted: number;
  pitPct: number;        // pit time as % of total race time
  avgStintLen: number;   // avg laps per stint
  maxStintLen: number;   // max laps in a single stint
  stints: StintData[];
  pits: PitData[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildFcySet(data: RaceChartData): Set<number> {
  const s = new Set<number>();
  for (const [start, end] of data.fcy) {
    for (let l = start; l <= end; l++) s.add(l);
  }
  return s;
}

/** Seconds → M:SS.mmm */
function fmtPace(s: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ":" + sec.toFixed(3).padStart(6, "0");
}

/** Seconds → M:SS.mmm (total time) */
function fmtTime(s: number): string {
  if (!s) return "0:00.000";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ":" + sec.toFixed(3).padStart(6, "0");
}

/** Seconds → M:SS.s */
function fmtTenths(s: number): string {
  const m = Math.floor(s / 60);
  return m + ":" + (s - m * 60).toFixed(1).padStart(4, "0");
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Time in the pit lane: 6:21.000 (1.5% of race)", naming stops that were not timed. */
export function pitTimeSentence(m: StrategyMetrics): string {
  const label = m.verified ? "Time in the pit lane" : "Total pit time";
  const timed = m.stops - m.garageVisits - m.untimedStops;
  const over = m.untimedStops > 0 ? ` over ${plural(Math.max(0, timed), "timed stop")}` : "";
  const garage = m.garageVisits > 0 ? `, plus ${plural(m.garageVisits, "garage visit")}` : "";
  return `${label}: ${m.verified ? fmtTenths(m.totalPitTime) : fmtTime(m.totalPitTime)}${over} (${m.pitPct.toFixed(1)}% of race)${garage}.`;
}

/** The class's cars that ran at least SCORE_MIN_DISTANCE of its most laps (all of them when none has laps). */
function ranMostOfRace(cars: StrategyMetrics[]): StrategyMetrics[] {
  const most = Math.max(0, ...cars.map((c) => c.lapsCompleted));
  return most > 0 ? cars.filter((c) => c.lapsCompleted >= most * SCORE_MIN_DISTANCE) : cars;
}

/** True when the race's pit notes come from its verified stops (each note says what the car did). */
export function hasVerifiedStops(annotations: AnnotationData | null | undefined): boolean {
  return Object.values(annotations ?? {}).some((a) => a?.pits?.some((p) => !!p.kind));
}

type Visit = PitData;

/** The car's pit visits from its verified stops: one per visit, retirements left out. */
function verifiedVisits(annotations: AnnotationData, key: string, laps: { l: number; cp: number; pit: number }[], fcyLaps: Set<number>): Visit[] {
  const pits = [...(annotations[key]?.pits ?? [])].filter((p) => p.kind && p.kind !== "retirement").sort((a, b) => a.l - b.l);
  return pits.map((p) => {
    const kind: Visit["kind"] = p.kind === "garage" ? "garage" : p.kind === "stop" ? "stop" : "penalty";
    const t = p.pitTiming;
    const i = laps.findIndex((l) => l.l === p.l);
    const before = i > 0 ? laps[i - 1] : laps[i];
    const after = laps.slice(i + 1).find((l) => l.pit === 0) ?? laps[i];
    return {
      lap: p.l,
      dur: t?.pitRoadTime ?? null,
      pb: before?.cp ?? 0,
      pa: after?.cp ?? 0,
      yel: t?.context ? t.context !== "green" : fcyLaps.has(p.l),
      kind,
    };
  });
}

/** A car is scored only with at least this share of its class's most laps. */
export const SCORE_MIN_DISTANCE = 0.75;

function normalize(val: number, all: number[], invert: boolean): number {
  if (all.length <= 1) return 50;
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (max === min) return 50;
  const ratio = (val - min) / (max - min);
  return invert ? (1 - ratio) * 100 : ratio * 100;
}

// ─── Conditions ──────────────────────────────────────────────────────────────

export function computeRaceConditions(data: RaceChartData): RaceConditions {
  const fcyLaps = buildFcySet(data);
  const yellowLaps = fcyLaps.size;
  const totalLaps = data.maxLap;
  const greenLaps = totalLaps - yellowLaps;
  return {
    totalLaps,
    yellowLaps,
    greenLaps,
    pctYellow: totalLaps > 0 ? (yellowLaps / totalLaps) * 100 : 0,
  };
}

// ─── Class stats ─────────────────────────────────────────────────────────────

export function computeClassStats(
  _data: RaceChartData,
  metrics: StrategyMetrics[],
): Record<string, ClassStats> {
  const result: Record<string, ClassStats> = {};
  const byClass = new Map<string, StrategyMetrics[]>();
  for (const m of metrics) {
    let arr = byClass.get(m.cls);
    if (!arr) { arr = []; byClass.set(m.cls, arr); }
    arr.push(m);
  }
  for (const [cls, cars] of byClass) {
    const paces = cars.filter((c) => c.avgGreenPace > 0).map((c) => c.avgGreenPace);
    const avgPace = paces.length > 0 ? paces.reduce((a, b) => a + b, 0) / paces.length : 0;
    const bestPace = paces.length > 0 ? Math.min(...paces) : 0;
    // Stops and stint length over the cars that ran most of the race (an early retirement's few
    // stops and short stints say nothing about the class's strategy).
    const ran = ranMostOfRace(cars);
    const avgStops = ran.length > 0 ? ran.reduce((a, c) => a + c.stops, 0) / ran.length : 0;
    const avgStint = ran.length > 0 ? ran.reduce((a, c) => a + c.avgStintLen, 0) / ran.length : 0;
    result[cls] = { count: cars.length, avgPace, bestPace, avgStops, avgStint };
  }
  return result;
}

// ─── Insights ────────────────────────────────────────────────────────────────

export function computeInsights(
  _data: RaceChartData,
  metrics: StrategyMetrics[],
): InsightData[] {
  const insights: InsightData[] = [];
  const byClass = new Map<string, StrategyMetrics[]>();
  for (const m of metrics) {
    let arr = byClass.get(m.cls);
    if (!arr) { arr = []; byClass.set(m.cls, arr); }
    arr.push(m);
  }

  for (const [cls, all] of byClass) {
    // 1. Winner strategy
    const winner = all.find((c) => c.classPos === 1);
    // The rest compare cars that ran most of the race.
    const cars = ranMostOfRace(all);
    if (winner) {
      insights.push({
        type: "winner_strategy", cls,
        title: `${cls} Winner Strategy`,
        text: `#${winner.carLabel} ${winner.team} won ${cls} with ${plural(winner.stops, "pit stop")}, averaging ${winner.avgStintLen.toFixed(1)} laps per stint. Green-flag pace: ${fmtPace(winner.avgGreenPace)}. ${pitTimeSentence(winner)}`,
      });
    }

    // 2. Optimal stint length (bucket stints by 5-lap ranges, find best avg pace)
    const stintBuckets = new Map<string, { paces: number[]; count: number }>();
    for (const c of cars) {
      for (const st of c.stints) {
        if (st.pace <= 0) continue;
        const bucket = Math.floor(st.laps / 5) * 5;
        const key = `${bucket}-${bucket + 4}`;
        let b = stintBuckets.get(key);
        if (!b) { b = { paces: [], count: 0 }; stintBuckets.set(key, b); }
        b.paces.push(st.pace);
        b.count++;
      }
    }
    let bestBucket = "";
    let bestBucketPace = Infinity;
    for (const [key, b] of stintBuckets) {
      if (b.count < 2) continue; // need at least 2 stints
      const avg = b.paces.reduce((a, v) => a + v, 0) / b.paces.length;
      if (avg < bestBucketPace) { bestBucketPace = avg; bestBucket = key; }
    }
    if (bestBucket) {
      insights.push({
        type: "optimal_stint", cls,
        title: `${cls} Optimal Stint Length`,
        text: `Stints of ${bestBucket} laps produced the best average pace (${fmtPace(bestBucketPace)}) across the ${cls} cars that ran most of the race.`,
      });
    }

    // 3. Yellow pit strategy
    const yellowPitters = cars.filter((c) => c.yellowPitPct >= 50);
    const greenPitters = cars.filter((c) => c.yellowPitPct < 50);
    if (yellowPitters.length > 0 && greenPitters.length > 0) {
      const avgYellowPos = yellowPitters.reduce((a, c) => a + c.classPos, 0) / yellowPitters.length;
      const avgGreenPos = greenPitters.reduce((a, c) => a + c.classPos, 0) / greenPitters.length;
      const diff = avgGreenPos - avgYellowPos;
      if (diff > 0) {
        insights.push({
          type: "yellow_strategy", cls,
          title: `${cls} Yellow Flag Pit Strategy`,
          text: `Cars pitting primarily under yellow averaged P${avgYellowPos.toFixed(1)} in class vs P${avgGreenPos.toFixed(1)} for green-flag pitters — a strategic advantage.`,
        });
      }
    }

    // 4. Stop count analysis
    const stopGroups = new Map<number, { count: number; avgPos: number }>();
    for (const c of cars) {
      const stops = c.stops;
      let g = stopGroups.get(stops);
      if (!g) { g = { count: 0, avgPos: 0 }; stopGroups.set(stops, g); }
      g.count++;
      g.avgPos += c.classPos;
    }
    let bestStops = 0;
    let bestStopsAvg = Infinity;
    const stopDist: string[] = [];
    for (const [stops, g] of [...stopGroups].sort((a, b) => a[0] - b[0])) {
      g.avgPos = g.avgPos / g.count;
      stopDist.push(`${plural(stops, "stop")}: ${plural(g.count, "car")} (avg P${g.avgPos.toFixed(1)})`);
      if (g.avgPos < bestStopsAvg) { bestStopsAvg = g.avgPos; bestStops = stops; }
    }
    if (stopGroups.size > 1) {
      insights.push({
        type: "stop_count", cls,
        title: `${cls} Pit Stop Count Analysis`,
        text: `Cars making ${plural(bestStops, "stop")} averaged the best class finish (P${bestStopsAvg.toFixed(1)}). Stop distribution: ${stopDist.join(", ")}`,
      });
    }
  }

  return insights;
}

// ─── Main metrics computation ────────────────────────────────────────────────

export function computeStrategyMetrics(
  data: RaceChartData,
  annotations: AnnotationData,
): StrategyMetrics[] {
  const fcyLaps = buildFcySet(data);
  // The verified stops (one note per pit visit, with its pit-lane time) when the race has them.
  // The laps' pit flags count a visit spanning two laps twice and flag some cars' first lap.
  const verified = hasVerifiedStops(annotations);
  const raw: StrategyMetrics[] = [];

  for (const [numStr, car] of Object.entries(data.cars)) {
    const carNum = Number(numStr);
    const laps = car.laps;

    // ── Green-flag laps ─────────────────────────────────────────
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

    // ── Pit visits: the verified stops when the race has them, else the laps' pit flags ──
    const visits: Visit[] = verified
      ? verifiedVisits(annotations, numStr, laps, fcyLaps)
      : laps.flatMap((d, i) => {
          if (d.pit !== 1) return [];
          const garage = d.ltSec > 900; // a garage stay, not a stop's time
          return [{
            lap: d.l,
            dur: !garage && avgGreenPace > 0 && d.ltSec > 1 ? Math.max(0, d.ltSec - avgGreenPace) : null,
            pb: i > 0 ? laps[i - 1].cp : d.cp,
            pa: i < laps.length - 1 ? laps[i + 1].cp : d.cp,
            yel: fcyLaps.has(d.l),
            kind: garage ? ("garage" as const) : ("stop" as const),
          }];
        });
    const stopVisits = visits.filter((v) => v.kind !== "penalty");
    const stintEnds = new Set(stopVisits.map((v) => v.lap));

    // ── Build stints: each ends with a stop's in-lap ──────────────
    const stints: StintData[] = [];
    let stintLaps: typeof laps = [];
    let stintNum = 1;

    for (let i = 0; i < laps.length; i++) {
      const d = laps[i];
      stintLaps.push(d);
      if (stintEnds.has(d.l) || i === laps.length - 1) {
        // Close this stint
        const gl = stintLaps.filter((l) => !fcyLaps.has(l.l) && l.pit === 0).length;
        const yl = stintLaps.filter((l) => fcyLaps.has(l.l) && l.pit === 0).length;
        const greenInStint = stintLaps.filter(
          (l) => l.pit === 0 && l.ltSec > 1 && l.ltSec < data.greenPaceCutoff && !fcyLaps.has(l.l),
        );
        const pace = greenInStint.length > 0
          ? greenInStint.reduce((s, l) => s + l.ltSec, 0) / greenInStint.length
          : 0;

        // Degradation: linear slope of green lap times
        let deg = 0;
        if (greenInStint.length >= 3) {
          const xs = greenInStint.map((_, i) => i);
          const ys = greenInStint.map((l) => l.ltSec);
          const n = xs.length;
          const sumX = xs.reduce((a, b) => a + b, 0);
          const sumY = ys.reduce((a, b) => a + b, 0);
          const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
          const sumX2 = xs.reduce((a, x) => a + x * x, 0);
          const denom = n * sumX2 - sumX * sumX;
          if (denom !== 0) deg = (n * sumXY - sumX * sumY) / denom;
        }

        const ps = stintLaps[0].cp;
        const lastNonPit = [...stintLaps].reverse().find((l) => l.pit === 0) || stintLaps[stintLaps.length - 1];
        const pe = lastNonPit.cp;

        stints.push({
          n: stintNum,
          laps: stintLaps.length,
          gl, yl, pace, deg, ps, pe,
        });

        stintNum++;
        stintLaps = [];
      }
    }

    // ── Aggregates ──────────────────────────────────────────────
    const stintCount = stints.length;
    const stops = stopVisits.length;
    const garageVisits = visits.filter((v) => v.kind === "garage").length;
    const timedVisits = visits.filter((v) => v.kind !== "garage" && v.dur !== null);
    const untimedStops = visits.filter((v) => v.kind !== "garage" && v.dur === null).length;
    const totalPitTime = timedVisits.reduce((s, v) => s + (v.dur ?? 0), 0);
    const avgPitDuration = timedVisits.length > 0 ? totalPitTime / timedVisits.length : 0;
    const yellowPitPct = stops > 0 ? (stopVisits.filter((v) => v.yel).length / stops) * 100 : 0;

    const totalRaceTime = laps.reduce((s, d) => s + (d.ltSec > 0 ? d.ltSec : 0), 0);
    const pitPct = totalRaceTime > 0 ? (totalPitTime / totalRaceTime) * 100 : 0;

    const stintLens = stints.map((s) => s.laps);
    const avgStintLen = stintLens.length > 0 ? stintLens.reduce((a, b) => a + b, 0) / stintLens.length : 0;
    const maxStintLen = stintLens.length > 0 ? Math.max(...stintLens) : 0;

    raw.push({
      carNum,
      carLabel: car.label ?? String(carNum),
      team: car.team,
      cls: car.cls,
      classPos: car.finishPosClass,
      overallPos: car.finishPos,
      stintCount,
      stops,
      untimedStops,
      garageVisits,
      verified,
      avgGreenPace,
      bestLap,
      totalPitTime,
      avgPitDuration,
      yellowPitPct,
      greenLapCount: greenTimes.length,
      strategyScore: 0,
      lapsCompleted: laps.length,
      pitPct,
      avgStintLen,
      maxStintLen,
      stints,
      pits: visits,
    });
  }

  // ── Strategy score: normalize per class ───────────────────────
  // Only cars that ran most of the race are scored, and only against each other: a car out after
  // 44 laps of 175 has few stops, little pit time and fresh-car pace, which would make it "best".
  const byClass = new Map<string, StrategyMetrics[]>();
  for (const m of raw) {
    let arr = byClass.get(m.cls);
    if (!arr) { arr = []; byClass.set(m.cls, arr); }
    arr.push(m);
  }

  for (const all of byClass.values()) {
    if (all.length === 0) continue;
    const most = Math.max(...all.map((c) => c.lapsCompleted));
    const classCars = all.filter((c) => c.lapsCompleted >= most * SCORE_MIN_DISTANCE);
    for (const c of all) if (!classCars.includes(c)) c.strategyScore = -1;
    if (classCars.length === 0) continue;
    const paces = classCars.filter((c) => c.avgGreenPace > 0).map((c) => c.avgGreenPace);
    // Pit time as a share of the car's race time, so a car is not rewarded for a shorter race.
    const pitShares = classCars.map((c) => c.pitPct);
    const yellowPcts = classCars.map((c) => c.yellowPitPct);
    const stddevs = new Map<number, number>();
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
      const paceScore = m.avgGreenPace > 0 ? normalize(m.avgGreenPace, paces, true) : 0;
      const yellowScore = normalize(m.yellowPitPct, yellowPcts, false);
      const pitScore = normalize(m.pitPct, pitShares, true);
      const sd = stddevs.get(m.carNum) ?? 0;
      const consistScore = normalize(sd, allStddevs, true);
      m.strategyScore = parseFloat(
        (paceScore * 0.4 + yellowScore * 0.3 + pitScore * 0.2 + consistScore * 0.1).toFixed(1),
      );
    }
  }

  raw.sort((a, b) => a.classPos - b.classPos);
  return raw;
}

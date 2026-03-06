/**
 * Pit Stop Analysis Service
 *
 * Computes per-stop service time, pit road time, and time lost for WRL races.
 * Complementary to computePitTiming() in position-analysis.ts — that function
 * operates on chartData JSON; this service operates on Prisma RaceLap records
 * and persists denormalized results to the PitStopAnalysis table.
 */

import { prisma } from "../models/prisma.js";

// ─── Track Name Normalizer ──────────────────────────────────────────────────

// Extend this map whenever a new track is added to the system.
// Key: any known variant of the track name (lowercase).
// Value: canonical slug matching trackPitConfig.trackName in the DB.
const TRACK_ALIASES: Record<string, string> = {
  "barber motorsports park": "barber",
  barber: "barber",
  "wrl barber": "barber",
  "wrl barber 87": "barber",
  "sebring international raceway": "sebring",
  sebring: "sebring",
  "road america": "road-america",
  "circuit of the americas": "cota",
  cota: "cota",
  "virginia international raceway": "vir",
  vir: "vir",
};

export function normalizeTrackName(raw: string): string {
  return TRACK_ALIASES[raw.toLowerCase().trim()] ?? raw.toLowerCase().trim();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ─── Global Baseline ────────────────────────────────────────────────────────

export function computeGlobalBaseline(
  carLaps: { lapTime: number; inPit: boolean }[],
  cautionFactor = 1.5
): number {
  const nonPit = carLaps.filter((l) => !l.inPit).map((l) => l.lapTime);
  if (nonPit.length === 0) return 0;
  const roughMedian = median(nonPit);
  const clean = nonPit.filter((t) => t <= roughMedian * cautionFactor);
  return clean.length > 0 ? median(clean) : roughMedian;
}

// ─── Local Rolling Reference ────────────────────────────────────────────────

export interface LocalRefResult {
  value: number;
  source: string; // "local (N laps)" | "local-sparse (N laps)" | "global fallback"
  lapNumbers: number[];
  isReliable: boolean;
}

export function computeLocalRef(
  carLaps: { lapNumber: number; lapTime: number; inPit: boolean }[],
  pitLapNumber: number,
  globalBaseline: number,
  opts: {
    windowSize?: number;
    minCleanLaps?: number;
    cautionFactor?: number;
  } = {}
): LocalRefResult {
  const windowSize = opts.windowSize ?? 5;
  const minCleanLaps = opts.minCleanLaps ?? 3;
  const cautionFactor = opts.cautionFactor ?? 1.15;

  const priorPitLaps = new Set(
    carLaps
      .filter((l) => l.inPit && l.lapNumber < pitLapNumber)
      .map((l) => l.lapNumber)
  );
  const outLaps = new Set([...priorPitLaps].map((n) => n + 1));

  const clean: { lapTime: number; lapNumber: number }[] = [];

  for (let n = pitLapNumber - 1; n > pitLapNumber - 1 - windowSize; n--) {
    const lap = carLaps.find((l) => l.lapNumber === n);
    if (!lap) continue;
    if (lap.inPit) break; // do not cross pit boundary
    if (outLaps.has(lap.lapNumber)) continue; // skip out-lap
    if (lap.lapTime > globalBaseline * cautionFactor) continue; // skip Code 35
    clean.push({ lapTime: lap.lapTime, lapNumber: lap.lapNumber });
  }

  if (clean.length >= minCleanLaps)
    return {
      value: median(clean.map((l) => l.lapTime)),
      source: `local (${clean.length} laps)`,
      lapNumbers: clean.map((l) => l.lapNumber),
      isReliable: true,
    };
  if (clean.length >= 1)
    return {
      value: median(clean.map((l) => l.lapTime)),
      source: `local-sparse (${clean.length} laps)`,
      lapNumbers: clean.map((l) => l.lapNumber),
      isReliable: false,
    };
  return {
    value: globalBaseline,
    source: "global fallback",
    lapNumbers: [],
    isReliable: false,
  };
}

// ─── Core Analysis Function ─────────────────────────────────────────────────

export interface PitStopResult {
  stopNumber: number;
  pitLap: number;
  condition: string;
  localRef_s: number;
  vsGlobal_s: number;
  refSource: string;
  twoLapActual_s: number;
  twoLapRef_s: number;
  serviceTime_s: number;
  pitRoadTime_s: number;
  timeLost_s: number;
  delta_s: number;
  isCautionContaminated: boolean;
}

export interface TrackConfig {
  transitTime_s: number;
  transitOverhead_s: number;
  cautionFactor?: number;
}

export function analyzePitStop(
  carLaps: { lapNumber: number; lapTime: number; inPit: boolean }[],
  pitLapNumber: number,
  stopNumber: number,
  config: TrackConfig,
  globalBaseline: number
): PitStopResult | null {
  const inLap = carLaps.find((l) => l.lapNumber === pitLapNumber - 1);
  const pitLap = carLaps.find((l) => l.lapNumber === pitLapNumber);
  const outLap = carLaps.find((l) => l.lapNumber === pitLapNumber + 1);
  if (!inLap || !pitLap || !outLap) return null;

  const cautionFactor = config.cautionFactor ?? 1.15;
  const localRef = computeLocalRef(carLaps, pitLapNumber, globalBaseline, {
    cautionFactor,
  });

  // Check caution on the lap BEFORE pit (proxy for Code 35 on entry)
  // and on the out-lap (proxy for Code 35 on exit).
  // Cannot use pitLap itself — it's always inflated by pit road traversal.
  const cautionIn = inLap.lapTime > localRef.value * cautionFactor;
  const cautionOut = outLap.lapTime > localRef.value * cautionFactor;

  const refIn = cautionIn ? inLap.lapTime : localRef.value;
  const refOut = cautionOut ? outLap.lapTime : localRef.value;
  const twoLapRef = refIn + refOut;

  // WRL has no ToD — lap time summation is mathematically identical
  const twoLapActual = pitLap.lapTime + outLap.lapTime;

  const transitAdj = cautionIn ? 0 : config.transitOverhead_s;
  const serviceTime = twoLapActual - twoLapRef - transitAdj;
  const pitRoadTime = config.transitTime_s + serviceTime;
  const timeLost = twoLapActual - twoLapRef;
  const delta = timeLost - pitRoadTime;

  const condition =
    cautionIn && cautionOut
      ? "C35-in, C35-out"
      : cautionIn
        ? "C35-in"
        : cautionOut
          ? "C35-out"
          : "Full green";

  return {
    stopNumber,
    pitLap: pitLapNumber,
    condition,
    localRef_s: localRef.value,
    vsGlobal_s: localRef.value - globalBaseline,
    refSource: localRef.source,
    twoLapActual_s: twoLapActual,
    twoLapRef_s: twoLapRef,
    serviceTime_s: serviceTime,
    pitRoadTime_s: pitRoadTime,
    timeLost_s: timeLost,
    delta_s: delta,
    isCautionContaminated: !localRef.isReliable,
  };
}

// ─── Race Runner & DB Persist ───────────────────────────────────────────────

export async function analyzeRacePitStops(raceId: string): Promise<{
  processed: number;
  skipped: number;
  errors: string[];
  validationPassed: boolean;
  validationSummary: string;
}> {
  // 1. Fetch race
  const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });

  // 2. Resolve track config via normalizer
  const slug = normalizeTrackName(race.track);
  const config = await prisma.trackPitConfig.findFirst({
    where: { trackName: slug, series: "WRL" },
    orderBy: { eventYear: "desc" },
  });
  if (!config)
    throw new Error(
      `No WRL pit config for track "${race.track}" (slug: "${slug}"). ` +
        `Add trackName="${slug}" to track_pit_configs or add alias to TRACK_ALIASES.`
    );

  // 3. Fetch laps
  const allLaps = await prisma.raceLap.findMany({
    where: { raceId },
    orderBy: [{ carNumber: "asc" }, { lapNumber: "asc" }],
  });

  // 4. Group by car, mapping to LapRecord shape
  const byCar = new Map<
    string,
    { lapNumber: number; lapTime: number; inPit: boolean }[]
  >();
  for (const lap of allLaps) {
    if (lap.lapTimeSec == null) continue; // skip laps without timing
    const arr = byCar.get(lap.carNumber) ?? [];
    arr.push({
      lapNumber: lap.lapNumber,
      lapTime: lap.lapTimeSec,
      inPit: lap.pitStop,
    });
    byCar.set(lap.carNumber, arr);
  }

  const toUpsert: Array<PitStopResult & { carNumber: string }> = [];
  const errors: string[] = [];
  let skipped = 0;

  const trackCfg: TrackConfig = {
    transitTime_s: Number(config.transitTime_s),
    transitOverhead_s: Number(config.transitOverhead_s),
  };

  // 5. Analyse each car
  for (const [carNumber, laps] of byCar) {
    const globalBaseline = computeGlobalBaseline(laps);
    if (globalBaseline === 0) {
      skipped++;
      continue;
    }

    const pitLaps = laps.filter((l) => l.inPit).map((l) => l.lapNumber);

    pitLaps.forEach((pitLap, idx) => {
      const result = analyzePitStop(
        laps,
        pitLap,
        idx + 1,
        trackCfg,
        globalBaseline
      );
      if (result) toUpsert.push({ ...result, carNumber });
      else {
        errors.push(`${carNumber} lap ${pitLap}: missing adjacent lap`);
        skipped++;
      }
    });
  }

  // 6. Upsert all results (idempotent)
  for (const r of toUpsert) {
    const { carNumber, ...data } = r;
    await prisma.pitStopAnalysis.upsert({
      where: {
        raceId_carNumber_stopNumber: {
          raceId,
          carNumber,
          stopNumber: r.stopNumber,
        },
      },
      create: { raceId, carNumber, ...data },
      update: { ...data },
    });
  }

  // 7. Validation gate — delta must equal one of two expected values
  const expectedGreen = -(trackCfg.transitTime_s - trackCfg.transitOverhead_s);
  const expectedC35 = -trackCfg.transitTime_s;
  const tolerance = 0.15;

  const failures = toUpsert.filter((r) => {
    const expected = r.condition.includes("C35-in")
      ? expectedC35
      : expectedGreen;
    return Math.abs(r.delta_s - expected) > tolerance;
  });

  if (failures.length > 0)
    console.warn(
      `[pitStopAnalysis] delta validation failures:\n` +
        failures
          .map(
            (f) =>
              `  ${f.carNumber} stop ${f.stopNumber}: delta=${f.delta_s.toFixed(3)}`
          )
          .join("\n")
    );

  return {
    processed: toUpsert.length,
    skipped,
    errors,
    validationPassed: failures.length === 0,
    validationSummary:
      failures.length === 0
        ? `All ${toUpsert.length} stops passed delta validation`
        : `${failures.length} stops failed — check server logs`,
  };
}

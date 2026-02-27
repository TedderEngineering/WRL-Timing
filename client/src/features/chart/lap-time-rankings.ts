import type { RaceChartData } from "@shared/types";

/**
 * For each green-flag, non-pit lap, rank all cars by lap time (1 = fastest).
 * FCY laps and pit laps are excluded entirely — no ranking stored.
 */
export function computeLapTimeRankings(
  data: RaceChartData,
): Map<number, Map<number, number>> {
  return rankLaps(data, null);
}

/**
 * Same as computeLapTimeRankings but filtered to a single class.
 */
export function computeClassLapTimeRankings(
  data: RaceChartData,
  className: string,
): Map<number, Map<number, number>> {
  return rankLaps(data, className);
}

// ── Shared implementation ────────────────────────────────────────────────────

function rankLaps(
  data: RaceChartData,
  className: string | null,
): Map<number, Map<number, number>> {
  const result = new Map<number, Map<number, number>>();

  // Pre-build a set of FCY laps for O(1) lookup
  const fcyLaps = new Set<number>();
  for (const [start, end] of data.fcy) {
    for (let l = start; l <= end; l++) fcyLaps.add(l);
  }

  // Build per-car lap lookup filtered by class
  const cars = Object.entries(data.cars).filter(
    ([, car]) => className === null || car.cls === className,
  );

  for (let lap = 1; lap <= data.maxLap; lap++) {
    // Skip entire lap if under yellow
    if (fcyLaps.has(lap)) continue;

    // Collect eligible cars with valid green-flag times
    const times: { num: number; ltSec: number }[] = [];
    for (const [numStr, car] of cars) {
      const entry = car.laps.find((l) => l.l === lap);
      if (!entry) continue;
      if (entry.pit === 1) continue;
      if (entry.ltSec <= 1) continue;
      times.push({ num: Number(numStr), ltSec: entry.ltSec });
    }

    if (times.length === 0) continue;

    // Sort fastest first and assign ranks
    times.sort((a, b) => a.ltSec - b.ltSec);
    const lapRanks = new Map<number, number>();
    for (let i = 0; i < times.length; i++) {
      lapRanks.set(times[i].num, i + 1);
    }
    result.set(lap, lapRanks);
  }

  return result;
}

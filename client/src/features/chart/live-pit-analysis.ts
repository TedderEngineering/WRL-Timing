/**
 * RaceTrace Live: the Pit Stops tab's analysis, built from the live chart's own stops (the pit
 * markers and their timing, as on the Position Trace) instead of a saved race's analysis. Same
 * shape and rules as a race's analysis package (server packages/pit-facts.ts pitStopsFromFacts):
 * no service time, time lost against green pace, delta against the class pit cycle's mean, and the
 * averages over green-flag stops (not drive-throughs or garage visits). Without the package's
 * stop kinds, a stop losing 5 minutes or more counts as a garage visit and one losing under
 * PIT_LANE_PASS_S as a drive-through.
 */
import type { AnnotationData, RaceChartData } from "@shared/types";
import { carNo } from "./car-number";
import { isGreenFlag } from "./flags";
import { LONG_STOP_S } from "./long-stops";
import type { PitAnalysisResponse, PitStop } from "./PitAnalysisTab";

const CONDITION = { green: "Full green", fcy: "Caution", mixed: "Green and caution" } as const;

/**
 * Time lost under this is a pass through the pit lane, not a stop (the timing marks the lap a pit
 * lap; in- and out-lap are near race pace): counted as a drive-through, out of the averages.
 */
export const PIT_LANE_PASS_S = 45;

/** The caution context of a stop: its in-lap and out-lap under green, a caution, or one of each. */
function contextOf(data: RaceChartData, num: number, pitLap: number): keyof typeof CONDITION {
  const laps = data.cars[String(num)]?.laps ?? [];
  const caution = (l: number) => {
    const lap = laps.find((x) => x.l === l);
    if (lap?.flag && !isGreenFlag(lap.flag)) return true;
    return (data.fcy ?? []).some(([a, b]) => l >= a && l <= b);
  };
  const inLap = caution(pitLap);
  const outLap = laps.some((x) => x.l === pitLap + 1) ? caution(pitLap + 1) : inLap;
  return inLap && outLap ? "fcy" : inLap || outLap ? "mixed" : "green";
}

export function pitAnalysisFromChart(data: RaceChartData, annotations: AnnotationData | null, track = ""): PitAnalysisResponse {
  const cars: PitAnalysisResponse["cars"] = {};
  const green: number[] = [];
  let total = 0;
  for (const [key, ann] of Object.entries(annotations ?? {})) {
    const car = data.cars[key];
    if (!car || !ann?.pits?.length) continue;
    const num = Number(key);
    const stops: PitStop[] = ann.pits.map((m, i) => {
      const t = m.pitTiming;
      const context = t?.context ?? contextOf(data, num, m.l);
      const lost = typeof t?.totalPitLoss === "number" ? t.totalPitLoss : null;
      // A garage visit or a long stop (repairs: LONG_STOP_S, as the red notes), or a pass through
      // the pit lane, is not an ordinary stop: shown, but out of the green-stop averages.
      const kind =
        m.kind ??
        (m.isGarage || (lost !== null && lost >= LONG_STOP_S)
          ? "garage"
          : t?.isDriveThrough || (lost !== null && lost < PIT_LANE_PASS_S)
            ? "drive_through"
            : "stop");
      if (kind === "stop" && context === "green" && lost !== null) green.push(lost);
      return {
        stopNumber: i + 1,
        pitLap: m.l,
        kind,
        condition: CONDITION[context] ?? context,
        localRef_s: t?.avgGreenLapTime ?? null,
        refSource: t?.avgGreenLapTime ? "Green pace" : "Not measurable",
        serviceTime_s: null,
        // The import's "total_only" timing repeats the time lost as the pit-lane time: not one.
        pitRoadTime_s: t?.pitRoadTime != null && !(t.decompositionLevel === "total_only" && t.pitRoadTime === t.totalPitLoss) ? t.pitRoadTime : null,
        timeLost_s: lost,
        delta_s: t?.cycleComparison?.deltaTotalLoss ?? null,
        cycle: m.cycle?.ordinal ?? t?.cycleComparison?.cycleId ?? null,
      };
    });
    total += stops.length;
    cars[carNo(data, num)] = {
      carNumber: carNo(data, num),
      teamName: car.team,
      carClass: car.cls,
      carColor: null,
      finishPos: car.finishPos || null,
      stops,
    };
  }
  return {
    source: "facts",
    raceId: "",
    track,
    trackConfig: null,
    cars,
    summary: {
      totalStops: total,
      totalCars: Object.keys(cars).length,
      avgServiceTime_s: null,
      avgTimeLost_s: green.length ? green.reduce((a, b) => a + b, 0) / green.length : null,
    },
  };
}

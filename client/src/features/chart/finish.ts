import type { RaceChartData } from "@shared/types";

/**
 * A car's official result next to where it crossed the line.
 *
 * The trace draws the order cars crossed the line on each lap. The official classification can
 * differ: post-race time penalties, disqualifications, results taken from an earlier lap after a
 * red flag. The page shows both whenever they differ, so a winner who crossed second (or a car
 * shown "P98" because it was excluded) is never left unexplained.
 */
export interface FinishInfo {
  /** "P3", or "DSQ" / "Not classified" / "DNS" when the car has no classified position. */
  official: string;
  /** Official position overall and in class, when classified. */
  pos: number | null;
  posClass: number | null;
  /** The car's position when it last crossed the line, and on which lap. */
  crossed: { pos: number; posClass: number; lap: number } | null;
  /** The car finished on the leader's lap but the official order differs from the crossing order. */
  changed: boolean;
  status: "classified" | "dnf" | "nc" | "dsq" | "dns" | null;
}

const LABELS: Record<string, string> = { dsq: "DSQ", nc: "Not classified", dns: "DNS" };

export function finishInfo(data: RaceChartData, carNum: number): FinishInfo | null {
  const car = data.cars[String(carNum)];
  if (!car) return null;
  const status = (car.status?.toLowerCase() as FinishInfo["status"]) ?? null;
  const entries = Object.keys(data.cars).length;
  const last = car.laps[car.laps.length - 1];
  const crossed = last && last.p < 999 ? { pos: last.p, posClass: last.cp, lap: last.l } : null;

  // A position larger than the whole entry is a placeholder the timing site gives a car with no
  // classified position (IMSA lists excluded cars as 98, 99…), not a finishing place.
  const placeholder = !car.finishPos || car.finishPos >= 999 || car.finishPos > entries;
  const label = status ? LABELS[status] : undefined;
  if (label || placeholder) {
    return { official: label ?? (status === "dnf" ? "DNF" : "Not classified"), pos: null, posClass: null, crossed, changed: false, status };
  }
  const changed = !!crossed && crossed.lap === data.maxLap && crossed.pos !== car.finishPos;
  return { official: `P${car.finishPos}`, pos: car.finishPos, posClass: car.finishPosClass || null, crossed, changed, status };
}

import type { RaceChartData } from "@shared/types";

/**
 * The car number to show for a chart car. The chart keys cars by an integer; a race that runs
 * "7" and "007", or "4" and "4A", gives the second one a stand-in integer and its published
 * number as `label` (server utils/carNumbers.ts). Always show this, never the key.
 */
export function carNo(data: Pick<RaceChartData, "cars"> | null | undefined, n: number | string): string {
  return data?.cars[String(n)]?.label ?? String(n);
}

/** The chart key for a car number as written in reason text ("#007", "#4A", "#12"). */
export function carKey(data: Pick<RaceChartData, "cars"> | null | undefined, token: string): number | null {
  const t = token.trim();
  if (data) {
    for (const [k, c] of Object.entries(data.cars)) if ((c.label ?? k) === t) return Number(k);
  }
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

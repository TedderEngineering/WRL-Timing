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

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Whether a car matches what someone typed in a car search: its published number, team,
 * make or any of its drivers, ignoring case and accents ("kirchhofer" finds Kirchhöfer).
 * Every word typed must appear.
 */
export function carMatchesSearch(data: Pick<RaceChartData, "cars">, n: number | string, query: string): boolean {
  const c = data.cars[String(n)];
  if (!c) return false;
  return textMatches([carNo(data, n), c.team, c.make ?? "", c.vehicle ?? "", ...(c.drivers ?? [])].join(" "), query);
}

/** Every word of the query appears in the text, ignoring case and accents. */
export function textMatches(text: string, query: string): boolean {
  const q = fold(query).split(/\s+/).filter(Boolean);
  const hay = fold(text);
  return q.every((w) => hay.includes(w));
}

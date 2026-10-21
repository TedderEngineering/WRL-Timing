/**
 * The Strategy tab and its PDF from one place: the stint colours, the method note, the sortable
 * columns, and the view the viewer has on screen (the class shown and the column it is sorted on),
 * which the PDF button prints as it is.
 */
import type { RaceChartData } from "@shared/types";
import type { StrategyMetrics } from "./strategy-engine";

/** A stint's colour from its green-flag pace against the class's best: green at the best, red at 4% slower. */
export function paceRgb(pace: number, best: number): [number, number, number] {
  if (!(pace > 0) || !(best > 0)) return [200, 200, 214];
  const f = Math.min(1, Math.max(0, (pace / best - 1) / 0.04));
  return hsl(140 * (1 - f), 0.62, 0.44);
}

export const rgbCss = ([r, g, b]: [number, number, number]) => `rgb(${r},${g},${b})`;

/** HSL (hue in degrees, s and l 0-1) to RGB. */
function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export const STRATEGY_KEY = {
  best: "Stint at the class's best pace",
  slow: "4% or more slower",
  caution: "Caution laps",
} as const;

export function strategyMethod(verified: boolean): string {
  return (
    (verified ? "Stops and pit-lane time from the race's verified pit stops (* a stop without a pit-lane time). " : "Stops from the laps' pit flags; pit time is the pit laps' time over green pace. ") +
    "Pace is the average green-flag lap. The score weighs pace, yellow-flag stops, pit time and consistency within the class, for cars that ran at least three quarters of the class's laps."
  );
}

export type StrategySortKey =
  | "classPos"
  | "carNum"
  | "team"
  | "lapsCompleted"
  | "stops"
  | "avgGreenPace"
  | "bestLap"
  | "totalPitTime"
  | "pitPct"
  | "yellowPitPct"
  | "avgStintLen"
  | "maxStintLen"
  | "strategyScore";

export interface StrategySort {
  key: StrategySortKey;
  dir: "asc" | "desc";
}

export const DEFAULT_STRATEGY_SORT: StrategySort = { key: "classPos", dir: "asc" };

/** Each sortable column: its value (null sorts last), its first direction, and its name in the PDF's note. */
export const STRATEGY_SORTS: Record<StrategySortKey, { value: (m: StrategyMetrics) => number | string | null; dir: "asc" | "desc"; name: string }> = {
  classPos: { value: (m) => m.classPos || null, dir: "asc", name: "position" },
  carNum: { value: (m) => m.carLabel, dir: "asc", name: "car" },
  team: { value: (m) => m.team, dir: "asc", name: "team" },
  lapsCompleted: { value: (m) => m.lapsCompleted, dir: "desc", name: "laps" },
  stops: { value: (m) => m.stops, dir: "asc", name: "stops" },
  avgGreenPace: { value: (m) => m.avgGreenPace || null, dir: "asc", name: "average pace" },
  bestLap: { value: (m) => m.bestLap || null, dir: "asc", name: "best lap" },
  totalPitTime: { value: (m) => m.totalPitTime, dir: "asc", name: "pit time" },
  pitPct: { value: (m) => m.pitPct, dir: "asc", name: "pit %" },
  yellowPitPct: { value: (m) => m.yellowPitPct, dir: "desc", name: "yellow-flag stops" },
  avgStintLen: { value: (m) => m.avgStintLen, dir: "desc", name: "average stint" },
  maxStintLen: { value: (m) => m.maxStintLen, dir: "desc", name: "longest stint" },
  strategyScore: { value: (m) => (m.strategyScore < 0 ? null : m.strategyScore), dir: "desc", name: "score" },
};

export function sortStrategy(rows: StrategyMetrics[], sort: StrategySort): StrategyMetrics[] {
  const { value } = STRATEGY_SORTS[sort.key];
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return a.classPos - b.classPos;
    if (av === null) return 1;
    if (bv === null) return -1;
    const c = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv), undefined, { numeric: true }) : av - bv;
    return dir * c || a.classPos - b.classPos;
  });
}

/** "Sorted by pit time, lowest first", or null for the class order. */
export function strategySortNote(sort: StrategySort): string | null {
  if (sort.key === "classPos" && sort.dir === "asc") return null;
  const s = STRATEGY_SORTS[sort.key];
  const text = sort.key === "carNum" || sort.key === "team";
  return `Sorted by ${s.name}, ${text ? (sort.dir === "asc" ? "A to Z" : "Z to A") : sort.dir === "asc" ? "lowest first" : "highest first"}`;
}

export interface StrategyView {
  cls: string;
  sort: StrategySort;
}

const views = new WeakMap<RaceChartData, StrategyView>();

export function setStrategyView(data: RaceChartData, view: StrategyView): void {
  views.set(data, view);
}

/** The view the tab last showed for this race's data, if it was opened. */
export function strategyView(data: RaceChartData): StrategyView | null {
  return views.get(data) ?? null;
}

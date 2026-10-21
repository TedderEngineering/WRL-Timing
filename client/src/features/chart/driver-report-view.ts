/**
 * The Driver Report as the viewer has it: the class shown and the column it is sorted on. The tab
 * keeps it here (per race's chart data) so the PDF button prints the table as it is on screen.
 */
import type { RaceChartData } from "@shared/types";
import type { DriverRow } from "./driver-performance";
import type { DriverColumnId } from "./driver-report-columns";

export type SortKey = "avgLap" | "fastLap" | "stdDev" | "avgZ" | "clearAirPct" | "overtakes" | "shown" | "laps" | "driver" | "car";
export interface DriverSort {
  key: SortKey;
  dir: "asc" | "desc";
}
export interface DriverReportView {
  cls: string;
  sort: DriverSort;
}

export const DEFAULT_SORT: DriverSort = { key: "avgLap", dir: "asc" };

const SORT_NAMES: Record<SortKey, string> = {
  avgLap: "average lap",
  fastLap: "best lap",
  stdDev: "consistency",
  avgZ: "pace vs class",
  clearAirPct: "clean-air laps",
  overtakes: "passes",
  shown: "laps counted",
  laps: "laps driven",
  driver: "driver",
  car: "car",
};

/** "Sorted by consistency, lowest first", or null when the table is ranked on average lap. */
export function driverSortNote(sort: DriverSort): string | null {
  if (sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir) return null;
  const text = sort.key === "driver" || sort.key === "car";
  return `Sorted by ${SORT_NAMES[sort.key]}, ${text ? (sort.dir === "asc" ? "A to Z" : "Z to A") : sort.dir === "asc" ? "lowest first" : "highest first"}`;
}

/**
 * The method note under the table and the PDF: how the table is ordered (the ranking on average
 * lap, or the column the viewer sorted on), then which laps count and what the measures mean.
 */
export function driverMethodText(sort: DriverSort, limits: { classPct: number; driverPct: number }): string {
  const note = driverSortNote(sort);
  const order = note
    ? `${note}. The average lap is the average of each driver's fastest laps, at most half of the laps they drove.`
    : "Drivers are ranked on the average of their fastest laps, at most half of the laps they drove.";
  return (
    `${order} Lap 1, pit in- and out-laps and laps under caution don't count, nor do laps over ${limits.classPct}% slower than the class's fastest ` +
    `or ${limits.driverPct}% slower than the driver's own fastest. Pace vs class compares each lap with the class's laps from the same part ` +
    `of the race (below 0 is quicker). Clean air and passes come from timing-line crossings and may miss some passes and traffic between the lines.`
  );
}

/** The sortable figure columns, in order, each with its first sort direction. */
export const SORT_COLUMNS: { key: SortKey & DriverColumnId; value: (r: DriverRow) => number | string | null; dir: "asc" | "desc" }[] = [
  { key: "avgLap", value: (r) => r.avgLap || null, dir: "asc" },
  { key: "fastLap", value: (r) => r.fastLap || null, dir: "asc" },
  { key: "stdDev", value: (r) => (r.shown.length ? r.stdDev : null), dir: "asc" },
  { key: "avgZ", value: (r) => r.avgZ, dir: "asc" },
  { key: "clearAirPct", value: (r) => r.clearAirPct, dir: "desc" },
  { key: "overtakes", value: (r) => r.overtakes, dir: "desc" },
  { key: "shown", value: (r) => r.shown.length, dir: "desc" },
  { key: "laps", value: (r) => r.laps, dir: "desc" },
];

/** The rows in the table's order: by the sort column, drivers with no value last. */
export function sortDriverRows(rows: DriverRow[], sort: DriverSort): DriverRow[] {
  const col = SORT_COLUMNS.find((c) => c.key === sort.key);
  const value = (r: DriverRow): number | string | null =>
    sort.key === "driver" ? r.driver ?? "" : sort.key === "car" ? r.carLabel : col ? col.value(r) : null;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "string" || typeof bv === "string") return dir * String(av).localeCompare(String(bv));
    return dir * (av - bv);
  });
}

const views = new WeakMap<RaceChartData, DriverReportView>();

export function setDriverReportView(data: RaceChartData, view: DriverReportView): void {
  views.set(data, view);
}

/** The view the tab last showed for this race's data, if it was opened. */
export function driverReportView(data: RaceChartData): DriverReportView | null {
  return views.get(data) ?? null;
}

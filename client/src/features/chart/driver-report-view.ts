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

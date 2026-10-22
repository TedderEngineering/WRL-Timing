/**
 * The Pit Stops tab and its PDF from one place: each car's stops summed up the same way, the stop
 * cells' colours (RaceTrace's gain and loss against the class pit cycle, amber for cautions), the
 * key and method text, the sortable columns, and the view on screen (class and sort) that the PDF
 * button prints as it is.
 */
import type { RaceChartData } from "@shared/types";
import { TRACE } from "./constants";
import type { PitStop } from "./PitAnalysisTab";

/**
 * A service stop (not a garage visit, drive-through or penalty): what the averages are over. The
 * stop count is every pit-lane visit, as every page counts them (the owner's rule).
 */
export const isServiceStop = (s: PitStop) => !s.kind || s.kind === "stop";
/** Made under a caution (in- or out-lap). */
export const isCautionStop = (s: PitStop) => /caution|fcy|yellow|mixed/i.test(s.condition ?? "") || !!s.isCautionContaminated;
/** Time in the pit lane (the analysis package's), or the legacy service time. */
export const laneTime = (s: PitStop) => s.pitRoadTime_s ?? s.serviceTime_s;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const nums = (xs: (number | null | undefined)[]) => xs.filter((v): v is number => typeof v === "number");

export interface PitRow {
  key: string;
  label: string;
  team: string;
  cls: string;
  /** Class finishing position (999 when unknown). */
  classPos: number;
  stops: PitStop[];
  /** Pit stops: every pit-lane visit. */
  visits: number;
  serviceStops: number;
  avgLane: number | null;
  /** Over green-flag service stops (under a caution, time lost is measured differently). */
  avgLost: number | null;
  best: number | null;
  worst: number | null;
}

export function pitRow(key: string, label: string, team: string, cls: string, classPos: number, stops: PitStop[]): PitRow {
  const sorted = [...stops].sort((a, b) => a.pitLap - b.pitLap);
  const service = sorted.filter(isServiceStop);
  const lost = nums(service.filter((s) => !isCautionStop(s)).map((s) => s.timeLost_s));
  return {
    key,
    label,
    team: team.replace(/\s*\([^()]*\)\s*$/, ""),
    cls,
    classPos,
    stops: sorted,
    visits: sorted.length,
    serviceStops: service.length,
    avgLane: mean(nums(service.map(laneTime))),
    avgLost: mean(lost),
    best: lost.length ? Math.min(...lost) : null,
    worst: lost.length ? Math.max(...lost) : null,
  };
}

/** A stop against the class's cars on the same pit cycle: 2 s or more either way counts. */
export function stopTone(s: PitStop): "quick" | "slow" | "even" | "other" {
  if (!isServiceStop(s)) return "other";
  const d = s.delta_s;
  if (d === null || d === undefined) return "even";
  return d <= -2 ? "quick" : d >= 2 ? "slow" : "even";
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const PIT_COLORS = {
  quick: hex(TRACE.gain),
  slow: hex(TRACE.loss),
  caution: hex(TRACE.fcyBar),
} as const;

export const PIT_KIND_LABEL: Record<string, string> = { garage: "Garage", stop_and_go: "Stop + go", penalty_served: "Penalty", drive_through: "Drive-thru", red_flag_hold: "Red flag", retirement: "Retired" };

export const PIT_KEY = {
  quick: "2 s or more quicker than the class's cars on the same cycle",
  slow: "2 s or more slower",
  caution: "Under caution",
  places: "Class places gained or lost over the pit cycle",
} as const;

export interface StopPlaces {
  /** Places gained (negative = lost). */
  net: number;
  before: number | null;
  after: number | null;
  over: "cycle" | "stop";
  /** The cycle never closed for the car: after is its last lap's place. */
  open?: boolean;
}

/** A stop's class places, when the race's analysis gives them (not on a later stop in the same cycle). */
export function stopPlaces(s: PitStop): StopPlaces | null {
  const net = s.netClass;
  if (typeof net !== "number" || !Number.isFinite(net)) return null;
  return { net, before: s.classPosBefore ?? null, after: s.classPosAfter ?? null, over: s.placesOver === "stop" ? "stop" : "cycle", ...(s.cycleOpen ? { open: true } : {}) };
}

/** "Class P5 → P3 over the pit cycle: gained 2". */
export function placesText(p: StopPlaces): string {
  const span = p.before !== null && p.after !== null ? `P${p.before} → P${p.after} ` : "";
  const what = p.net > 0 ? `gained ${p.net}` : p.net < 0 ? `lost ${-p.net}` : "held";
  return `Class ${span}over the ${p.over === "cycle" ? "pit cycle" : "stop"}: ${what}${p.open ? " (cycle not completed)" : ""}`;
}

export function pitMethod(facts: boolean): string {
  return (
    "Each stop: its in-lap, time in the pit lane, and time lost against a racing lap" +
    (facts ? ", coloured against the average of the class's cars on the same pit cycle" : ", against the car's own reference") +
    ". Averages count service stops only; time lost is averaged over green-flag stops. Garage visits and penalties are shown but not averaged." +
    (facts
      ? " The arrow on a stop: class places gained or lost, from before the class pit cycle opened to after it closed (on the car's first stop of the cycle; a garage visit or penalty: over the visit)."
      : "")
  );
}

export type PitSortKey = "classPos" | "car" | "team" | "stops" | "avgLane" | "avgLost" | "best" | "worst";
export interface PitSort {
  key: PitSortKey;
  dir: "asc" | "desc";
}
export const DEFAULT_PIT_SORT: PitSort = { key: "classPos", dir: "asc" };

export const PIT_SORTS: Record<PitSortKey, { value: (r: PitRow) => number | string | null; dir: "asc" | "desc"; name: string }> = {
  classPos: { value: (r) => (r.classPos >= 999 ? null : r.classPos), dir: "asc", name: "position" },
  car: { value: (r) => r.label, dir: "asc", name: "car" },
  team: { value: (r) => r.team, dir: "asc", name: "team" },
  stops: { value: (r) => r.visits, dir: "asc", name: "stops" },
  avgLane: { value: (r) => r.avgLane, dir: "asc", name: "average time in the pit lane" },
  avgLost: { value: (r) => r.avgLost, dir: "asc", name: "average time lost" },
  best: { value: (r) => r.best, dir: "asc", name: "best stop" },
  worst: { value: (r) => r.worst, dir: "asc", name: "worst stop" },
};

export function sortPits(rows: PitRow[], sort: PitSort): PitRow[] {
  const { value } = PIT_SORTS[sort.key];
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

/** "Sorted by average time lost, lowest first", or null for the class order. */
export function pitSortNote(sort: PitSort): string | null {
  if (sort.key === "classPos" && sort.dir === "asc") return null;
  const text = sort.key === "car" || sort.key === "team";
  return `Sorted by ${PIT_SORTS[sort.key].name}, ${text ? (sort.dir === "asc" ? "A to Z" : "Z to A") : sort.dir === "asc" ? "lowest first" : "highest first"}`;
}

export interface PitView {
  cls: string;
  sort: PitSort;
}
const views = new WeakMap<RaceChartData, PitView>();
export function setPitView(chart: RaceChartData, view: PitView): void {
  views.set(chart, view);
}
export function pitView(chart: RaceChartData): PitView | null {
  return views.get(chart) ?? null;
}

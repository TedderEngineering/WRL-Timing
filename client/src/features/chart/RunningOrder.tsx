import { useState } from "react";
import type { AnnotationData, CarData, PitMarker, RaceChartData } from "@shared/types";
import { carNo } from "./car-number";
import { formatLapTime, getCompColor } from "./chart-renderer";
import { CLASS_COLORS, TRACE } from "./constants";
import { isCleanLap } from "./gap-math";

const C = {
  bg: "#0b0b18",
  card: "#10101f",
  head: "#15152c",
  line: "#22223f",
  text: "#e0e0e8",
  muted: "#9a9ab4",
  pit: "#2563eb",
  pitText: "#93b4ff",
  /** Not running. */
  out: "#6b7280",
  personal: "#4ade80",
  classBest: "#e879f9",
};

/** A class's colour (the WRL classes have their own; any other a neutral grey). */
export function classColor(cls: string): string {
  return CLASS_COLORS[cls] ?? "#9a9ab4";
}

/** A car's visit to the pit lane now, as the map saw it. */
export interface PitVisit {
  /** The car's completed laps when it went in. */
  afterLap: number;
}

/** A car whose last lap ended this long (s) before the latest lap anyone completed is not running: OUT. */
export const OUT_AFTER_S = 15 * 60;

/**
 * The cars not running (retired, in the garage, parked): their last lap ended over OUT_AFTER_S
 * before the latest lap any car completed (a car's laps added up give the race time it last crossed
 * the line). Against the latest lap, not the clock: under a red flag nobody laps, nobody is OUT.
 */
export function outCars(data: RaceChartData): Set<number> {
  const crossed = new Map<number, number>();
  for (const [k, c] of Object.entries(data.cars)) crossed.set(Number(k), c.laps.reduce((t, l) => t + (l.ltSec > 0 ? l.ltSec : 0), 0));
  const latest = Math.max(0, ...crossed.values());
  return new Set([...crossed].filter(([, t]) => latest - t > OUT_AFTER_S).map(([k]) => k));
}

export interface OrderRow {
  key: number;
  /** Overall position now (null before the timing gives the car one). */
  pos: number | null;
  /** Position in class now. */
  posClass: number | null;
  cls: string;
  team: string;
}

/** The running order: cars by their position now, any without one after them by car number. */
export function runningOrder(data: RaceChartData): OrderRow[] {
  return Object.entries(data.cars)
    .map(([k, c]) => ({
      key: Number(k),
      pos: c.finishPos > 0 ? c.finishPos : null,
      posClass: c.finishPosClass > 0 ? c.finishPosClass : null,
      cls: c.cls,
      team: c.team,
    }))
    .sort(
      (a, b) =>
        (a.pos ?? 1e6) - (b.pos ?? 1e6) ||
        carNo(data, a.key).localeCompare(carNo(data, b.key), undefined, { numeric: true })
    );
}

/** A car's last completed lap and its best lap (seconds), or null before it has one. */
export function lapTimes(car: CarData | undefined): { last: number | null; best: number | null } {
  const xs = (car?.laps ?? []).filter((l) => l.ltSec > 0);
  if (!xs.length) return { last: null, best: null };
  return { last: xs[xs.length - 1].ltSec, best: Math.min(...xs.map((l) => l.ltSec)) };
}

/** Each class's best lap so far (seconds). */
export function classBests(data: RaceChartData): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of Object.values(data.cars)) {
    const { best } = lapTimes(c);
    if (best !== null && best < (out.get(c.cls) ?? Infinity)) out.set(c.cls, best);
  }
  return out;
}

/** What the Best column shows; tapping its title cycles through them. */
export type LapStat = "best" | "avg10" | "stint" | "race";
export const LAP_STATS: LapStat[] = ["best", "avg10", "stint", "race"];
export const LAP_STAT_LABEL: Record<LapStat, string> = {
  best: "Best",
  avg10: "10-Lap Avg",
  stint: "Stint Avg",
  race: "Race Avg",
};
const LAP_STAT_TITLE: Record<LapStat, string> = {
  best: "Best lap. Tap for the 10-lap average",
  avg10: "Average of the last 10 green laps (no pit, caution or out-laps). Tap for the stint average",
  stint: "Average of the green laps since the last pit stop. Tap for the race average",
  race: "Average of every green lap of the race. Tap for the best lap",
};

export function nextLapStat(s: LapStat): LapStat {
  return LAP_STATS[(LAP_STATS.indexOf(s) + 1) % LAP_STATS.length];
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * A car's value for the column (seconds), or null when it has none yet. Averages count green laps
 * only (gap-math isCleanLap: no pit lap, no out-lap, no caution, nothing over the green-pace
 * cutoff): the last 10 of them, those since the last pit lap, or all of them.
 */
export function lapStat(data: RaceChartData, car: CarData | undefined, stat: LapStat): number | null {
  if (stat === "best") return lapTimes(car).best;
  const laps = car?.laps ?? [];
  const clean = laps.filter((l) => isCleanLap(data, car, l.l));
  if (stat === "avg10") return mean(clean.slice(-10).map((l) => l.ltSec));
  if (stat === "race") return mean(clean.map((l) => l.ltSec));
  const lastPit = laps.reduce((m, l) => (l.pit ? Math.max(m, l.l) : m), 0);
  return mean(clean.filter((l) => l.l > lastPit).map((l) => l.ltSec));
}

/** Each class's lowest value of the column. */
export function classBestStat(data: RaceChartData, stat: LapStat): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of Object.values(data.cars)) {
    const v = lapStat(data, c, stat);
    if (v !== null && v < (out.get(c.cls) ?? Infinity)) out.set(c.cls, v);
  }
  return out;
}

const STAT_KEY = "rt_live_lap_stat";
function loadStat(): LapStat {
  try {
    const v = localStorage.getItem(STAT_KEY) as LapStat | null;
    return v && LAP_STATS.includes(v) ? v : "best";
  } catch {
    return "best";
  }
}
function saveStat(v: LapStat): void {
  try {
    localStorage.setItem(STAT_KEY, v);
  } catch {
    /* storage unavailable */
  }
}

/** A lap time (seconds) as M:SS.mmm. */
export function lapText(sec: number | null): string {
  if (sec === null) return "–";
  const m = Math.floor(sec / 60);
  return formatLapTime(`${m}:${(sec - m * 60).toFixed(3)}`);
}

/** How long, as M:SS (H:MM:SS from an hour). */
export function spanText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const ss = String(s % 60).padStart(2, "0");
  if (s < 3600) return `${Math.floor(s / 60)}:${ss}`;
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${ss}`;
}

/**
 * What to say about a car in the pit lane now: which stop this is (the timing may already have
 * recorded it from the in-lap; otherwise it is the next one), the lap it came in after and the
 * stint it ends.
 */
export function pitDetail(pits: PitMarker[] | undefined, visit: PitVisit): string {
  const stops = [...(pits ?? [])].sort((a, b) => a.l - b.l);
  const recorded = stops.findIndex((m) => m.l >= visit.afterLap);
  const stopNo = recorded >= 0 ? recorded + 1 : stops.length + 1;
  const before = stops.filter((m) => m.l < visit.afterLap);
  const stint = visit.afterLap - (before.length ? before[before.length - 1].l : 0);
  return [
    `Stop ${stopNo}`,
    visit.afterLap > 0 ? `in after lap ${visit.afterLap}` : null,
    stint > 0 ? `${stint}-lap stint` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * RaceTrace Live, beside the track map: the running order now. Position, number, class and place
 * in class, last and best lap (its title cycles best → 10-lap, stint and race averages), and stops, each row marked in its class colour. A car in the pit
 * lane carries a P and a line on its stop; a car not running (outCars) an OUT, its row dimmed.
 * Tapping a row makes it the focus car.
 */
export function RunningOrder({
  data,
  annotations,
  focusNum,
  setFocusNum,
  compSet,
  classView,
  pits,
  out,
}: {
  data: RaceChartData;
  annotations: AnnotationData | null;
  focusNum: number;
  setFocusNum: (n: number) => void;
  compSet: Set<number>;
  classView: string;
  /** The cars in the pit lane now, by chart key. */
  pits: Map<number, PitVisit>;
  /** The cars not running (outCars). */
  out: Set<number>;
}) {
  const rows = runningOrder(data);
  const [stat, setStat] = useState<LapStat>(loadStat);
  const cycleStat = () => {
    const n = nextLapStat(stat);
    setStat(n);
    saveStat(n);
  };
  const bests = classBestStat(data, stat);
  const th = "px-1.5 py-2 font-semibold";
  return (
    <div className="flex flex-col px-3 pb-3 pt-1 md:min-h-0 md:w-[440px] md:shrink-0 md:py-4 md:pl-2 md:pr-5 lg:w-[540px]">
      <div
        className="custom-scroll overflow-hidden rounded-lg border text-xs md:min-h-0 md:flex-1 md:overflow-y-auto"
        style={{ background: C.card, borderColor: C.line, color: C.text }}
      >
        <table className="w-full border-collapse tabular-nums">
          <thead className="sticky top-0 z-10" style={{ background: C.head, color: C.muted }}>
            <tr className="text-left">
              <th className={`${th} w-6 text-center`} aria-label="In the pits" />
              <th className={`${th} text-right`}>P</th>
              <th className={th}>#</th>
              <th className={th}>Class</th>
              <th className={`${th} text-right`} title="Position in class">
                PIC
              </th>
              <th className={`${th} text-right`}>Last</th>
              <th className={`${th} text-right`}>
                <button
                  type="button"
                  onClick={cycleStat}
                  title={LAP_STAT_TITLE[stat]}
                  aria-label={`${LAP_STAT_LABEL[stat]}. ${LAP_STAT_TITLE[stat]}`}
                  className="whitespace-nowrap font-semibold underline decoration-dotted underline-offset-4 hover:text-white"
                >
                  {LAP_STAT_LABEL[stat]}
                </button>
              </th>
              <th className={`${th} text-right`} title="Pit stops">
                Pits
              </th>
              <th className={`${th} hidden w-full sm:table-cell`}>Team</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const focus = r.key === focusNum;
              const compared = !focus && compSet.has(r.key);
              const other = !!classView && r.cls !== classView && !focus;
              const color = classColor(r.cls);
              const isOut = out.has(r.key);
              // A car not running gets OUT, not a pit stop.
              const visit = isOut ? undefined : pits.get(r.key);
              const carPits = annotations?.[String(r.key)]?.pits;
              const { last, best } = lapTimes(data.cars[String(r.key)]);
              const shown = stat === "best" ? best : lapStat(data, data.cars[String(r.key)], stat);
              const classBest = shown !== null && shown === bests.get(r.cls);
              const rowStyle = {
                borderColor: C.line,
                opacity: other ? 0.35 : isOut ? 0.55 : 1,
                background: focus ? "rgba(244,140,52,0.16)" : `${color}26`,
              };
              const cells = [
                <tr
                  key={r.key}
                  onClick={() => setFocusNum(r.key)}
                  className={`cursor-pointer hover:bg-white/5 ${visit ? "" : "border-b"}`}
                  style={rowStyle}
                  aria-current={focus ? "true" : undefined}
                >
                  <td className="px-1 py-1 text-center" style={{ borderLeft: `5px solid ${color}` }}>
                    {isOut ? (
                      <span className="inline-block rounded px-1 text-[9px] font-bold text-white" style={{ background: C.out }} title="Not running (no lap for over 15 minutes)">
                        OUT
                      </span>
                    ) : (
                      visit && (
                        <span className="inline-block rounded px-1 text-[10px] font-bold text-white" style={{ background: C.pit }} title="In the pits">
                          P
                        </span>
                      )
                    )}
                  </td>
                  <td className="px-1.5 py-1 text-right font-semibold">{r.pos ?? "–"}</td>
                  <td
                    className="px-1.5 py-1 font-bold"
                    style={{ color: focus ? TRACE.focus : compared ? getCompColor(compSet, focusNum, r.key) : C.text }}
                  >
                    {carNo(data, r.key)}
                  </td>
                  <td className="px-1.5 py-1">
                    <span className="rounded px-1 text-[10px] font-bold" style={{ background: color, color: C.bg }}>
                      {r.cls || "–"}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-right font-semibold" style={{ color }}>
                    {r.posClass ?? "–"}
                  </td>
                  <td
                    className="px-1.5 py-1 text-right"
                    style={{ color: last !== null && last === best ? C.personal : C.text }}
                    title={last !== null && last === best ? "Its best lap" : undefined}
                  >
                    {lapText(last)}
                  </td>
                  <td
                    className="px-1.5 py-1 text-right"
                    style={{ color: classBest ? C.classBest : C.muted }}
                    title={classBest ? (stat === "best" ? "Best lap in class" : `Quickest ${LAP_STAT_LABEL[stat]} in class`) : undefined}
                  >
                    {lapText(shown)}
                  </td>
                  <td className="px-1.5 py-1 text-right">{carPits?.length ?? 0}</td>
                  <td className="hidden max-w-0 truncate px-1.5 py-1 sm:table-cell" style={{ color: C.muted }} title={r.team}>
                    {r.team}
                  </td>
                </tr>,
              ];
              if (visit)
                cells.push(
                  <tr
                    key={`${r.key}-pit`}
                    onClick={() => setFocusNum(r.key)}
                    className="cursor-pointer border-b"
                    style={rowStyle}
                  >
                    <td className="p-0" style={{ borderLeft: `5px solid ${color}` }} />
                    <td colSpan={8} className="px-1.5 pb-1.5 pt-0 text-[11px]" style={{ color: C.pitText }}>
                      {pitDetail(carPits, visit)}
                    </td>
                  </tr>
                );
              return cells;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

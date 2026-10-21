/**
 * Driver Report: every driver of a class ranked on the average of their fastest racing laps
 * (driver-performance.ts), with the spread of those laps, a z-score against the class at the same
 * time, clear air, cars passed, laps driven and when in the race they drove.
 */
import { useEffect, useMemo, useState } from "react";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { CLASS_COLORS } from "./constants";
import { InfoTip } from "../../components/InfoTip";
import { DRIVER_COLUMNS, type DriverColumnId } from "./driver-report-columns";
import { DEFAULT_SORT, SORT_COLUMNS as COLUMNS, setDriverReportView, sortDriverRows, type DriverSort, type SortKey } from "./driver-report-view";
import {
  CLASS_LIMIT,
  CLEAR_GAP_S,
  DRIVER_LIMIT,
  driverPerformance,
  type ClassReport,
  type DriverRow,
} from "./driver-performance";

const S = {
  bg: "#0b0b18",
  card: "#12122a",
  row: "#101024",
  rowAlt: "#141430",
  line: "#1e1e38",
  border: "#3a3a5c",
  text: "#e0e0e8",
  soft: "#cbd5e1",
  muted: "#9a9ab4",
  accent: "#F48C34",
  clear: "#22c55e",
  traffic: "#8b5cf6",
  band: "#2a2a4a",
  focus: "rgba(244,140,52,0.12)",
} as const;

const DIST_W = 280;
/** Room either side of the axis for its first and last labels. */
const DIST_PAD = 16;
const TRACK_W = 150;
const ROW_H = 24;

function lapText(s: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

function axisText(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${(Number.isInteger(sec) ? String(sec) : sec.toFixed(1)).padStart(2, "0")}`;
}

export interface DriverReportTabProps {
  data: RaceChartData;
  annotations: AnnotationData;
  focusNum: number;
  setFocusNum: (n: number) => void;
}

export function DriverReportTab({ data, annotations, focusNum, setFocusNum }: DriverReportTabProps) {
  const reports = useMemo(() => driverPerformance(data, annotations), [data, annotations]);
  const focusCls = data.cars[String(focusNum)]?.cls;
  const [cls, setCls] = useState<string>(() => (focusCls && reports.some((r) => r.cls === focusCls) ? focusCls : reports[0]?.cls ?? ""));
  const [sort, setSort] = useState<DriverSort>(DEFAULT_SORT);
  const report = reports.find((r) => r.cls === cls) ?? reports[0];

  const rows = useMemo(() => (report ? sortDriverRows(report.rows, sort) : []), [report, sort]);
  // The PDF button prints the table as it is now: this class, this order.
  useEffect(() => {
    if (report) setDriverReportView(data, { cls: report.cls, sort });
  }, [data, report, sort]);

  if (!report) {
    return <p className="px-6 py-8 text-sm" style={{ color: S.muted }}>No laps to report for this race.</p>;
  }

  const hasMake = report.rows.some((r) => r.make);
  const sortBy = (key: SortKey, dir: "asc" | "desc") =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir }));
  const head = (key: SortKey & DriverColumnId, dir: "asc" | "desc", align: "left" | "right" = "right", sticky = false) => (
    <th
      key={key}
      onClick={() => sortBy(key, dir)}
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 text-[11px] font-semibold uppercase tracking-wider${sticky ? " sticky left-0 z-10" : ""}`}
      style={{ color: sort.key === key ? S.text : S.muted, textAlign: align, background: sticky ? S.card : undefined }}
      aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {DRIVER_COLUMNS[key].name}
      {sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
      {DRIVER_COLUMNS[key].tip && <InfoTip label={DRIVER_COLUMNS[key].name} text={DRIVER_COLUMNS[key].tip} />}
    </th>
  );
  const plainHead = (id: DriverColumnId, width: number) => (
    <th className="whitespace-nowrap px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: S.muted, width }}>
      {DRIVER_COLUMNS[id].name}
      {DRIVER_COLUMNS[id].tip && <InfoTip label={DRIVER_COLUMNS[id].name} text={DRIVER_COLUMNS[id].tip} />}
    </th>
  );

  return (
    <div className="px-2 py-3 sm:px-6" style={{ color: S.text }}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="m-0 text-base font-semibold">Driver performance</h2>
        <span className="text-sm" style={{ color: S.muted }}>
          Fastest racing laps (at most half of each driver's laps) · {report.cls} · {report.rows.length} drivers
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Class">
        {reports.map((r) => {
          const active = r.cls === report.cls;
          const color = CLASS_COLORS[r.cls] ?? S.accent;
          return (
            <button
              key={r.cls}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCls(r.cls)}
              className="rounded-md border px-3 py-1 text-xs font-semibold"
              style={{ borderColor: active ? color : S.border, background: active ? `${color}22` : S.card, color: active ? S.text : S.muted }}
            >
              {r.cls}
            </button>
          );
        })}
      </div>

      <div className="custom-scroll overflow-x-auto rounded-lg border" style={{ borderColor: S.line, background: S.card }}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr style={{ borderBottom: `1px solid ${S.border}` }}>
              {head("driver", "asc", "left", true)}
              {head("car", "asc", "left")}
              {hasMake && <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: S.muted }}>Make</th>}
              {plainHead("spread", DIST_W)}
              {COLUMNS.map((c) => head(c.key, c.dir))}
              {plainHead("track", TRACK_W)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const focus = r.carKey === String(focusNum);
              return (
                <tr
                  key={`${r.carKey}:${r.driver ?? ""}`}
                  onClick={() => setFocusNum(Number(r.carKey))}
                  className="cursor-pointer"
                  style={{ background: focus ? S.focus : i % 2 ? S.rowAlt : S.row, height: ROW_H }}
                >
                  {/* The driver stays in view while the row scrolls sideways on a phone. */}
                  <td className="sticky left-0 z-10 whitespace-nowrap px-2 font-medium" style={{ background: focus ? "#2a1d1a" : i % 2 ? S.rowAlt : S.row }}>
                    {r.driver ?? <span style={{ color: S.muted }}>Driver not named</span>}
                  </td>
                  <td className="max-w-[220px] truncate whitespace-nowrap px-2" title={`#${r.carLabel} ${r.team}`}>
                    <span className="font-mono font-semibold" style={{ color: CLASS_COLORS[r.cls] ?? S.accent }}>#{r.carLabel}</span>{" "}
                    <span className="hidden sm:inline" style={{ color: S.soft }}>{r.team}</span>
                  </td>
                  {hasMake && <td className="whitespace-nowrap px-2" style={{ color: S.soft }}>{r.make ?? ""}</td>}
                  <td className="px-2 py-0.5">
                    <Distribution row={r} report={report} />
                  </td>
                  <Num v={r.avgLap ? lapText(r.avgLap) : "—"} strong />
                  <Num v={r.fastLap ? lapText(r.fastLap) : "—"} color={S.clear} />
                  <Num v={r.shown.length ? r.stdDev.toFixed(3) : "—"} />
                  <Num v={r.avgZ === null ? "—" : r.avgZ.toFixed(2)} />
                  <Num v={r.clearAirPct === null ? "—" : `${Math.round(r.clearAirPct)}%`} />
                  <Num v={String(r.overtakes)} />
                  <Num v={String(r.shown.length)} />
                  <Num v={`${r.laps} (${Math.round(r.lapsPct)}%)`} />
                  <td className="px-2 py-0.5">
                    <TimeOnTrack row={r} raceS={report.raceS} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={hasMake ? 3 : 2} />
              <td className="px-2 pb-2 pt-1">
                <AxisLabels report={report} />
              </td>
              <td colSpan={COLUMNS.length} />
              <td className="px-2 pb-2 pt-1">
                <div className="flex justify-between text-[10px]" style={{ color: S.muted, width: TRACK_W }}>
                  <span>Start</span>
                  <span>{Math.round(report.raceS / 3600)} h</span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: S.muted }}>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" fill={S.clear} /></svg> Clean air
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden><path d="M5 0.5 L9.5 5 L5 9.5 L0.5 5 Z" fill={S.traffic} /></svg> Car within {CLEAR_GAP_S} s ahead
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="12" aria-hidden><rect x="1" y="1" width="8" height="10" fill="none" stroke={S.text} strokeWidth="1.5" /></svg> Fastest lap
        </span>
      </div>
      <p className="mt-2 max-w-4xl text-xs leading-relaxed" style={{ color: S.muted }}>
        Drivers are ranked on the average of their fastest laps, at most half of the laps they drove. Lap 1, pit in- and out-laps
        and laps under caution don't count, nor do laps slower than {Math.round((CLASS_LIMIT - 1) * 100)}% over the class's fastest
        or {Math.round((DRIVER_LIMIT - 1) * 100)}% over the driver's own fastest. The z-score compares each lap with the class's
        laps from the same part of the race. Clean air and passes come from timing-line crossings, so they may miss some passes and
        traffic between the lines.
      </p>
    </div>
  );
}

function Num({ v, strong, color }: { v: string; strong?: boolean; color?: string }) {
  return (
    <td className="whitespace-nowrap px-2 text-right font-mono" style={{ fontWeight: strong ? 700 : 400, color: color ?? S.text }}>
      {v}
    </td>
  );
}

function xOf(t: number, report: ClassReport): number {
  const { min, max } = report.axis;
  const span = max - min || 1;
  return DIST_PAD + ((Math.min(Math.max(t, min), max) - min) / span) * (DIST_W - 2 * DIST_PAD);
}

function ticks(report: ClassReport): number[] {
  const out: number[] = [];
  for (let t = report.axis.min; t <= report.axis.max + 1e-6; t += report.axis.step) out.push(t);
  return out;
}

function Distribution({ row, report }: { row: DriverRow; report: ClassReport }) {
  const h = ROW_H - 4;
  const mid = h / 2;
  const times = row.shown.map((s) => s.t);
  return (
    <svg width={DIST_W} height={h} role="img" aria-label={`${row.shown.length} laps from ${lapText(Math.min(...times))} to ${lapText(Math.max(...times))}`}>
      {ticks(report).map((t) => (
        <line key={t} x1={xOf(t, report)} x2={xOf(t, report)} y1={0} y2={h} stroke={S.line} strokeWidth={1} />
      ))}
      {times.length > 0 && (
        <>
          <line x1={xOf(Math.min(...times), report)} x2={xOf(Math.max(...times), report)} y1={mid} y2={mid} stroke={S.band} strokeWidth={6} strokeLinecap="round" />
          {row.shown.map((s) => {
            const x = xOf(s.t, report);
            return s.clear === false ? (
              <path key={s.l} d={`M${x} ${mid - 3.6} L${x + 3.6} ${mid} L${x} ${mid + 3.6} L${x - 3.6} ${mid} Z`} fill={S.traffic} opacity={0.85}>
                <title>{`Lap ${s.l}: ${lapText(s.t)}, car ahead`}</title>
              </path>
            ) : (
              <circle key={s.l} cx={x} cy={mid} r={3.2} fill={S.clear} opacity={0.85}>
                <title>{`Lap ${s.l}: ${lapText(s.t)}${s.clear ? ", clean air" : ""}`}</title>
              </circle>
            );
          })}
          <rect x={xOf(row.fastLap, report) - 3} y={mid - 6} width={6} height={12} fill="none" stroke={S.text} strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}

function AxisLabels({ report }: { report: ClassReport }) {
  return (
    <svg width={DIST_W} height={14} aria-hidden>
      {ticks(report).map((t) => (
        <text key={t} x={xOf(t, report)} y={11} textAnchor="middle" fontSize={10} fill={S.muted}>
          {axisText(t)}
        </text>
      ))}
    </svg>
  );
}

/** The race from start to flag, the driver's stints shaded lighter early and darker late. */
function TimeOnTrack({ row, raceS }: { row: DriverRow; raceS: number }) {
  const h = ROW_H - 6;
  const x = (s: number) => (raceS > 0 ? (s / raceS) * TRACK_W : 0);
  const shade = (s: number) => {
    const f = raceS > 0 ? Math.min(1, Math.max(0, s / raceS)) : 0;
    const light = 72 - f * 30; // lightness from 72% to 42%
    return `hsl(212 70% ${light}%)`;
  };
  return (
    <svg width={TRACK_W} height={h} role="img" aria-label="When the driver was on track">
      <rect x={0} y={0} width={TRACK_W} height={h} fill={S.line} />
      {row.onTrack.map(([a, b], i) => (
        <rect key={i} x={x(a)} y={1} width={Math.max(1.5, x(b) - x(a))} height={h - 2} fill={shade((a + b) / 2)}>
          <title>{`${Math.floor(a / 3600)}:${String(Math.floor((a % 3600) / 60)).padStart(2, "0")} to ${Math.floor(b / 3600)}:${String(Math.floor((b % 3600) / 60)).padStart(2, "0")} into the race`}</title>
        </rect>
      ))}
      {row.stoppedAtS !== null && (
        <text x={Math.min(x(row.stoppedAtS) + 3, TRACK_W - 24)} y={h - 5} fontSize={9} fontWeight={700} fill="#ef4444">
          DNF
        </text>
      )}
    </svg>
  );
}

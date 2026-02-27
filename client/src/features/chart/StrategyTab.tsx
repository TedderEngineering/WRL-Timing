import { useMemo, useState } from "react";
import type { RaceChartData, AnnotationData } from "@shared/types";
import { CHART_STYLE, CLASS_COLORS } from "./constants";
import { computeStrategyMetrics, type StrategyMetrics } from "./strategy-engine";

// ─── Format helpers ─────────────────────────────────────────────────────────

/** Seconds → M:SS.m (one decimal on fractional seconds) */
function fmtPace(s: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ":" + sec.toFixed(1).padStart(4, "0");
}

/** Seconds → M:SS (whole seconds) */
function fmtPit(s: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return m + ":" + String(sec).padStart(2, "0");
}

/** Seconds → SS.m (one decimal, no minutes) */
function fmtAvgPit(s: number): string {
  if (!s) return "—";
  return s.toFixed(1);
}

/** Percentage with 0 decimals */
function fmtPct(v: number): string {
  return Math.round(v) + "%";
}

// ─── Column definitions ─────────────────────────────────────────────────────

type SortKey = keyof StrategyMetrics;

interface Column {
  key: SortKey;
  label: string;
  shortLabel?: string;
  fmt: (m: StrategyMetrics) => string;
  align: "left" | "right";
  mono: boolean;
  width?: string;
}

const COLUMNS: Column[] = [
  { key: "classPos", label: "Pos", fmt: (m) => `P${m.classPos}`, align: "right", mono: true, width: "48px" },
  { key: "carNum", label: "Car #", fmt: (m) => `#${m.carNum}`, align: "left", mono: true, width: "60px" },
  { key: "team", label: "Team", fmt: (m) => m.team, align: "left", mono: false },
  { key: "stintCount", label: "Stints", fmt: (m) => String(m.stintCount), align: "right", mono: true, width: "56px" },
  { key: "avgGreenPace", label: "Avg Pace", fmt: (m) => fmtPace(m.avgGreenPace), align: "right", mono: true, width: "80px" },
  { key: "bestLap", label: "Best Lap", fmt: (m) => fmtPace(m.bestLap), align: "right", mono: true, width: "80px" },
  { key: "totalPitTime", label: "Pit Time", fmt: (m) => fmtPit(m.totalPitTime), align: "right", mono: true, width: "72px" },
  { key: "avgPitDuration", label: "Avg Pit", shortLabel: "Avg Pit", fmt: (m) => fmtAvgPit(m.avgPitDuration), align: "right", mono: true, width: "64px" },
  { key: "yellowPitPct", label: "Yel Pits", fmt: (m) => fmtPct(m.yellowPitPct), align: "right", mono: true, width: "68px" },
  { key: "strategyScore", label: "Score", fmt: (m) => String(m.strategyScore), align: "right", mono: true, width: "56px" },
];

// ─── Props ──────────────────────────────────────────────────────────────────

interface StrategyTabProps {
  data: RaceChartData;
  annotations: AnnotationData;
  classView: string;
  setClassView: React.Dispatch<React.SetStateAction<string>>;
  focusNum: number;
  setFocusNum: React.Dispatch<React.SetStateAction<number>>;
  onSwitchToTrace: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function StrategyTab({
  data, annotations,
  classView, setClassView,
  focusNum, setFocusNum,
  onSwitchToTrace,
}: StrategyTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>("classPos");
  const [sortAsc, setSortAsc] = useState(true);

  // Compute all metrics once
  const allMetrics = useMemo(
    () => computeStrategyMetrics(data, annotations),
    [data, annotations],
  );

  // Filter by class and sort
  const rows = useMemo(() => {
    let filtered = classView
      ? allMetrics.filter((m) => m.cls === classView)
      : allMetrics;

    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const na = av as number;
      const nb = bv as number;
      return sortAsc ? na - nb : nb - na;
    });
    return sorted;
  }, [allMetrics, classView, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const handleRowClick = (carNum: number) => {
    setFocusNum(carNum);
    onSwitchToTrace();
  };

  return (
    <div className="flex flex-col gap-1.5" style={{ background: CHART_STYLE.bg, color: CHART_STYLE.text }}>
      {/* Class selector */}
      <div className="px-1">
        <div className="shrink-0" style={{ minWidth: 140, maxWidth: 240 }}>
          <label
            className="block text-[11px] uppercase tracking-wider font-semibold mb-0.5"
            style={{ color: CHART_STYLE.muted }}
          >
            Class View
          </label>
          <select
            value={classView}
            onChange={(e) => setClassView(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md text-sm font-mono text-white border cursor-pointer appearance-none"
            style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border }}
          >
            <option value="">All Classes ({data.totalCars})</option>
            {Object.entries(data.classGroups)
              .sort()
              .map(([cls, cars]) => (
                <option key={cls} value={cls}>
                  {cls} ({cars.length} cars)
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-lg border overflow-x-auto"
        style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border }}
      >
        <table className="w-full border-collapse" style={{ minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${CHART_STYLE.border}` }}>
              {COLUMNS.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="px-2 py-2 text-[11px] uppercase tracking-wider font-semibold cursor-pointer select-none whitespace-nowrap"
                    style={{
                      textAlign: col.align,
                      color: active ? CHART_STYLE.text : CHART_STYLE.muted,
                      background: active ? CHART_STYLE.border + "60" : undefined,
                      width: col.width,
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.shortLabel ?? col.label}
                      {active && (
                        <span style={{ fontSize: 9 }}>
                          {sortAsc ? "▲" : "▼"}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const isFocus = m.carNum === focusNum;
              const clsColor = CLASS_COLORS[m.cls] || "#4472C4";
              return (
                <tr
                  key={m.carNum}
                  onClick={() => handleRowClick(m.carNum)}
                  className="cursor-pointer transition-colors"
                  style={{
                    borderBottom: `1px solid ${CHART_STYLE.border}`,
                    background: isFocus ? clsColor + "18" : undefined,
                  }}
                  onMouseEnter={(e) => {
                    if (!isFocus) e.currentTarget.style.background = CHART_STYLE.border + "40";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isFocus ? clsColor + "18" : "";
                  }}
                >
                  {COLUMNS.map((col) => {
                    const val = col.fmt(m);
                    // Special rendering for Car # column: colored badge
                    if (col.key === "carNum") {
                      return (
                        <td key={col.key} className="px-2 py-1.5">
                          <span
                            className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold"
                            style={{
                              background: clsColor + "25",
                              color: clsColor,
                              border: `1px solid ${clsColor}40`,
                            }}
                          >
                            {val}
                          </span>
                        </td>
                      );
                    }
                    // Team column: truncate
                    if (col.key === "team") {
                      return (
                        <td
                          key={col.key}
                          className="px-2 py-1.5 text-xs truncate max-w-[200px]"
                          style={{ color: isFocus ? "#fff" : CHART_STYLE.text }}
                          title={val}
                        >
                          {val}
                        </td>
                      );
                    }
                    // Score column: color coded
                    if (col.key === "strategyScore") {
                      const sc = m.strategyScore;
                      const scoreColor = sc >= 70 ? "#4ade80" : sc >= 40 ? "#fbbf24" : "#f87171";
                      return (
                        <td
                          key={col.key}
                          className="px-2 py-1.5 text-xs font-mono font-bold"
                          style={{ textAlign: col.align, color: scoreColor }}
                        >
                          {val}
                        </td>
                      );
                    }
                    return (
                      <td
                        key={col.key}
                        className={`px-2 py-1.5 text-xs ${col.mono ? "font-mono" : ""}`}
                        style={{ textAlign: col.align, color: CHART_STYLE.text }}
                      >
                        {val}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footnote */}
      <div
        className="px-3 py-2 rounded-md text-[11px] leading-relaxed border"
        style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, color: CHART_STYLE.dim }}
      >
        Score: 40% pace + 30% yellow pit timing + 20% pit efficiency + 10% consistency.
        Click any row to view that car on the position trace.
      </div>
    </div>
  );
}

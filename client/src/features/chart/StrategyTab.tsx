import { useMemo, useState } from "react";
import type { RaceChartData, AnnotationData } from "@shared/types";
import { CLASS_COLORS } from "./constants";
import {
  computeStrategyMetrics,
  computeRaceConditions,
  computeClassStats,
  computeInsights,
  type StrategyMetrics,
  type StintData,
} from "./strategy-engine";

// ─── Format helpers ─────────────────────────────────────────────────────────

function fmtPace(s: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ":" + sec.toFixed(1).padStart(4, "0");
}

function fmtPaceFull(s: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ":" + sec.toFixed(3).padStart(6, "0");
}

function fmtTime(s: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ":" + sec.toFixed(3).padStart(6, "0");
}

// ─── Table column definitions ───────────────────────────────────────────────

type SortKey = string;

interface Column {
  key: SortKey;
  label: string;
  getValue: (m: StrategyMetrics) => number | string;
  fmt: (m: StrategyMetrics) => string;
  type: "num" | "str";
  defaultDir: "asc" | "desc";
  width?: string;
}

const COLUMNS: Column[] = [
  { key: "classPos", label: "Pos", getValue: (m) => m.classPos, fmt: (m) => `P${m.classPos}`, type: "num", defaultDir: "asc", width: "48px" },
  { key: "carNum", label: "Car", getValue: (m) => m.carNum, fmt: (m) => `#${m.carNum}`, type: "num", defaultDir: "asc", width: "56px" },
  { key: "team", label: "Team", getValue: (m) => m.team, fmt: (m) => m.team, type: "str", defaultDir: "asc" },
  { key: "lapsCompleted", label: "Laps", getValue: (m) => m.lapsCompleted, fmt: (m) => String(m.lapsCompleted), type: "num", defaultDir: "desc", width: "52px" },
  { key: "stintCount", label: "Stops", getValue: (m) => m.stintCount - 1, fmt: (m) => String(m.stintCount - 1), type: "num", defaultDir: "asc", width: "52px" },
  { key: "avgGreenPace", label: "Avg Pace", getValue: (m) => m.avgGreenPace || 99999, fmt: (m) => fmtPace(m.avgGreenPace), type: "num", defaultDir: "asc", width: "80px" },
  { key: "bestLap", label: "Best Lap", getValue: (m) => m.bestLap || 99999, fmt: (m) => fmtPace(m.bestLap), type: "num", defaultDir: "asc", width: "80px" },
  { key: "totalPitTime", label: "Pit Time", getValue: (m) => m.totalPitTime, fmt: (m) => fmtTime(m.totalPitTime), type: "num", defaultDir: "asc", width: "80px" },
  { key: "pitPct", label: "Pit %", getValue: (m) => m.pitPct, fmt: (m) => m.pitPct.toFixed(1) + "%", type: "num", defaultDir: "asc", width: "56px" },
  { key: "yellowPitPct", label: "Yellow Pits", getValue: (m) => m.yellowPitPct, fmt: (m) => m.yellowPitPct.toFixed(0) + "%", type: "num", defaultDir: "desc", width: "76px" },
  { key: "avgStintLen", label: "Avg Stint", getValue: (m) => m.avgStintLen, fmt: (m) => m.avgStintLen.toFixed(1) + "L", type: "num", defaultDir: "desc", width: "68px" },
  { key: "maxStintLen", label: "Max Stint", getValue: (m) => m.maxStintLen, fmt: (m) => m.maxStintLen + "L", type: "num", defaultDir: "desc", width: "68px" },
  { key: "strategyScore", label: "Strategy Score", getValue: (m) => m.strategyScore, fmt: (m) => m.strategyScore.toFixed(1), type: "num", defaultDir: "desc", width: "130px" },
];

// ─── Inline style constants (matching reference design) ─────────────────────

const S = {
  bg: "#07080e",
  bg2: "#0c0e18",
  card: "#111425",
  bdr: "#1a1e36",
  bdr2: "#262b4a",
  txt: "#d0d4e8",
  txt2: "#8890b5",
  dim: "#555e88",
  acc: "#4a9eff",
  acc2: "#7b61ff",
  grn: "#22c55e",
  yel: "#eab308",
  red: "#ef4444",
  pit: "#ff6b9d",
} as const;

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
  setFocusNum,
  onSwitchToTrace,
}: StrategyTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>("classPos");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedCar, setSelectedCar] = useState<number | null>(null);

  // Compute all data
  const allMetrics = useMemo(() => computeStrategyMetrics(data, annotations), [data, annotations]);
  const conditions = useMemo(() => computeRaceConditions(data), [data]);
  const classStats = useMemo(() => computeClassStats(data, allMetrics), [data, allMetrics]);
  const allInsights = useMemo(() => computeInsights(data, allMetrics), [data, allMetrics]);

  // Determine active class
  const classes = Object.keys(data.classGroups).sort();
  const activeClass = classView; // "" means all classes

  // Filter by class
  const classMetrics = useMemo(
    () => activeClass ? allMetrics.filter((m) => m.cls === activeClass) : allMetrics,
    [allMetrics, activeClass],
  );

  // Sort
  const rows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col) return classMetrics;
    return [...classMetrics].sort((a, b) => {
      const av = col.getValue(a);
      const bv = col.getValue(b);
      const dir = sortDir === "asc" ? 1 : -1;
      if (typeof av === "string" && typeof bv === "string") return dir * av.localeCompare(bv);
      return dir * ((av as number) - (bv as number));
    });
  }, [classMetrics, sortKey, sortDir]);

  // Insights for active class
  const insights = useMemo(
    () => activeClass ? allInsights.filter((i) => i.cls === activeClass) : allInsights,
    [allInsights, activeClass],
  );

  const stats = classStats[activeClass];
  const selectedMetrics = selectedCar != null ? allMetrics.find((m) => m.carNum === selectedCar) : null;

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      const col = COLUMNS.find((c) => c.key === key);
      setSortKey(key);
      setSortDir(col?.defaultDir ?? "asc");
    }
  };

  const handleRowClick = (carNum: number) => {
    setSelectedCar(selectedCar === carNum ? null : carNum);
  };

  const handleGoToTrace = (carNum: number) => {
    setFocusNum(carNum);
    onSwitchToTrace();
  };

  return (
    <div style={{ color: S.txt, fontFamily: "'Outfit', system-ui, sans-serif" }}>
      {/* ── Conditions cards ─────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
        <CondCard label="Total Cars" value={String(data.totalCars)} color={S.acc} />
        <CondCard label="Leader Laps" value={String(conditions.totalLaps)} color={S.acc} />
        <CondCard label="Green Laps" value={`${conditions.greenLaps} (${(100 - conditions.pctYellow).toFixed(0)}%)`} color={S.grn} />
        <CondCard label="Yellow Laps" value={`${conditions.yellowLaps} (${conditions.pctYellow.toFixed(0)}%)`} color={S.yel} />
        {stats && (
          <>
            <CondCard label={`${activeClass} Cars`} value={String(stats.count)} color={S.acc} />
            <CondCard label={`${activeClass} Best Pace`} value={fmtPaceFull(stats.bestPace)} color={S.grn} mono />
            <CondCard label={`${activeClass} Avg Stops`} value={stats.avgStops.toFixed(1)} color={S.acc} />
            <CondCard label={`${activeClass} Avg Stint`} value={stats.avgStint.toFixed(1) + "L"} color={S.acc} />
          </>
        )}
      </div>

      {/* ── Class tabs (pills) ───────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => {
            setClassView("");
            setSelectedCar(null);
            setSortKey("classPos");
            setSortDir("asc");
          }}
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: "0.8rem",
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            background: activeClass === "" ? S.acc : S.bg2,
            border: `1px solid ${activeClass === "" ? S.acc : S.bdr}`,
            color: activeClass === "" ? "#fff" : S.dim,
            transition: "all .2s",
          }}
        >
          All
        </button>
        {classes.map((cls) => {
          const isActive = cls === activeClass;
          return (
            <button
              key={cls}
              onClick={() => {
                setClassView(cls);
                setSelectedCar(null);
                setSortKey("classPos");
                setSortDir("asc");
              }}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                background: isActive ? (CLASS_COLORS[cls] || S.acc) : S.bg2,
                border: `1px solid ${isActive ? (CLASS_COLORS[cls] || S.acc) : S.bdr}`,
                color: isActive ? "#fff" : S.dim,
                transition: "all .2s",
              }}
            >
              {cls}
            </button>
          );
        })}
      </div>

      {/* ── Insights ─────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
          {insights.map((ins, i) => (
            <div
              key={i}
              style={{
                background: S.card,
                border: `1px solid ${S.bdr}`,
                borderRadius: 10,
                padding: "14px 18px",
                borderLeft: `3px solid ${S.acc2}`,
              }}
            >
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: S.acc, marginBottom: 4 }}>
                {ins.title}
              </div>
              <div style={{ fontSize: "0.82rem", color: S.txt2, lineHeight: 1.55 }}>
                {ins.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Strategy Leaderboard header ──────────────────────────── */}
      <div style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        Strategy Leaderboard
        <span style={{ fontSize: "0.72rem", color: S.dim, fontWeight: 400 }}>
          — {rows.length} cars{activeClass ? ` in ${activeClass}` : ""}
        </span>
        <span style={{ flex: 1, height: 1, background: S.bdr }} />
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      <div
        style={{
          overflowX: "auto",
          marginBottom: 24,
          borderRadius: 10,
          border: `1px solid ${S.bdr}`,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const isSorted = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      background: S.bg2,
                      color: isSorted ? S.acc : S.txt2,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      fontSize: "0.68rem",
                      padding: "10px 12px",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                      borderBottom: `1px solid ${S.bdr2}`,
                      cursor: "pointer",
                      userSelect: "none",
                      width: col.width,
                      transition: "color .15s",
                    }}
                  >
                    {col.label}
                    <span
                      style={{
                        display: "inline-block",
                        marginLeft: 4,
                        fontSize: "0.6rem",
                        opacity: isSorted ? 1 : 0.3,
                        transition: "opacity .15s, transform .15s",
                        transform: isSorted && sortDir === "desc" ? "rotate(180deg)" : undefined,
                      }}
                    >
                      ▲
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const isSelected = m.carNum === selectedCar;
              const clsColor = CLASS_COLORS[m.cls] || S.acc;
              return (
                <tr
                  key={m.carNum}
                  onClick={() => handleRowClick(m.carNum)}
                  style={{
                    cursor: "pointer",
                    background: isSelected ? "rgba(74,158,255,0.08)" : undefined,
                    transition: "background .15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "rgba(74,158,255,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isSelected ? "rgba(74,158,255,0.08)" : "";
                  }}
                >
                  {COLUMNS.map((col) => {
                    const val = col.fmt(m);
                    // Position column
                    if (col.key === "classPos") {
                      return (
                        <td key={col.key} style={{ padding: "8px 12px", borderBottom: `1px solid ${S.bdr}`, whiteSpace: "nowrap" }}>
                          <span style={{ fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: S.acc, fontSize: "0.9rem" }}>
                            {val}
                          </span>
                        </td>
                      );
                    }
                    // Car number
                    if (col.key === "carNum") {
                      return (
                        <td key={col.key} style={{ padding: "8px 12px", borderBottom: `1px solid ${S.bdr}`, whiteSpace: "nowrap" }}>
                          <span style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontWeight: 700,
                            background: clsColor + "20",
                            color: clsColor,
                            padding: "2px 8px",
                            borderRadius: 4,
                            display: "inline-block",
                          }}>
                            {val}
                          </span>
                        </td>
                      );
                    }
                    // Team column
                    if (col.key === "team") {
                      return (
                        <td key={col.key} style={{
                          padding: "8px 12px",
                          borderBottom: `1px solid ${S.bdr}`,
                          maxWidth: 180,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {val}
                        </td>
                      );
                    }
                    // Best Lap column
                    if (col.key === "bestLap") {
                      return (
                        <td key={col.key} style={{
                          padding: "8px 12px",
                          borderBottom: `1px solid ${S.bdr}`,
                          whiteSpace: "nowrap",
                          fontFamily: "'JetBrains Mono', monospace",
                          color: S.grn,
                        }}>
                          {val}
                        </td>
                      );
                    }
                    // Yellow Pits column - tag style
                    if (col.key === "yellowPitPct") {
                      const pct = m.yellowPitPct;
                      const isYellow = pct >= 50;
                      return (
                        <td key={col.key} style={{ padding: "8px 12px", borderBottom: `1px solid ${S.bdr}`, whiteSpace: "nowrap" }}>
                          <span style={{
                            fontSize: "0.65rem",
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontWeight: 700,
                            display: "inline-block",
                            background: isYellow ? "rgba(234,179,8,0.15)" : "rgba(34,197,94,0.15)",
                            color: isYellow ? S.yel : S.grn,
                          }}>
                            {val}
                          </span>
                        </td>
                      );
                    }
                    // Strategy score column with bar
                    if (col.key === "strategyScore") {
                      return (
                        <td key={col.key} style={{
                          padding: "8px 12px",
                          borderBottom: `1px solid ${S.bdr}`,
                          whiteSpace: "nowrap",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          {val}
                          <span style={{
                            height: 6,
                            borderRadius: 3,
                            background: S.bdr,
                            overflow: "hidden",
                            width: 80,
                            display: "inline-block",
                            verticalAlign: "middle",
                            marginLeft: 6,
                          }}>
                            <span style={{
                              height: "100%",
                              borderRadius: 3,
                              background: `linear-gradient(90deg, ${S.acc}, ${S.acc2})`,
                              display: "block",
                              width: `${Math.min(100, Math.max(0, m.strategyScore))}%`,
                            }} />
                          </span>
                        </td>
                      );
                    }
                    // Default numeric cell
                    return (
                      <td key={col.key} style={{
                        padding: "8px 12px",
                        borderBottom: `1px solid ${S.bdr}`,
                        whiteSpace: "nowrap",
                        fontFamily: col.type === "num" ? "'JetBrains Mono', monospace" : undefined,
                      }}>
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

      {/* ── Detail Panel ─────────────────────────────────────────── */}
      {selectedMetrics && (
        <DetailPanel
          m={selectedMetrics}
          totalLaps={conditions.totalLaps}
          onClose={() => setSelectedCar(null)}
          onGoToTrace={() => handleGoToTrace(selectedMetrics.carNum)}
          activeClass={activeClass}
        />
      )}
    </div>
  );
}

// ─── Condition Card ──────────────────────────────────────────────────────────

function CondCard({ label, value, color, mono }: { label: string; value: string; color: string; mono?: boolean }) {
  return (
    <div style={{
      background: S.card,
      border: `1px solid ${S.bdr}`,
      borderRadius: 10,
      padding: "12px 16px",
    }}>
      <div style={{
        fontSize: "0.7rem",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: S.txt2,
        marginBottom: 4,
        fontWeight: 600,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: "1.4rem",
        fontWeight: 800,
        letterSpacing: "-0.02em",
        color,
        fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
      }}>
        {value}
      </div>
    </div>
  );
}

// ─── Detail Panel ────────────────────────────────────────────────────────────

function DetailPanel({ m, totalLaps, onClose, onGoToTrace, activeClass }: {
  m: StrategyMetrics;
  totalLaps: number;
  onClose: () => void;
  onGoToTrace: () => void;
  activeClass: string;
}) {
  const clsColor = CLASS_COLORS[m.cls] || S.acc;
  const maxStintLaps = Math.max(...m.stints.map((s) => s.laps), 1);

  return (
    <div style={{
      background: S.card,
      border: `1px solid ${S.bdr}`,
      borderRadius: 12,
      padding: 20,
      marginBottom: 24,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.3rem", fontWeight: 800, color: clsColor }}>
          #{m.carNum}
        </span>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>{m.team}</h3>
        <span style={{
          fontSize: "0.65rem",
          padding: "1px 6px",
          borderRadius: 4,
          fontWeight: 700,
          background: "rgba(34,197,94,0.15)",
          color: S.grn,
        }}>
          P{m.classPos}{activeClass ? ` in ${activeClass}` : ` in ${m.cls}`}
        </span>
        <button
          onClick={onGoToTrace}
          style={{
            fontSize: "0.72rem",
            color: S.acc,
            background: "none",
            border: `1px solid ${S.bdr}`,
            borderRadius: 6,
            padding: "4px 10px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          View on Trace
        </button>
        <span
          onClick={onClose}
          style={{ marginLeft: "auto", fontSize: "0.75rem", color: S.txt2, cursor: "pointer" }}
        >
          ✕ Close
        </span>
      </div>

      {/* Stint Map */}
      <SectionHeader>Stint Map</SectionHeader>
      <div style={{ fontSize: "0.65rem", color: S.dim, marginBottom: 8 }}>
        <span style={{ display: "inline-block", width: 10, height: 10, background: S.grn, borderRadius: 2, verticalAlign: "middle", marginRight: 3 }} /> Green laps
        <span style={{ display: "inline-block", width: 10, height: 10, background: S.yel, borderRadius: 2, verticalAlign: "middle", marginLeft: 10, marginRight: 3 }} /> Yellow laps
      </div>
      <div style={{ display: "flex", gap: 2, alignItems: "end", height: 120, marginBottom: 12, padding: "8px 0" }}>
        {m.stints.map((s) => (
          <StintBar key={s.n} stint={s} maxLaps={maxStintLaps} />
        ))}
      </div>

      {/* Pit Stop Timeline */}
      <SectionHeader>Pit Stop Timeline</SectionHeader>
      <div style={{
        display: "flex",
        alignItems: "center",
        height: 40,
        position: "relative",
        background: S.bg2,
        borderRadius: 6,
        overflow: "hidden",
        marginBottom: 2,
      }}>
        {m.pits.map((p, i) => {
          const leftPct = totalLaps > 0 ? ((p.lap / totalLaps) * 100).toFixed(1) : "0";
          const posChange = p.pa - p.pb;
          const posStr = posChange > 0 ? `\u2193${posChange}` : posChange < 0 ? `\u2191${Math.abs(posChange)}` : "—";
          return (
            <PitMarker
              key={i}
              leftPct={leftPct}
              isYellow={p.yel}
              tooltip={`Lap ${p.lap} · ${p.yel ? "Yellow" : "Green"}\nDuration: ~${p.dur > 0 ? p.dur.toFixed(0) + "s" : "< 1s"}\nPosition: P${p.pb} → P${p.pa} (${posStr})`}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6rem", color: S.dim, marginTop: 2, marginBottom: 16 }}>
        <span>Lap 1</span><span>Lap {totalLaps}</span>
      </div>

      {/* Stint Detail Table */}
      <SectionHeader>Stint Detail</SectionHeader>
      <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${S.bdr}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              {["#", "Laps", "Green", "Yellow", "Avg Pace", "Degradation", "Pos In", "Pos Out"].map((h) => (
                <th
                  key={h}
                  style={{
                    background: S.bg2,
                    color: S.txt2,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    fontSize: "0.68rem",
                    padding: "8px 12px",
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    borderBottom: `1px solid ${S.bdr2}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.stints.map((s) => (
              <tr key={s.n}>
                <td style={{ ...tdStyle, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>S{s.n}</td>
                <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace" }}>{s.laps}</td>
                <td style={tdStyle}>
                  <span style={{ fontSize: "0.65rem", padding: "1px 6px", borderRadius: 4, fontWeight: 700, background: "rgba(34,197,94,0.15)", color: S.grn }}>
                    {s.gl}
                  </span>
                </td>
                <td style={tdStyle}>
                  {s.yl > 0 ? (
                    <span style={{ fontSize: "0.65rem", padding: "1px 6px", borderRadius: 4, fontWeight: 700, background: "rgba(234,179,8,0.15)", color: S.yel }}>
                      {s.yl}
                    </span>
                  ) : (
                    <span style={{ color: S.dim }}>0</span>
                  )}
                </td>
                <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", color: s.pace > 0 ? S.grn : S.dim }}>
                  {s.pace > 0 ? fmtPaceFull(s.pace) : "—"}
                </td>
                <td style={{
                  ...tdStyle,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: s.deg > 0.01 ? S.red : s.deg < -0.01 ? S.grn : S.dim,
                }}>
                  {s.deg !== 0 ? (s.deg > 0 ? "+" : "") + s.deg.toFixed(3) + "s/L" : "—"}
                </td>
                <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace" }}>P{s.ps}</td>
                <td style={{
                  ...tdStyle,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: s.pe < s.ps ? S.grn : s.pe > s.ps ? S.red : S.txt2,
                }}>
                  P{s.pe}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: `1px solid ${S.bdr}`,
  whiteSpace: "nowrap",
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
      {children}
      <span style={{ flex: 1, height: 1, background: S.bdr }} />
    </div>
  );
}

function StintBar({ stint, maxLaps }: { stint: StintData; maxLaps: number }) {
  const totalH = Math.max(8, ((stint.gl + stint.yl) / maxLaps) * 100);
  const greenPct = stint.gl + stint.yl > 0 ? (stint.gl / (stint.gl + stint.yl)) * 100 : 100;
  const yellowPct = 100 - greenPct;

  return (
    <div
      style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 16, maxWidth: 60 }}
      title={`Stint ${stint.n}: ${stint.laps}L (${stint.gl}G/${stint.yl}Y)\nPace: ${stint.pace > 0 ? fmtPaceFull(stint.pace) : "—"}\nDeg: ${stint.deg > 0 ? "+" : ""}${stint.deg.toFixed(3)}s/lap\nPos: P${stint.ps}→P${stint.pe}`}
    >
      <div style={{
        width: "100%",
        height: `${totalH}%`,
        borderRadius: "3px 3px 0 0",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {stint.yl > 0 && (
          <div style={{ height: `${yellowPct}%`, background: S.yel }} />
        )}
        <div style={{ flex: 1, background: S.grn, borderRadius: stint.yl > 0 ? 0 : "3px 3px 0 0" }} />
      </div>
      <div style={{ fontSize: "0.6rem", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: S.txt2, marginTop: 2 }}>
        {stint.laps}L
      </div>
      <div style={{ fontSize: "0.6rem", fontFamily: "'JetBrains Mono', monospace", color: S.dim, textAlign: "center" }}>
        {stint.pace > 0 ? fmtPace(stint.pace) : ""}
      </div>
    </div>
  );
}

function PitMarker({ leftPct, isYellow, tooltip }: { leftPct: string; isYellow: boolean; tooltip: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        position: "absolute",
        width: hovered ? 5 : 3,
        height: "100%",
        left: `${leftPct}%`,
        background: isYellow ? S.yel : S.pit,
        cursor: "pointer",
        transition: "all .15s",
        zIndex: hovered ? 2 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: S.card,
          border: `1px solid ${S.bdr2}`,
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: "0.7rem",
          whiteSpace: "pre-line",
          pointerEvents: "none",
          zIndex: 10,
          color: S.txt,
        }}>
          {tooltip}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { RaceChartData, AnnotationData } from "@shared/types";
import { CLASS_COLORS } from "./constants";
import { useIsCompact } from "../../lib/breakpoint";
import { ChipRow, PC, RowCard, SectionLabel, SortBar, StatGrid } from "./phone-cards";
import {
  computeStrategyMetrics,
  computeRaceConditions,
  computeInsights,
  type StrategyMetrics,
} from "./strategy-engine";
import {
  DEFAULT_STRATEGY_SORT,
  STRATEGY_KEY,
  STRATEGY_SORTS,
  STINT_CAUTION,
  STINT_FAST,
  STINT_MID,
  STINT_SLOW,
  STINT_TEXT,
  paceRgb,
  rgbCss,
  setStrategyView,
  sortStrategy,
  strategyMethod,
  type StrategySort,
  type StrategySortKey,
} from "./strategy-view";

// ─── Format helpers ─────────────────────────────────────────────────────────


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

const PIT_KIND = { stop: "Pit stop", garage: "Garage", penalty: "Penalty (not a stop)" } as const;

function pitDurText(p: StrategyMetrics["pits"][number], verified: boolean): string {
  if (p.dur === null) return p.kind === "garage" ? "Garage visit" : "Pit lane time: not timed";
  return verified ? `In the pit lane: ${p.dur.toFixed(0)}s` : `Duration: ~${p.dur > 0 ? p.dur.toFixed(0) + "s" : "< 1s"}`;
}

function pitTimeTitle(m: StrategyMetrics): string {
  const what = m.verified ? "Time in the pit lane over the car's stops and penalties" : "Pit laps' time over the car's green pace (estimate)";
  const notes = [
    m.untimedStops > 0 ? `* ${m.untimedStops} without a pit-lane time, not included` : "",
    m.garageVisits > 0 ? `${m.garageVisits} garage visit${m.garageVisits === 1 ? "" : "s"}, not included` : "",
  ].filter(Boolean);
  return [what, ...notes].join("\n");
}

/** Seconds → M:SS.s (pit-lane times are timed to the second or tenth). */
function fmtTenths(s: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  return m + ":" + (s - m * 60).toFixed(1).padStart(4, "0");
}

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

// The page's look (as the Driver Report and the PDF).
const P = {
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
  focus: "rgba(244,140,52,0.12)",
} as const;

interface Col {
  key: StrategySortKey;
  label: string;
  align: "left" | "right";
  cell: (m: StrategyMetrics) => React.ReactNode;
  title?: (m: StrategyMetrics) => string | undefined;
}

const COLS: Col[] = [
  { key: "classPos", label: "P", align: "right", cell: (m) => <b>{m.classPos || "—"}</b> },
  { key: "carNum", label: "Car", align: "left", cell: (m) => <span className="font-mono font-semibold" style={{ color: CLASS_COLORS[m.cls] ?? P.accent }}>#{m.carLabel}</span> },
  { key: "team", label: "Team", align: "left", cell: (m) => <span className="block max-w-[180px] truncate" title={m.team}>{m.team.replace(/\s*\([^()]*\)\s*$/, "")}</span> },
  { key: "lapsCompleted", label: "Laps", align: "right", cell: (m) => m.lapsCompleted },
  { key: "stops", label: "Stops", align: "right", cell: (m) => m.stops },
  { key: "avgGreenPace", label: "Avg pace", align: "right", cell: (m) => <span className="font-mono">{fmtPaceFull(m.avgGreenPace)}</span> },
  { key: "bestLap", label: "Best", align: "right", cell: (m) => <span className="font-mono" style={{ color: P.clear }}>{fmtPaceFull(m.bestLap)}</span> },
  {
    key: "totalPitTime",
    label: "Pit time",
    align: "right",
    cell: (m) => <span className="font-mono">{(m.verified ? fmtTenths(m.totalPitTime) : fmtTime(m.totalPitTime)) + (m.untimedStops > 0 ? "*" : "")}</span>,
    title: (m) => pitTimeTitle(m),
  },
  { key: "pitPct", label: "Pit %", align: "right", cell: (m) => `${m.pitPct.toFixed(1)}%` },
  { key: "yellowPitPct", label: "Yellow", align: "right", cell: (m) => `${Math.round(m.yellowPitPct)}%`, title: () => "Share of its stops made under a caution" },
  { key: "avgStintLen", label: "Avg stint", align: "right", cell: (m) => m.avgStintLen.toFixed(1) },
  { key: "maxStintLen", label: "Max", align: "right", cell: (m) => m.maxStintLen, title: () => "Longest stint (laps)" },
  {
    key: "strategyScore",
    label: "Score",
    align: "right",
    cell: (m) => <b>{m.strategyScore < 0 ? "–" : m.strategyScore.toFixed(1)}</b>,
    title: (m) => (m.strategyScore < 0 ? "Not scored: ran less than three quarters of its class's laps" : undefined),
  },
];

/** One bar per stint: its width the stint's laps, its colour its green-flag pace against the class's best. */
function StintMap({ m, totalLaps, best }: { m: StrategyMetrics; totalLaps: number; best: number }) {
  return (
    <div className="flex h-[22px] w-full gap-px" role="img" aria-label={`Stints: ${m.stints.map((s) => s.laps).join(", ")} laps`}>
      {m.stints.map((s) => {
        const pct = (s.laps / Math.max(1, totalLaps)) * 100;
        const title =
          `Stint ${s.n}: ${s.laps} lap${s.laps === 1 ? "" : "s"}` +
          (s.yl ? ` (${s.yl} under caution)` : "") +
          (s.pace > 0 ? ` · green pace ${fmtPaceFull(s.pace)}` : "") +
          (s.ps && s.pe ? ` · P${s.ps} → P${s.pe} in class` : "");
        return (
          <div key={s.n} className="relative h-full shrink-0 overflow-hidden rounded-[2px]" style={{ width: `${pct}%`, background: rgbCss(paceRgb(s.pace, best)) }} title={title}>
            {pct >= 3.5 && (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold" style={{ color: STINT_TEXT }}>
                {s.laps}
              </span>
            )}
            {s.yl > 0 && <span className="absolute bottom-0 left-0 h-[3px]" style={{ width: `${(s.yl / Math.max(1, s.laps)) * 100}%`, background: rgbCss(STINT_CAUTION) }} />}
          </div>
        );
      })}
    </div>
  );
}

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

export function StrategyTab({ data, annotations, focusNum, setFocusNum, onSwitchToTrace }: StrategyTabProps) {
  const allMetrics = useMemo(() => computeStrategyMetrics(data, annotations), [data, annotations]);
  const conditions = useMemo(() => computeRaceConditions(data), [data]);
  const allInsights = useMemo(() => computeInsights(data, allMetrics), [data, allMetrics]);
  const classes = useMemo(() => [...new Set(allMetrics.map((m) => m.cls))].sort(), [allMetrics]);

  // One class at a time, as the PDF: the focus car's to start with.
  const focusCls = data.cars[String(focusNum)]?.cls;
  const [cls, setCls] = useState(() => (focusCls && classes.includes(focusCls) ? focusCls : classes[0] ?? ""));
  const activeClass = classes.includes(cls) ? cls : classes[0] ?? "";
  // A new focus car (picked here or on another view) brings its class with it.
  useEffect(() => {
    if (focusCls && classes.includes(focusCls)) setCls(focusCls);
  }, [focusCls, classes]);
  const [sort, setSort] = useState<StrategySort>(DEFAULT_STRATEGY_SORT);
  const [selectedCar, setSelectedCar] = useState<number | null>(null);

  const classRows = useMemo(() => allMetrics.filter((m) => m.cls === activeClass), [allMetrics, activeClass]);
  const rows = useMemo(() => sortStrategy(classRows, sort), [classRows, sort]);
  const insights = allInsights.filter((i) => i.cls === activeClass);
  const best = Math.min(...classRows.map((m) => m.avgGreenPace).filter((p) => p > 0));
  const totalLaps = Math.max(1, ...classRows.map((m) => m.lapsCompleted));
  const verified = classRows.some((m) => m.verified);
  const selectedMetrics = selectedCar != null ? allMetrics.find((m) => m.carNum === selectedCar) : null;

  // The PDF button prints the table as it is now: this class, this order.
  useEffect(() => {
    if (activeClass) setStrategyView(data, { cls: activeClass, sort });
  }, [data, activeClass, sort]);

  const sortBy = (key: StrategySortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: STRATEGY_SORTS[key].dir }));

  const greenPct = conditions.totalLaps ? Math.round(100 - conditions.pctYellow) : 0;
  const compact = useIsCompact();

  if (compact) {
    return (
      <PhoneStrategy
        rows={rows}
        classes={classes}
        activeClass={activeClass}
        setCls={(c) => {
          setCls(c);
          setSelectedCar(null);
        }}
        sort={sort}
        setSort={setSort}
        insights={insights}
        focusNum={focusNum}
        selectedCar={selectedCar}
        setSelectedCar={setSelectedCar}
        totalLaps={totalLaps}
        raceLaps={conditions.totalLaps}
        best={best}
        verified={verified}
        summary={`${classRows.length} cars · ${conditions.totalLaps} laps, ${greenPct}% green (${conditions.yellowLaps} caution laps)`}
        onGoToTrace={(n) => {
          setFocusNum(n);
          onSwitchToTrace();
        }}
      />
    );
  }

  return (
    <div className="px-2 py-3 sm:px-6" style={{ color: P.text }}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="m-0 text-base font-semibold">Strategy · {activeClass}</h2>
        <span className="text-sm" style={{ color: P.muted }}>
          {classRows.length} cars · race of {conditions.totalLaps} laps, {greenPct}% under green ({conditions.yellowLaps} caution laps)
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Class">
        {classes.map((c) => {
          const active = c === activeClass;
          const color = CLASS_COLORS[c] ?? P.accent;
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setCls(c);
                setSelectedCar(null);
              }}
              className="rounded-md border px-3 py-1 text-xs font-semibold"
              style={{ borderColor: active ? color : P.border, background: active ? `${color}22` : P.card, color: active ? P.text : P.muted }}
            >
              {c}
            </button>
          );
        })}
      </div>

      {insights.length > 0 && (
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          {insights.map((ins, i) => (
            <div key={i} className="rounded-md border-l-[3px] px-4 py-2.5" style={{ background: P.card, borderColor: P.accent }}>
              <div className="text-[13px] font-semibold">{ins.title}</div>
              <div className="mt-0.5 text-[13px] leading-relaxed" style={{ color: P.muted }}>
                {ins.text}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="custom-scroll overflow-x-auto rounded-lg border" style={{ borderColor: P.line, background: P.card }}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr style={{ borderBottom: `1px solid ${P.border}` }}>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => sortBy(c.key)}
                  className="cursor-pointer select-none whitespace-nowrap px-2 py-2 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: sort.key === c.key ? P.text : P.muted, textAlign: c.align }}
                  aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th className="min-w-[320px] whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: P.muted, width: "40%" }}>
                Stint map (laps per stint)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => {
              const focus = m.carNum === focusNum;
              const open = m.carNum === selectedCar;
              return (
                <tr
                  key={m.carNum}
                  onClick={() => setSelectedCar(open ? null : m.carNum)}
                  className="cursor-pointer hover:brightness-125"
                  style={{ background: focus || open ? P.focus : i % 2 ? P.rowAlt : P.row, height: 30 }}
                  aria-expanded={open}
                >
                  {COLS.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-2" style={{ textAlign: c.align }} title={c.title?.(m)}>
                      {c.cell(m)}
                    </td>
                  ))}
                  <td className="px-2 py-1">
                    <StintMap m={m} totalLaps={totalLaps} best={best} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: P.muted }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-[2px]" style={{ background: rgbCss(STINT_FAST) }} /> {STRATEGY_KEY.best}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-[2px]" style={{ background: rgbCss(STINT_MID) }} /> {STRATEGY_KEY.mid}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-[2px]" style={{ background: rgbCss(STINT_SLOW) }} /> {STRATEGY_KEY.slow}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-[3px] w-3" style={{ background: rgbCss(STINT_CAUTION) }} /> {STRATEGY_KEY.caution}
        </span>
        <span>Tap a car for its stints and stops.</span>
      </div>
      <p className="mt-1.5 max-w-4xl text-xs leading-relaxed" style={{ color: P.muted }}>
        {strategyMethod(verified)}
      </p>

      {selectedMetrics && (
        <div className="mt-4">
          <DetailPanel
            m={selectedMetrics}
            totalLaps={conditions.totalLaps}
            onClose={() => setSelectedCar(null)}
            onGoToTrace={() => {
              setFocusNum(selectedMetrics.carNum);
              onSwitchToTrace();
            }}
            activeClass={activeClass}
          />
        </div>
      )}
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
          #{m.carLabel}
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
              tooltip={`Lap ${p.lap} · ${PIT_KIND[p.kind]} · ${p.yel ? "Yellow" : "Green"}\n${pitDurText(p, m.verified)}\nPosition: P${p.pb} → P${p.pa} (${posStr})`}
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

// ─── Phone (mobile redesign, step 5): a card per car, the focus car first; tap for stints and stops ───

const SORT_LABEL: Record<StrategySortKey, string> = {
  classPos: "Class position",
  carNum: "Car number",
  team: "Team",
  lapsCompleted: "Laps",
  stops: "Stops",
  avgGreenPace: "Average pace",
  bestLap: "Best lap",
  totalPitTime: "Pit time",
  pitPct: "Pit %",
  yellowPitPct: "Yellow-flag stops",
  avgStintLen: "Average stint",
  maxStintLen: "Longest stint",
  strategyScore: "Strategy score",
};

function PhoneStrategy(p: {
  rows: StrategyMetrics[];
  classes: string[];
  activeClass: string;
  setCls: (c: string) => void;
  sort: StrategySort;
  setSort: (s: StrategySort) => void;
  insights: { title: string; text: string }[];
  focusNum: number;
  selectedCar: number | null;
  setSelectedCar: (n: number | null) => void;
  totalLaps: number;
  raceLaps: number;
  best: number;
  verified: boolean;
  summary: string;
  onGoToTrace: (n: number) => void;
}) {
  const mine = p.rows.filter((m) => m.carNum === p.focusNum);
  const card = (m: StrategyMetrics, pinned = false) => {
    // The focus car's stints open in its pinned card only, not twice.
    const open = m.carNum === p.selectedCar && (pinned || !mine.some((x) => x.carNum === m.carNum));
    return (
      <RowCard
        key={`${pinned ? "pin" : "row"}-${m.carNum}`}
        focus={m.carNum === p.focusNum}
        onClick={() => p.setSelectedCar(open ? null : m.carNum)}
        label={`#${m.carLabel} ${m.team}: ${open ? "hide" : "show"} stints and stops`}
      >
        <div className="flex items-baseline gap-2">
          <span className="w-7 shrink-0 font-mono text-[14px] font-bold">P{m.classPos || "—"}</span>
          <span className="shrink-0 font-mono text-[15px] font-semibold" style={{ color: CLASS_COLORS[m.cls] ?? PC.accent }}>#{m.carLabel}</span>
          <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: PC.soft }}>{m.team.replace(/\s*\([^()]*\)\s*$/, "")}</span>
          <span className="shrink-0 text-[12px]" style={{ color: PC.muted }}>Score</span>
          <span className="shrink-0 font-mono text-[15px] font-bold">{m.strategyScore < 0 ? "–" : m.strategyScore.toFixed(1)}</span>
        </div>
        <div className="mt-2">
          <StintMap m={m} totalLaps={p.totalLaps} best={p.best} />
        </div>
        <StatGrid
          stats={[
            { label: "Avg pace", value: fmtPaceFull(m.avgGreenPace) },
            { label: "Best", value: fmtPaceFull(m.bestLap), color: P.clear },
            { label: "Laps", value: m.lapsCompleted },
            { label: "Stops", value: m.stops },
            { label: "Pit time", value: (m.verified ? fmtTenths(m.totalPitTime) : fmtTime(m.totalPitTime)) + (m.untimedStops > 0 ? "*" : "") },
            { label: "Pit %", value: `${m.pitPct.toFixed(1)}%` },
            { label: "Yellow stops", value: `${Math.round(m.yellowPitPct)}%` },
            { label: "Avg stint", value: m.avgStintLen.toFixed(1) },
            { label: "Longest", value: m.maxStintLen },
          ]}
        />
        {open && <PhoneStrategyDetail m={m} raceLaps={p.raceLaps} onGoToTrace={() => p.onGoToTrace(m.carNum)} />}
        {!open && (
          <div className="mt-2 text-[12px]" style={{ color: PC.accent }}>
            Stints and stops ›
          </div>
        )}
      </RowCard>
    );
  };

  return (
    <div className="px-3 pb-6 pt-3" style={{ color: PC.text }} data-phone-cards="strategy">
      <h2 className="m-0 text-[16px] font-semibold">Strategy · {p.activeClass}</h2>
      <p className="m-0 mt-0.5 text-[13px]" style={{ color: PC.muted }}>{p.summary}</p>
      {p.classes.length > 1 && (
        <div className="mt-3">
          <ChipRow label="Class" items={p.classes.map((c) => ({ key: c, label: c, color: CLASS_COLORS[c] }))} value={p.activeClass} onChange={p.setCls} />
        </div>
      )}
      {p.insights.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {p.insights.map((ins, i) => (
            <div key={i} className="rounded-xl border-l-[3px] px-3 py-2.5" style={{ background: PC.card, borderColor: PC.accent }}>
              <div className="text-[14px] font-semibold">{ins.title}</div>
              <div className="mt-0.5 text-[13px] leading-relaxed" style={{ color: PC.muted }}>{ins.text}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3">
        <SortBar
          options={(Object.keys(SORT_LABEL) as StrategySortKey[]).map((k) => ({ key: k, label: SORT_LABEL[k] }))}
          value={p.sort.key}
          dir={p.sort.dir}
          onChange={(k) => p.setSort({ key: k, dir: STRATEGY_SORTS[k].dir })}
          onFlip={() => p.setSort({ key: p.sort.key, dir: p.sort.dir === "asc" ? "desc" : "asc" })}
        />
      </div>
      {mine.length > 0 && (
        <>
          <SectionLabel>Your car</SectionLabel>
          <div className="flex flex-col gap-2">{mine.map((m) => card(m, true))}</div>
        </>
      )}
      <SectionLabel>All {p.activeClass} cars</SectionLabel>
      <div className="flex flex-col gap-2">{p.rows.map((m) => card(m))}</div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: PC.muted }}>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3 rounded-[2px]" style={{ background: rgbCss(STINT_FAST) }} /> {STRATEGY_KEY.best}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3 rounded-[2px]" style={{ background: rgbCss(STINT_MID) }} /> {STRATEGY_KEY.mid}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3 rounded-[2px]" style={{ background: rgbCss(STINT_SLOW) }} /> {STRATEGY_KEY.slow}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-3" style={{ background: rgbCss(STINT_CAUTION) }} /> {STRATEGY_KEY.caution}</span>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: PC.muted }}>{strategyMethod(p.verified)}</p>
    </div>
  );
}

/** A car's stints and stops as lists (the laptop's stint table and hover pit markers). */
function PhoneStrategyDetail({ m, raceLaps, onGoToTrace }: { m: StrategyMetrics; raceLaps: number; onGoToTrace: () => void }) {
  const row = "flex items-baseline gap-2 border-t py-2 text-[13px]";
  return (
    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
      <SectionLabel>Stints</SectionLabel>
      {m.stints.map((s) => (
        <div key={s.n} className={row} style={{ borderColor: PC.line }}>
          <span className="w-8 shrink-0 font-mono font-semibold">S{s.n}</span>
          <span className="min-w-0 flex-1">
            {s.laps} laps
            {s.yl > 0 && <span style={{ color: S.yel }}> · {s.yl} caution</span>}
            <span className="block text-[12px]" style={{ color: PC.muted }}>
              {s.deg !== 0 ? `${s.deg > 0 ? "+" : ""}${s.deg.toFixed(3)} s/lap` : "No fade measured"}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-mono" style={{ color: s.pace > 0 ? S.grn : PC.muted }}>{s.pace > 0 ? fmtPaceFull(s.pace) : "—"}</span>
            <span className="block font-mono text-[12px]" style={{ color: s.pe < s.ps ? S.grn : s.pe > s.ps ? S.red : PC.muted }}>
              P{s.ps} → P{s.pe}
            </span>
          </span>
        </div>
      ))}
      <SectionLabel>Stops</SectionLabel>
      {m.pits.length === 0 && <p className="m-0 text-[13px]" style={{ color: PC.muted }}>No stops.</p>}
      {m.pits.map((pt, i) => (
        <div key={i} className={row} style={{ borderColor: PC.line }}>
          <span className="w-14 shrink-0 font-mono">Lap {pt.lap}</span>
          <span className="min-w-0 flex-1">
            {PIT_KIND[pt.kind]}
            <span style={{ color: pt.yel ? S.yel : S.grn }}> · {pt.yel ? "Yellow" : "Green"}</span>
            <span className="block text-[12px]" style={{ color: PC.muted }}>{pitDurText(pt, m.verified)}</span>
          </span>
          <span className="shrink-0 font-mono" style={{ color: pt.pa < pt.pb ? S.grn : pt.pa > pt.pb ? S.red : PC.muted }}>
            P{pt.pb} → P{pt.pa}
          </span>
        </div>
      ))}
      <p className="m-0 mt-1 text-[11px]" style={{ color: PC.muted }}>Race of {raceLaps} laps.</p>
      <button
        type="button"
        onClick={onGoToTrace}
        className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-lg border text-[14px] font-semibold"
        style={{ borderColor: PC.border, color: PC.accent }}
      >
        View on the trace
      </button>
    </div>
  );
}

import { useState, useMemo, useEffect } from "react";
import { api, ApiClientError } from "../../lib/api";
import { Link } from "react-router-dom";

// ─── API response types ─────────────────────────────────────────────────────

interface PitStop {
  stopNumber: number;
  pitLap: number;
  condition: string;
  localRef_s: number;
  vsGlobal_s: number;
  refSource: string;
  twoLapActual_s: number;
  twoLapRef_s: number;
  serviceTime_s: number;
  pitRoadTime_s: number;
  timeLost_s: number;
  delta_s: number;
  isCautionContaminated: boolean;
}

interface CarAnalysis {
  carNumber: string;
  teamName: string;
  carClass: string;
  carColor: string | null;
  finishPos: number | null;
  stops: PitStop[];
}

interface PitAnalysisResponse {
  raceId: string;
  track: string;
  trackConfig: { trackName: string; transitTime_s: number; transitOverhead_s: number } | null;
  cars: Record<string, CarAnalysis>;
  summary: {
    totalStops: number;
    totalCars: number;
    avgServiceTime_s: number;
    avgTimeLost_s: number;
  };
}

// ─── Style constants (matching StrategyTab) ─────────────────────────────────

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

// ─── Format helpers ─────────────────────────────────────────────────────────

function fmtTime(s: number): string {
  if (!s && s !== 0) return "—";
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = abs - m * 60;
  const sign = s < 0 ? "-" : "";
  return m > 0
    ? `${sign}${m}:${sec.toFixed(1).padStart(4, "0")}`
    : `${sign}${sec.toFixed(1)}`;
}

function fmtDelta(s: number): string {
  const sign = s >= 0 ? "+" : "";
  return `${sign}${s.toFixed(1)}s`;
}

// ─── Derived row type ───────────────────────────────────────────────────────

interface CarRow {
  carNumber: string;
  teamName: string;
  carClass: string;
  finishPos: number;
  stopCount: number;
  avgServiceTime: number;
  avgTimeLost: number;
  bestTimeLost: number;
  worstTimeLost: number;
  greenStops: number;
  cautionStops: number;
  stops: PitStop[];
}

type SortKey = "finishPos" | "carNumber" | "teamName" | "stopCount" | "avgServiceTime" | "avgTimeLost" | "bestTimeLost" | "greenStops";

// ─── Props ──────────────────────────────────────────────────────────────────

interface PitAnalysisTabProps {
  raceId: string;
  focusNum: number;
  setFocusNum: React.Dispatch<React.SetStateAction<number>>;
  onSwitchToTrace: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PitAnalysisTab({ raceId, focusNum, setFocusNum, onSwitchToTrace }: PitAnalysisTabProps) {
  const [data, setData] = useState<PitAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("finishPos");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedCar, setSelectedCar] = useState<string | null>(null);

  // Fetch pit analysis data
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    api
      .get<PitAnalysisResponse>(`/races/${raceId}/pit-analysis`)
      .then((res) => setData(res))
      .catch((err) => {
        if (err instanceof ApiClientError) {
          setError({ message: err.message, code: err.code });
        } else {
          setError({ message: "Failed to load pit analysis" });
        }
      })
      .finally(() => setLoading(false));
  }, [raceId]);

  // Build rows
  const rows = useMemo(() => {
    if (!data) return [];
    return Object.values(data.cars).map((car): CarRow => {
      const greenStops = car.stops.filter((s) => s.condition === "Full green").length;
      const serviceTimes = car.stops.map((s) => s.serviceTime_s);
      const timeLosts = car.stops.map((s) => s.timeLost_s);
      return {
        carNumber: car.carNumber,
        teamName: car.teamName,
        carClass: car.carClass,
        finishPos: car.finishPos ?? 999,
        stopCount: car.stops.length,
        avgServiceTime: serviceTimes.length > 0 ? serviceTimes.reduce((a, b) => a + b, 0) / serviceTimes.length : 0,
        avgTimeLost: timeLosts.length > 0 ? timeLosts.reduce((a, b) => a + b, 0) / timeLosts.length : 0,
        bestTimeLost: timeLosts.length > 0 ? Math.min(...timeLosts) : 0,
        worstTimeLost: timeLosts.length > 0 ? Math.max(...timeLosts) : 0,
        greenStops,
        cautionStops: car.stops.length - greenStops,
        stops: car.stops,
      };
    });
  }, [data]);

  // Sort
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "finishPos": return dir * (a.finishPos - b.finishPos);
        case "carNumber": return dir * (parseInt(a.carNumber) - parseInt(b.carNumber));
        case "teamName": return dir * a.teamName.localeCompare(b.teamName);
        case "stopCount": return dir * (a.stopCount - b.stopCount);
        case "avgServiceTime": return dir * (a.avgServiceTime - b.avgServiceTime);
        case "avgTimeLost": return dir * (a.avgTimeLost - b.avgTimeLost);
        case "bestTimeLost": return dir * (a.bestTimeLost - b.bestTimeLost);
        case "greenStops": return dir * (a.greenStops - b.greenStops);
        default: return 0;
      }
    });
  }, [rows, sortKey, sortDir]);

  const selectedRow = selectedCar ? rows.find((r) => r.carNumber === selectedCar) : null;

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "teamName" || key === "carNumber" ? "asc" : "asc");
    }
  };

  // ── Loading state ─────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ color: S.txt, padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: "0.9rem", color: S.dim }}>Loading pit analysis...</div>
      </div>
    );
  }

  // ── Error / gating ────────────────────────────────────────────
  if (error) {
    if (error.code === "INSUFFICIENT_TIER") {
      return (
        <div style={{ color: S.txt, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 8 }}>Team Feature</div>
          <div style={{ fontSize: "0.85rem", color: S.txt2, marginBottom: 16 }}>
            Pit Stop Analysis is available on the Team plan. Upgrade to see service times, time lost, and pit strategy breakdowns.
          </div>
          <Link
            to="/pricing"
            style={{
              display: "inline-block",
              padding: "8px 20px",
              borderRadius: 8,
              background: S.acc,
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.85rem",
              textDecoration: "none",
            }}
          >
            View Pricing
          </Link>
        </div>
      );
    }
    return (
      <div style={{ color: S.txt, padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: "0.9rem", color: S.red }}>{error.message}</div>
      </div>
    );
  }

  // ── No data ───────────────────────────────────────────────────
  if (!data || data.summary.totalStops === 0) {
    return (
      <div style={{ color: S.txt, padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: "0.9rem", color: S.dim }}>
          No pit stop analysis available for this race. Analysis may not have been run yet.
        </div>
      </div>
    );
  }

  const columns: { key: SortKey; label: string; width?: string }[] = [
    { key: "finishPos", label: "Pos", width: "48px" },
    { key: "carNumber", label: "Car", width: "56px" },
    { key: "teamName", label: "Team" },
    { key: "stopCount", label: "Stops", width: "52px" },
    { key: "avgServiceTime", label: "Avg Service", width: "90px" },
    { key: "avgTimeLost", label: "Avg Time Lost", width: "100px" },
    { key: "bestTimeLost", label: "Best Stop", width: "86px" },
    { key: "greenStops", label: "Green / Caution", width: "110px" },
  ];

  return (
    <div style={{ color: S.txt, fontFamily: "'Outfit', system-ui, sans-serif" }}>
      {/* ── Summary cards ──────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
        <CondCard label="Total Stops" value={String(data.summary.totalStops)} color={S.acc} />
        <CondCard label="Cars" value={String(data.summary.totalCars)} color={S.acc} />
        <CondCard label="Avg Service Time" value={fmtTime(data.summary.avgServiceTime_s)} color={S.pit} mono />
        <CondCard label="Avg Time Lost" value={fmtTime(data.summary.avgTimeLost_s)} color={S.red} mono />
        {data.trackConfig && (
          <>
            <CondCard label="Track" value={data.trackConfig.trackName} color={S.acc2} />
            <CondCard label="Transit Time" value={fmtTime(data.trackConfig.transitTime_s)} color={S.dim} mono />
            <CondCard label="Transit Overhead" value={fmtTime(data.trackConfig.transitOverhead_s)} color={S.dim} mono />
          </>
        )}
      </div>

      {/* ── Leaderboard header ─────────────────────────────────── */}
      <div style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        Pit Stop Leaderboard
        <span style={{ fontSize: "0.72rem", color: S.dim, fontWeight: 400 }}>
          — {sortedRows.length} cars · {data.summary.totalStops} stops
        </span>
        <span style={{ flex: 1, height: 1, background: S.bdr }} />
      </div>

      {/* ── Table ──────────────────────────────────────────────── */}
      <div style={{ overflowX: "auto", marginBottom: 24, borderRadius: 10, border: `1px solid ${S.bdr}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              {columns.map((col) => {
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
            {sortedRows.map((row) => {
              const isSelected = row.carNumber === selectedCar;
              const isFocus = parseInt(row.carNumber) === focusNum;
              return (
                <tr
                  key={row.carNumber}
                  onClick={() => setSelectedCar(isSelected ? null : row.carNumber)}
                  style={{
                    cursor: "pointer",
                    background: isSelected ? "rgba(74,158,255,0.08)" : isFocus ? "rgba(74,158,255,0.03)" : undefined,
                    transition: "background .15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "rgba(74,158,255,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isSelected ? "rgba(74,158,255,0.08)" : isFocus ? "rgba(74,158,255,0.03)" : "";
                  }}
                >
                  <td style={{ ...tdStyle, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: S.acc, fontSize: "0.9rem" }}>
                    P{row.finishPos < 999 ? row.finishPos : "—"}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 700,
                      background: "rgba(74,158,255,0.15)",
                      color: S.acc,
                      padding: "2px 8px",
                      borderRadius: 4,
                      display: "inline-block",
                    }}>
                      #{row.carNumber}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.teamName}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace" }}>
                    {row.stopCount}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", color: S.pit }}>
                    {fmtTime(row.avgServiceTime)}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", color: S.red }}>
                    {fmtTime(row.avgTimeLost)}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", color: S.grn }}>
                    {fmtTime(row.bestTimeLost)}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: "0.65rem",
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontWeight: 700,
                      background: "rgba(34,197,94,0.15)",
                      color: S.grn,
                      marginRight: 4,
                    }}>
                      {row.greenStops}G
                    </span>
                    {row.cautionStops > 0 && (
                      <span style={{
                        fontSize: "0.65rem",
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontWeight: 700,
                        background: "rgba(234,179,8,0.15)",
                        color: S.yel,
                      }}>
                        {row.cautionStops}C
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Detail Panel ───────────────────────────────────────── */}
      {selectedRow && (
        <DetailPanel
          row={selectedRow}
          trackConfig={data.trackConfig}
          onClose={() => setSelectedCar(null)}
          onGoToTrace={() => {
            setFocusNum(parseInt(selectedRow.carNumber));
            onSwitchToTrace();
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: `1px solid ${S.bdr}`,
  whiteSpace: "nowrap",
};

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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
      {children}
      <span style={{ flex: 1, height: 1, background: S.bdr }} />
    </div>
  );
}

function DetailPanel({ row, trackConfig, onClose, onGoToTrace }: {
  row: CarRow;
  trackConfig: PitAnalysisResponse["trackConfig"];
  onClose: () => void;
  onGoToTrace: () => void;
}) {
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
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.3rem", fontWeight: 800, color: S.acc }}>
          #{row.carNumber}
        </span>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>{row.teamName}</h3>
        <span style={{
          fontSize: "0.65rem",
          padding: "1px 6px",
          borderRadius: 4,
          fontWeight: 700,
          background: "rgba(34,197,94,0.15)",
          color: S.grn,
        }}>
          P{row.finishPos < 999 ? row.finishPos : "—"} · {row.carClass}
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

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
        <MiniCard label="Stops" value={String(row.stopCount)} color={S.acc} />
        <MiniCard label="Avg Service" value={fmtTime(row.avgServiceTime)} color={S.pit} />
        <MiniCard label="Avg Time Lost" value={fmtTime(row.avgTimeLost)} color={S.red} />
        <MiniCard label="Best Stop" value={fmtTime(row.bestTimeLost)} color={S.grn} />
        <MiniCard label="Worst Stop" value={fmtTime(row.worstTimeLost)} color={S.yel} />
      </div>

      {/* Per-stop table */}
      <SectionHeader>Stop Detail</SectionHeader>
      <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${S.bdr}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              {["#", "Lap", "Condition", "Service", "Pit Road", "Time Lost", "Local Ref", "Ref Source", "Delta"].map((h) => (
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
            {row.stops.map((stop) => {
              const isGreen = stop.condition === "Full green";
              const condColor = isGreen ? S.grn : S.yel;
              return (
                <tr key={stop.stopNumber}>
                  <td style={{ ...tdStyle, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                    S{stop.stopNumber}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace" }}>
                    L{stop.pitLap}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: "0.65rem",
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontWeight: 700,
                      background: isGreen ? "rgba(34,197,94,0.15)" : "rgba(234,179,8,0.15)",
                      color: condColor,
                    }}>
                      {stop.condition}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", color: S.pit }}>
                    {fmtTime(stop.serviceTime_s)}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace" }}>
                    {fmtTime(stop.pitRoadTime_s)}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", color: S.red }}>
                    {fmtTime(stop.timeLost_s)}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", color: S.txt2 }}>
                    {fmtTime(stop.localRef_s)}
                  </td>
                  <td style={{ ...tdStyle, fontSize: "0.7rem", color: S.dim }}>
                    {stop.refSource}
                  </td>
                  <td style={{
                    ...tdStyle,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: stop.delta_s < 0 ? S.grn : S.red,
                  }}>
                    {fmtDelta(stop.delta_s)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Reference note */}
      {trackConfig && (
        <div style={{ marginTop: 12, fontSize: "0.72rem", color: S.dim }}>
          Track config: {trackConfig.trackName} · transit {fmtTime(trackConfig.transitTime_s)} · overhead {fmtTime(trackConfig.transitOverhead_s)}
        </div>
      )}
    </div>
  );
}

function MiniCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: S.bg2, border: `1px solid ${S.bdr}`, borderRadius: 8, padding: "8px 12px" }}>
      <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.06em", color: S.txt2, marginBottom: 2, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: "1.1rem", fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>
        {value}
      </div>
    </div>
  );
}

import { useState, useMemo } from "react";
import type { RaceChartData } from "@shared/types";
import { CarPicker } from "./CarPicker";

interface GapEvolutionPanelProps {
  data: RaceChartData;
  focusNum: number;
  activeLap: number;
}

function buildCumulativeTime(laps: { l: number; ltSec: number }[]): Map<number, number> {
  const map = new Map<number, number>();
  let cum = 0;
  for (const lap of laps) {
    cum += lap.ltSec;
    map.set(lap.l, cum);
  }
  return map;
}

function secToDisplay(sec: number): string {
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs - m * 60;
  const sign = sec < 0 ? "-" : "+";
  return m > 0 ? `${sign}${m}:${s.toFixed(2).padStart(5, "0")}` : `${sign}${s.toFixed(2)}`;
}

export function GapEvolutionPanel({ data, focusNum, activeLap }: GapEvolutionPanelProps) {
  const [compareNum, setCompareNum] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(true);

  const handleSelect = (num: number) => {
    setCompareNum(num);
    setShowPicker(false);
  };

  // Compute gaps over the last 10 laps
  const gapData = useMemo(() => {
    if (compareNum === null) return null;

    const focusCar = data.cars[String(focusNum)];
    const compareCar = data.cars[String(compareNum)];
    if (!focusCar || !compareCar) return null;

    const focusCum = buildCumulativeTime(focusCar.laps);
    const compareCum = buildCumulativeTime(compareCar.laps);

    const startLap = Math.max(1, activeLap - 9);
    const gaps: { lap: number; gap: number; delta: number | null }[] = [];
    let prevGap: number | null = null;

    for (let lap = startLap; lap <= activeLap; lap++) {
      const ft = focusCum.get(lap);
      const ct = compareCum.get(lap);
      if (ft === undefined || ct === undefined) continue;

      const gap = ft - ct; // positive = focus behind
      const delta = prevGap !== null ? gap - prevGap : null;
      gaps.push({ lap, gap, delta });
      prevGap = gap;
    }

    if (gaps.length === 0) return null;

    const currentGap = gaps[gaps.length - 1].gap;
    const gapValues = gaps.map((g) => g.gap);
    const minGap = Math.min(...gapValues);
    const maxGap = Math.max(...gapValues);

    // Trend: compare first half avg to second half avg
    let trend: "Closing" | "Opening" | "Stable" = "Stable";
    if (gaps.length >= 4) {
      const mid = Math.floor(gaps.length / 2);
      const firstHalf = gaps.slice(0, mid).reduce((s, g) => s + g.gap, 0) / mid;
      const secondHalf = gaps.slice(mid).reduce((s, g) => s + g.gap, 0) / (gaps.length - mid);
      const diff = secondHalf - firstHalf;
      if (Math.abs(diff) > 0.3) {
        trend = diff < 0 ? "Closing" : "Opening";
      }
    }

    return { gaps, currentGap, minGap, maxGap, trend };
  }, [data, focusNum, compareNum, activeLap]);

  if (showPicker || compareNum === null) {
    return (
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-4 py-2 text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
          Select a car to compare gaps with #{focusNum}
        </div>
        <CarPicker
          data={data}
          focusNum={focusNum}
          selectedNum={compareNum}
          onSelect={handleSelect}
        />
      </div>
    );
  }

  const compareCar = data.cars[String(compareNum)];

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Car selector bar */}
      <div className="px-4 py-2 flex items-center gap-2 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>vs</span>
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer transition-colors hover:bg-white/[0.06]"
          style={{ border: "1px solid rgba(255,255,255,0.12)" }}
        >
          <span className="font-mono font-bold text-xs text-white">#{compareNum}</span>
          <span className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.45)", maxWidth: 160 }}>
            {compareCar?.team}
          </span>
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>▼</span>
        </button>
      </div>

      {!gapData ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>No overlapping laps</span>
        </div>
      ) : (
        <>
          {/* Stat boxes */}
          <div className="px-4 py-3 flex gap-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <StatBox label="Current Gap" value={secToDisplay(gapData.currentGap)} />
            <StatBox label="10L Min" value={secToDisplay(gapData.minGap)} />
            <StatBox label="10L Max" value={secToDisplay(gapData.maxGap)} />
            <StatBox
              label="Trend"
              value={gapData.trend}
              color={gapData.trend === "Closing" ? "#4ade80" : gapData.trend === "Opening" ? "#f87171" : "rgba(255,255,255,0.5)"}
            />
          </div>

          {/* SVG sparkline */}
          <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <Sparkline gaps={gapData.gaps.map((g) => g.gap)} />
          </div>

          {/* Lap detail table — last 7 */}
          <div className="flex-1 overflow-y-auto px-4" style={{ scrollbarWidth: "none" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <th className="text-left py-1.5 font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Lap</th>
                  <th className="text-right py-1.5 font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Gap</th>
                  <th className="text-right py-1.5 font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Δ</th>
                </tr>
              </thead>
              <tbody>
                {gapData.gaps.slice(-7).map((g) => (
                  <tr key={g.lap} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td className="py-1.5 tabular-nums" style={{ color: "rgba(255,255,255,0.6)" }}>L{g.lap}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: "rgba(255,255,255,0.8)" }}>
                      {secToDisplay(g.gap)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-bold" style={{
                      color: g.delta === null ? "rgba(255,255,255,0.2)"
                        : g.delta < -0.01 ? "#4ade80"
                        : g.delta > 0.01 ? "#f87171"
                        : "rgba(255,255,255,0.3)",
                    }}>
                      {g.delta !== null ? (g.delta > 0 ? "+" : "") + g.delta.toFixed(2) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Helpers ----

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color: color || "white" }}>{value}</div>
    </div>
  );
}

function Sparkline({ gaps }: { gaps: number[] }) {
  if (gaps.length < 2) return null;

  const w = 420;
  const h = 50;
  const pad = 4;

  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  const range = max - min || 1;

  const points = gaps.map((g, i) => {
    const x = pad + (i / (gaps.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (g - min) / range) * (h - 2 * pad);
    return `${x},${y}`;
  });

  const last = gaps[gaps.length - 1];
  const dotColor = last >= 0 ? "#f87171" : "#4ade80";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 50 }}>
      {/* Zero line if crosses zero */}
      {min < 0 && max > 0 && (
        <line
          x1={pad} x2={w - pad}
          y1={pad + (1 - (0 - min) / range) * (h - 2 * pad)}
          y2={pad + (1 - (0 - min) / range) * (h - 2 * pad)}
          stroke="rgba(255,255,255,0.1)" strokeDasharray="3,3"
        />
      )}
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="rgba(255,255,255,0.4)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End dot */}
      <circle
        cx={parseFloat(points[points.length - 1].split(",")[0])}
        cy={parseFloat(points[points.length - 1].split(",")[1])}
        r={3}
        fill={dotColor}
      />
    </svg>
  );
}

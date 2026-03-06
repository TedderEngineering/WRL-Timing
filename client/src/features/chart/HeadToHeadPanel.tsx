import { useState, useMemo } from "react";
import type { RaceChartData } from "@shared/types";
import { CarPicker } from "./CarPicker";

interface HeadToHeadPanelProps {
  data: RaceChartData;
  focusNum: number;
  activeLap: number;
  defaultCompareNum?: number;
}

function secToDisplay(sec: number): string {
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs - m * 60;
  const sign = sec < 0 ? "-" : sec > 0 ? "+" : "";
  return m > 0 ? `${sign}${m}:${s.toFixed(2).padStart(5, "0")}` : `${sign}${s.toFixed(2)}`;
}

function lapTimeDisplay(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
}

export function HeadToHeadPanel({ data, focusNum, activeLap, defaultCompareNum }: HeadToHeadPanelProps) {
  const [compareNum, setCompareNum] = useState<number | null>(defaultCompareNum ?? null);
  const [showPicker, setShowPicker] = useState(defaultCompareNum == null);

  const handleSelect = (num: number) => {
    setCompareNum(num);
    setShowPicker(false);
  };

  const focusCar = data.cars[String(focusNum)];
  const compareCar = compareNum !== null ? data.cars[String(compareNum)] : null;

  // Build lap-by-lap comparison over last 7 laps
  const h2hData = useMemo(() => {
    if (!compareCar || compareNum === null) return null;

    const startLap = Math.max(1, activeLap - 6);
    const rows: { lap: number; focusTime: number | null; otherTime: number | null; delta: number | null }[] = [];

    let focusBestSec = Infinity;
    let otherBestSec = Infinity;
    let lapsAhead = 0;
    let deltaSum = 0;
    let deltaCount = 0;

    for (let lap = startLap; lap <= activeLap; lap++) {
      const fl = focusCar?.laps.find((l) => l.l === lap);
      const cl = compareCar.laps.find((l) => l.l === lap);

      const ft = fl?.ltSec && fl.ltSec > 1 && fl.flag === "GREEN" ? fl.ltSec : null;
      const ct = cl?.ltSec && cl.ltSec > 1 && cl.flag === "GREEN" ? cl.ltSec : null;

      const delta = ft !== null && ct !== null ? ft - ct : null;

      rows.push({ lap, focusTime: ft, otherTime: ct, delta });

      if (ft !== null) focusBestSec = Math.min(focusBestSec, ft);
      if (ct !== null) otherBestSec = Math.min(otherBestSec, ct);
      if (delta !== null) {
        if (delta < 0) lapsAhead++;
        deltaSum += delta;
        deltaCount++;
      }
    }

    const avgDelta = deltaCount > 0 ? deltaSum / deltaCount : null;

    return {
      rows,
      avgDelta,
      focusBest: focusBestSec === Infinity ? null : focusBestSec,
      otherBest: otherBestSec === Infinity ? null : otherBestSec,
      lapsAhead,
      totalLaps: deltaCount,
    };
  }, [focusCar, compareCar, compareNum, activeLap]);

  if (showPicker || compareNum === null) {
    return (
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Focus car box */}
        <div className="px-4 py-2 flex items-center gap-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="px-2.5 py-1 rounded-md" style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)" }}>
            <span className="font-mono font-bold text-xs" style={{ color: "#818cf8" }}>#{focusNum}</span>
            <span className="text-[11px] ml-1.5" style={{ color: "rgba(255,255,255,0.45)" }}>{focusCar?.team}</span>
          </div>
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>vs</span>
        </div>
        <div className="px-4 py-2 text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
          Select a car to compare head-to-head
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

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Car boxes */}
      <div className="px-4 py-2 flex items-center gap-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="px-2.5 py-1 rounded-md" style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)" }}>
          <span className="font-mono font-bold text-xs" style={{ color: "#818cf8" }}>#{focusNum}</span>
          <span className="text-[11px] ml-1.5" style={{ color: "rgba(255,255,255,0.45)" }}>{focusCar?.team}</span>
        </div>
        <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>vs</span>
        <button
          onClick={() => setShowPicker(true)}
          className="px-2.5 py-1 rounded-md cursor-pointer hover:bg-white/[0.06] transition-colors"
          style={{ border: "1px solid rgba(255,255,255,0.12)" }}
        >
          <span className="font-mono font-bold text-xs text-white">#{compareNum}</span>
          <span className="text-[11px] ml-1.5 truncate" style={{ color: "rgba(255,255,255,0.45)" }}>{compareCar?.team}</span>
          <span className="text-[10px] ml-1" style={{ color: "rgba(255,255,255,0.25)" }}>▼</span>
        </button>
      </div>

      {!h2hData ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>No comparable laps</span>
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="px-4 py-3 flex gap-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <StatBox
              label="Avg Δ (7L)"
              value={h2hData.avgDelta !== null ? secToDisplay(h2hData.avgDelta) : "—"}
              color={h2hData.avgDelta !== null ? (h2hData.avgDelta < 0 ? "#4ade80" : "#f87171") : undefined}
            />
            <StatBox
              label={`#${focusNum} Best`}
              value={h2hData.focusBest !== null ? lapTimeDisplay(h2hData.focusBest) : "—"}
            />
            <StatBox
              label={`#${compareNum} Best`}
              value={h2hData.otherBest !== null ? lapTimeDisplay(h2hData.otherBest) : "—"}
            />
            <StatBox
              label="Laps Faster"
              value={`${h2hData.lapsAhead}/${h2hData.totalLaps}`}
              color={h2hData.lapsAhead > h2hData.totalLaps / 2 ? "#4ade80" : h2hData.lapsAhead < h2hData.totalLaps / 2 ? "#f87171" : undefined}
            />
          </div>

          {/* Lap-by-lap table */}
          <div className="flex-1 overflow-y-auto px-4" style={{ scrollbarWidth: "none" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <th className="text-left py-1.5 font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Lap</th>
                  <th className="text-right py-1.5 font-medium" style={{ color: "#818cf8" }}>#{focusNum}</th>
                  <th className="text-right py-1.5 font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>#{compareNum}</th>
                  <th className="text-right py-1.5 font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Δ</th>
                </tr>
              </thead>
              <tbody>
                {h2hData.rows.map((r) => (
                  <tr key={r.lap} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td className="py-1.5 tabular-nums" style={{ color: "rgba(255,255,255,0.6)" }}>L{r.lap}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: "rgba(255,255,255,0.8)" }}>
                      {r.focusTime !== null ? lapTimeDisplay(r.focusTime) : "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: "rgba(255,255,255,0.8)" }}>
                      {r.otherTime !== null ? lapTimeDisplay(r.otherTime) : "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-bold" style={{
                      color: r.delta === null ? "rgba(255,255,255,0.2)"
                        : r.delta < -0.01 ? "#4ade80"
                        : r.delta > 0.01 ? "#f87171"
                        : "rgba(255,255,255,0.3)",
                    }}>
                      {r.delta !== null ? secToDisplay(r.delta) : "—"}
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

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color: color || "white" }}>{value}</div>
    </div>
  );
}

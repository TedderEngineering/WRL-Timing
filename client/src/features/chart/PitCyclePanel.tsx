import { useState, useMemo, useRef, useCallback } from "react";
import type { RaceChartData, AnnotationData, PitTimingData } from "@shared/types";

interface PitCyclePanelProps {
  data: RaceChartData;
  annotations: AnnotationData;
  focusNum: number;
  activeLap: number;
}

interface PitCycleRow {
  carNum: number;
  team: string;
  cls: string;
  pitLap: number;
  timing: PitTimingData;
  isFocus: boolean;
}

type SortKey = "car" | "inLap" | "pitRoad" | "pitLoss";

function secToDisplay(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
}

export function PitCyclePanel({ data, annotations, focusNum, activeLap }: PitCyclePanelProps) {
  const [sortKey, setSortKey] = useState<SortKey>("pitLoss");
  const [sortAsc, setSortAsc] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Drag-to-scroll state
  const dragState = useRef({ dragging: false, startX: 0, scrollLeft: 0 });

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    dragState.current = { dragging: true, startX: e.clientX, scrollLeft: scrollRef.current.scrollLeft };
    scrollRef.current.style.cursor = "grabbing";
  }, []);

  const onDragMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.current.dragging || !scrollRef.current) return;
    const dx = e.clientX - dragState.current.startX;
    scrollRef.current.scrollLeft = dragState.current.scrollLeft - dx;
  }, []);

  const onDragEnd = useCallback(() => {
    dragState.current.dragging = false;
    if (scrollRef.current) scrollRef.current.style.cursor = "grab";
  }, []);

  // Build pit cycle: all cars that pitted within ±3 laps of activeLap
  const rows = useMemo<PitCycleRow[]>(() => {
    const result: PitCycleRow[] = [];
    for (const [carNumStr, carAnn] of Object.entries(annotations)) {
      const carNum = parseInt(carNumStr, 10);
      const car = data.cars[carNumStr];
      if (!car || !carAnn.pits) continue;

      for (const pit of carAnn.pits) {
        if (Math.abs(pit.l - activeLap) <= 3 && pit.pitTiming) {
          result.push({
            carNum,
            team: car.team,
            cls: car.cls,
            pitLap: pit.l,
            timing: pit.pitTiming,
            isFocus: carNum === focusNum,
          });
          break; // one entry per car
        }
      }
    }
    return result;
  }, [data, annotations, focusNum, activeLap]);

  // Sort
  const sorted = useMemo(() => {
    const s = [...rows];
    const dir = sortAsc ? 1 : -1;
    s.sort((a, b) => {
      switch (sortKey) {
        case "car": return dir * (a.carNum - b.carNum);
        case "inLap": return dir * (a.timing.inLapTime - b.timing.inLapTime);
        case "pitRoad": return dir * ((a.timing.pitRoadTime ?? 999) - (b.timing.pitRoadTime ?? 999));
        case "pitLoss": return dir * (a.timing.totalPitLoss - b.timing.totalPitLoss);
        default: return 0;
      }
    });
    return s;
  }, [rows, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((p) => !p);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // Summary stats
  const focusRow = rows.find((r) => r.isFocus);
  const avgPitLoss = rows.length > 0 ? rows.reduce((s, r) => s + r.timing.totalPitLoss, 0) / rows.length : 0;
  const bestRow = rows.length > 0 ? rows.reduce((best, r) => r.timing.totalPitLoss < best.timing.totalPitLoss ? r : best) : null;

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortAsc ? " ▲" : " ▼";
  };

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <span className="text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>
          No pit stops found within ±3 laps
        </span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Summary box */}
      <div className="px-4 py-3 flex gap-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        {focusRow && (
          <SummaryBox label="Your Pit Loss" value={secToDisplay(focusRow.timing.totalPitLoss)} />
        )}
        <SummaryBox label="Cycle Avg" value={secToDisplay(avgPitLoss)} />
        {bestRow && (
          <SummaryBox
            label="Best Stop"
            value={secToDisplay(bestRow.timing.totalPitLoss)}
            sub={`#${bestRow.carNum}`}
          />
        )}
        <SummaryBox label="Cars in Cycle" value={String(rows.length)} />
      </div>

      {/* Table */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-auto"
        style={{ scrollbarWidth: "none", cursor: "grab" }}
        onMouseDown={onDragStart}
        onMouseMove={onDragMove}
        onMouseUp={onDragEnd}
        onMouseLeave={onDragEnd}
      >
        <table className="w-full text-xs" style={{ minWidth: 440 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <SortHeader label="Car" sortKey="car" current={sortKey} arrow={sortArrow("car")} onClick={handleSort} />
              <th className="text-left px-2 py-2 font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Lap</th>
              <SortHeader label="In-Lap" sortKey="inLap" current={sortKey} arrow={sortArrow("inLap")} onClick={handleSort} />
              <SortHeader label="Pit Road" sortKey="pitRoad" current={sortKey} arrow={sortArrow("pitRoad")} onClick={handleSort} />
              <th className="text-left px-2 py-2 font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Out-Lap</th>
              <th className="text-left px-2 py-2 font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Grn Avg</th>
              <SortHeader label="Pit Loss" sortKey="pitLoss" current={sortKey} arrow={sortArrow("pitLoss")} onClick={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const lossColor = focusRow
                ? row.timing.totalPitLoss <= focusRow.timing.totalPitLoss ? "#4ade80" : "#f87171"
                : "rgba(255,255,255,0.9)";
              return (
                <tr
                  key={row.carNum}
                  style={{
                    background: row.isFocus ? "rgba(99,102,241,0.12)" : "transparent",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <td className="px-2 py-1.5 font-mono font-bold" style={{ color: row.isFocus ? "#818cf8" : "rgba(255,255,255,0.8)" }}>
                    #{row.carNum}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                    L{row.pitLap}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums" style={{ color: "rgba(255,255,255,0.8)" }}>
                    {secToDisplay(row.timing.inLapTime)}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums" style={{ color: "rgba(255,255,255,0.8)" }}>
                    {row.timing.pitRoadTime !== null ? secToDisplay(row.timing.pitRoadTime) : "—"}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums" style={{ color: "rgba(255,255,255,0.8)" }}>
                    {secToDisplay(row.timing.outLapTime)}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums" style={{ color: "rgba(255,255,255,0.5)" }}>
                    {secToDisplay(row.timing.avgGreenLapTime)}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: lossColor }}>
                    {secToDisplay(row.timing.totalPitLoss)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Helpers ----

function SummaryBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</div>
      <div className="text-sm font-bold tabular-nums text-white">{value}</div>
      {sub && <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{sub}</div>}
    </div>
  );
}

function SortHeader({ label, sortKey, current, arrow, onClick }: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  arrow: string;
  onClick: (key: SortKey) => void;
}) {
  return (
    <th
      className="text-left px-2 py-2 font-medium cursor-pointer select-none hover:text-white transition-colors"
      style={{ color: current === sortKey ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)" }}
      onClick={() => onClick(sortKey)}
    >
      {label}{arrow}
    </th>
  );
}

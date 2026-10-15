import { useState, useMemo } from "react";
import type { RaceChartData, AnnotationData } from "@shared/types";
import { classStopCycle, type StopRow } from "./pit-stops";

interface PitCyclePanelProps {
  data: RaceChartData;
  annotations: AnnotationData;
  focusNum: number;
  activeLap: number;
}

type SortKey = "car" | "inLap" | "pitRoad" | "pitLoss";

function secToDisplay(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  const sign = sec < 0 ? "−" : "";
  const a = Math.abs(sec);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  return m > 0 ? `${sign}${m}:${s.toFixed(2).padStart(5, "0")}` : `${sign}${s.toFixed(2)}`;
}

export function PitCyclePanel({ data, annotations, focusNum, activeLap }: PitCyclePanelProps) {
  const [sortKey, setSortKey] = useState<SortKey>("pitLoss");
  const [sortAsc, setSortAsc] = useState(true);

  // The class's round of stops that the focus car's stop belongs to (pit-stops.ts).
  const cycle = useMemo(() => classStopCycle(data, annotations, focusNum, activeLap), [data, annotations, focusNum, activeLap]);
  const rows: StopRow[] = cycle?.rows ?? [];

  const sorted = useMemo(() => {
    const s = [...rows];
    const dir = sortAsc ? 1 : -1;
    s.sort((a, b) => {
      switch (sortKey) {
        case "car": return dir * (a.carNum - b.carNum);
        case "inLap": return dir * (a.pitLap - b.pitLap);
        case "pitRoad": return dir * ((a.timing.pitRoadTime ?? 999) - (b.timing.pitRoadTime ?? 999));
        case "pitLoss": return dir * ((a.timing.totalPitLoss ?? 1e6) - (b.timing.totalPitLoss ?? 1e6));
        default: return 0;
      }
    });
    return s;
  }, [rows, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((p) => !p);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const focusRow = rows.find((r) => r.isFocus);
  // Stops with a measured loss; under a caution it is against cars on track, so a stop can come out ahead (negative).
  const measured = rows.filter((r) => typeof r.timing.totalPitLoss === "number");
  const avgPitLoss = measured.length > 0 ? measured.reduce((s, r) => s + (r.timing.totalPitLoss as number), 0) / measured.length : null;
  const bestRow = measured.length > 0 ? measured.reduce((best, r) => ((r.timing.totalPitLoss as number) < (best.timing.totalPitLoss as number) ? r : best)) : null;
  const sortArrow = (key: SortKey) => (sortKey !== key ? "" : sortAsc ? " ▲" : " ▼");

  if (!cycle || rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <span className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
          #{focusNum} has no stop within 3 laps of lap {activeLap}
        </span>
      </div>
    );
  }

  const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
  const cell = "px-1 py-1.5 tabular-nums";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 pb-2 pt-1 text-[12px]" style={{ color: "rgba(255,255,255,0.55)" }}>
        {cycle.cycleOrdinal
          ? `${cycle.cls} pit cycle ${cycle.cycleOrdinal} · laps ${cycle.firstLap}–${cycle.lastLap}`
          : `Every ${cycle.cls} car's ${ord(cycle.stopNumber)} stop · laps ${cycle.firstLap}–${cycle.lastLap}`}
      </div>
      {/* Summary */}
      <div className="grid grid-cols-4 gap-2 border-b px-4 pb-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <SummaryBox label="Your pit loss" value={focusRow ? secToDisplay(focusRow.timing.totalPitLoss) : "—"} />
        <SummaryBox label="Cycle avg" value={secToDisplay(avgPitLoss)} />
        <SummaryBox label="Best stop" value={bestRow ? secToDisplay(bestRow.timing.totalPitLoss) : "—"} sub={bestRow ? `#${bestRow.carNum}` : undefined} />
        <SummaryBox label="Cars" value={String(rows.length)} />
      </div>

      {/* Table: fits the side panel; only the rows scroll (no visible scrollbar) */}
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <table className="w-full table-fixed text-[11px]">
          <colgroup>
            <col style={{ width: "13%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <SortHeader label="Car" sortKey="car" current={sortKey} arrow={sortArrow("car")} onClick={handleSort} />
              <SortHeader label="Lap" sortKey="inLap" current={sortKey} arrow={sortArrow("inLap")} onClick={handleSort} />
              <th className="px-1 py-2 text-left font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>In-lap</th>
              <SortHeader label="Pit" sortKey="pitRoad" current={sortKey} arrow={sortArrow("pitRoad")} onClick={handleSort} />
              <th className="px-1 py-2 text-left font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Out-lap</th>
              <th className="px-1 py-2 text-left font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Grn avg</th>
              <SortHeader label="Loss" sortKey="pitLoss" current={sortKey} arrow={sortArrow("pitLoss")} onClick={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const mine = focusRow?.timing.totalPitLoss;
              const theirs = row.timing.totalPitLoss;
              const lossColor =
                typeof mine === "number" && typeof theirs === "number" ? (theirs <= mine ? "#4ade80" : "#f87171") : "rgba(255,255,255,0.9)";
              return (
                <tr key={`${row.carNum}-${row.pitLap}`} style={{ background: row.isFocus ? "rgba(244,140,52,0.12)" : "transparent", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td className={`${cell} font-mono font-bold`} style={{ color: row.isFocus ? "#F48C34" : "rgba(255,255,255,0.85)" }}>#{row.carNum}</td>
                  <td className={cell} style={{ color: "rgba(255,255,255,0.5)" }}>{row.pitLap}</td>
                  <td className={cell} style={{ color: "rgba(255,255,255,0.8)" }}>{secToDisplay(row.timing.inLapTime)}</td>
                  <td className={cell} style={{ color: "rgba(255,255,255,0.8)" }}>{secToDisplay(row.timing.pitRoadTime)}</td>
                  <td className={cell} style={{ color: "rgba(255,255,255,0.8)" }}>
                    {secToDisplay(row.outLap)}
                    {row.outLapWhole ? "*" : ""}
                  </td>
                  <td className={cell} style={{ color: "rgba(255,255,255,0.5)" }}>{secToDisplay(row.timing.avgGreenLapTime)}</td>
                  <td className={`${cell} font-bold`} style={{ color: lossColor }}>{secToDisplay(row.timing.totalPitLoss)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-3 pb-3 pt-2 text-[10px] leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
          {sorted.some((r) => r.timing.source === "facts")
            ? "Pit = official time in the pit lane, where the timing has it. Loss = time lost against the car's green-flag pace; under a caution, against cars on track then (it can come out ahead)."
            : "Pit = time in the pit lane. Loss = in-lap and out-lap time over the car's green-flag average."}
          {sorted.some((r) => r.outLapWhole) && " * The whole out-lap: at this track the pit box is before the timing line, so the stop falls in the in-lap."}
        </div>
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
      className="text-left px-1 py-2 font-medium cursor-pointer select-none hover:text-white transition-colors"
      style={{ color: current === sortKey ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)" }}
      onClick={() => onClick(sortKey)}
    >
      {label}{arrow}
    </th>
  );
}

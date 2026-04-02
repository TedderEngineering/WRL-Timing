import { useState, useMemo } from "react";
import type { RaceChartData } from "@shared/types";
import { CarPicker } from "./CarPicker";

interface GapEvolutionPanelProps {
  data: RaceChartData;
  focusNum: number;
  activeLap: number;
  compSet?: Set<number>;
  classView?: string;
}

// Special sentinel for "Field Average" mode
const FIELD_AVG = -1;

function buildCumulativeTime(laps: { l: number; ltSec: number }[]): Map<number, number> {
  const map = new Map<number, number>();
  let cum = 0;
  for (const lap of laps) {
    cum += lap.ltSec;
    map.set(lap.l, cum);
  }
  return map;
}

function secToDisplay(sec: number | null): string {
  if (sec === null) return "—";
  const abs = Math.abs(sec);
  const sign = sec < 0 ? "-" : "+";
  const m = Math.floor(abs / 60);
  const s = (abs % 60).toFixed(2).padStart(5, "0");
  return sign + (m > 0 ? `${m}:${s}` : `${s}s`);
}

function formatGap(
  sec: number | null,
  unit: "time" | "pct",
  avgLapSec: number | null
): string {
  if (sec === null) return "—";
  if (unit === "pct") {
    const base = avgLapSec ?? 90;
    const pct = (sec / base) * 100;
    return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  }
  return secToDisplay(sec);
}

export function GapEvolutionPanel({ data, focusNum, activeLap, compSet, classView = "" }: GapEvolutionPanelProps) {
  // Default to Field Average if compSet available, else null (picker)
  const [compareNum, setCompareNum] = useState<number | null>(compSet ? FIELD_AVG : null);
  const [showPicker, setShowPicker] = useState(compSet ? false : true);
  const [gapUnit, setGapUnit] = useState<"time" | "pct">("time");

  const handleSelect = (num: number) => {
    setCompareNum(num);
    setShowPicker(false);
  };

  const handleSelectFieldAvg = () => {
    setCompareNum(FIELD_AVG);
    setShowPicker(false);
  };

  const isFieldAvg = compareNum === FIELD_AVG;

  // Compute the scope label for field average
  const fieldScope = useMemo(() => {
    if (!compSet || compSet.size === 0) {
      const allNums = Object.keys(data.cars).map(Number);
      return { label: "All Classes", count: allNums.filter((n) => n !== focusNum).length };
    }
    const compNums = [...compSet].filter((n) => n !== focusNum);
    if (compNums.length <= 3) {
      return { label: compNums.map((n) => "#" + n).join(", "), count: compNums.length };
    }
    return { label: `${compNums.length} cars`, count: compNums.length };
  }, [data, compSet, focusNum]);

  // Build field average cumulative time (avg lap time per lap, accumulated)
  const fieldAvgCum = useMemo(() => {
    if (!isFieldAvg) return null;

    const targetNums = compSet && compSet.size > 0
      ? [...compSet].filter((n) => n !== focusNum)
      : Object.keys(data.cars).map(Number).filter((n) => n !== focusNum);

    if (targetNums.length === 0) return null;

    const maxLap = data.maxLap;
    const map = new Map<number, number>();
    let cum = 0;

    for (let lap = 1; lap <= maxLap; lap++) {
      let sum = 0;
      let cnt = 0;
      for (const cn of targetNums) {
        const carLaps = data.cars[String(cn)]?.laps;
        const ld = carLaps?.find((l) => l.l === lap);
        if (ld && ld.ltSec > 1) {
          sum += ld.ltSec;
          cnt++;
        }
      }
      if (cnt > 0) {
        cum += sum / cnt;
        map.set(lap, cum);
      }
    }

    return map;
  }, [data, compSet, focusNum, isFieldAvg]);

  // Compute gaps over the last 10 laps
  const gapData = useMemo(() => {
    if (compareNum === null) return null;

    const focusCar = data.cars[String(focusNum)];
    if (!focusCar) return null;

    const focusCum = buildCumulativeTime(focusCar.laps);

    let compareCum: Map<number, number> | null = null;
    if (isFieldAvg) {
      compareCum = fieldAvgCum;
    } else {
      const compareCar = data.cars[String(compareNum)];
      if (!compareCar) return null;
      compareCum = buildCumulativeTime(compareCar.laps);
    }
    if (!compareCum) return null;

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
  }, [data, focusNum, compareNum, activeLap, isFieldAvg, fieldAvgCum]);

  const focusAvgLapSec = useMemo(() => {
    const laps = data.cars[String(focusNum)]?.laps ?? [];
    const cutoff = data.greenPaceCutoff ?? 130;
    const recent = laps
      .filter((l) => l.flag === "GF" && l.ltSec > 1 && l.ltSec < cutoff)
      .slice(-10);
    if (!recent.length) return null;
    return recent.reduce((sum, l) => sum + l.ltSec, 0) / recent.length;
  }, [data, focusNum, activeLap]);

  const leaderData = useMemo(() => {
    // Find the leader at activeLap (the car where p === 1)
    let leaderNum: number | null = null;
    for (const [numStr, car] of Object.entries(data.cars)) {
      const ld = car.laps.find((l) => l.l === activeLap);
      if (ld && ld.p === 1) {
        leaderNum = Number(numStr);
        break;
      }
    }
    if (leaderNum === null) return null;

    const focusIsLeader = leaderNum === focusNum;

    // Build cumulative times for both cars
    const focusLaps = data.cars[String(focusNum)]?.laps ?? [];
    const leaderLaps = data.cars[String(leaderNum)]?.laps ?? [];
    const focusCum = buildCumulativeTime(focusLaps);
    const leaderCum = buildCumulativeTime(leaderLaps);

    // Current gap to leader (positive = focus is behind)
    const ft = focusCum.get(activeLap);
    const lt = leaderCum.get(activeLap);
    if (ft === undefined || lt === undefined) return null;
    const currentGapSec = ft - lt;

    // Rate of change: compute gap over the last 10 green-flag laps
    const cutoff = data.greenPaceCutoff ?? 130;
    const recentLaps: number[] = [];
    for (let l = activeLap; l >= Math.max(1, activeLap - 9); l--) {
      const fl = focusLaps.find((d) => d.l === l);
      const ll = leaderLaps.find((d) => d.l === l);
      if (
        fl && ll &&
        fl.flag === "GF" && ll.flag === "GF" &&
        fl.ltSec < cutoff && ll.ltSec < cutoff
      ) {
        const fg = focusCum.get(l);
        const lg = leaderCum.get(l);
        if (fg !== undefined && lg !== undefined) {
          recentLaps.push(fg - lg);
        }
      }
    }

    let ratePerLap: number | null = null;
    if (recentLaps.length >= 2) {
      // Rate = change in gap per lap (positive = losing time to leader each lap)
      ratePerLap =
        (recentLaps[0] - recentLaps[recentLaps.length - 1]) /
        (recentLaps.length - 1);
    }

    // Leader average lap time (for "one lap down" threshold calculation)
    const leaderAvgLap =
      leaderLaps
        .filter((l) => l.flag === "GF" && l.ltSec > 1 && l.ltSec < cutoff)
        .slice(-10)
        .reduce(
          (acc, l, _, arr) => acc + l.ltSec / arr.length,
          0
        ) || null;

    // Projected laps until one lap down
    // A lap down occurs when the gap equals one full leader lap
    let lapsToDown: number | null = null;
    if (!focusIsLeader && ratePerLap !== null && leaderAvgLap !== null) {
      if (currentGapSec >= leaderAvgLap) {
        lapsToDown = -1; // already a lap down
      } else if (ratePerLap <= 0) {
        lapsToDown = Infinity; // gap closing or stable
      } else {
        const gapRemaining = leaderAvgLap - currentGapSec;
        lapsToDown = Math.max(0, gapRemaining / ratePerLap);
      }
    }

    return {
      focusIsLeader,
      currentGapSec,
      ratePerLap,
      lapsToDown,
      leaderNum,
    };
  }, [data, focusNum, activeLap]);

  const compCarData = useMemo(() => {
    if (!compSet || compSet.size === 0) return [];
    const focusLaps = data.cars[String(focusNum)]?.laps ?? [];
    const focusCum = buildCumulativeTime(focusLaps);
    const focusLapData = focusLaps.find((l) => l.l === activeLap);
    const focusPos = focusLapData
      ? classView
        ? focusLapData.cp
        : focusLapData.p
      : null;
    const focusCumAtLap = focusCum.get(activeLap) ?? null;

    return [...compSet]
      .filter((n) => n !== focusNum)
      .sort((a, b) => a - b)
      .map((carNum) => {
        const car = data.cars[String(carNum)];
        if (!car) return null;
        const compLaps = car.laps;
        const compLapData = compLaps.find((l) => l.l === activeLap);
        const compPos = compLapData
          ? classView
            ? compLapData.cp
            : compLapData.p
          : null;
        const compCum = buildCumulativeTime(compLaps);
        const compCumAtLap = compCum.get(activeLap) ?? null;

        // Gap: positive = focus is behind this comp car
        const gapSec =
          focusCumAtLap !== null && compCumAtLap !== null
            ? focusCumAtLap - compCumAtLap
            : null;

        // Relative position: negative posDiff = comp is ahead
        let relation: "ahead" | "behind" | "same" | null = null;
        if (focusPos !== null && compPos !== null) {
          if (compPos < focusPos) relation = "ahead";
          else if (compPos > focusPos) relation = "behind";
          else relation = "same";
        }

        return {
          carNum,
          team: car.team ?? "",
          cls: car.cls ?? "",
          compPos,
          relation,
          gapSec,
        };
      })
      .filter(Boolean);
  }, [data, focusNum, activeLap, compSet, classView]);

  if (showPicker || compareNum === null) {
    return (
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-4 py-2 text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
          Select a car to compare gaps with #{focusNum}
        </div>
        {/* Field Average option at top */}
        <button
          onClick={handleSelectFieldAvg}
          className="flex items-center gap-3 px-4 py-2.5 border-b cursor-pointer transition-colors hover:bg-white/[0.04]"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <span
            className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0"
            style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc" }}
          >
            Ø
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-white">Field Avg</span>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
              {fieldScope.label} · {fieldScope.count} cars
            </span>
          </div>
        </button>
        <CarPicker
          data={data}
          focusNum={focusNum}
          selectedNum={compareNum !== FIELD_AVG ? compareNum : null}
          onSelect={handleSelect}
        />
      </div>
    );
  }

  const compareCar = !isFieldAvg ? data.cars[String(compareNum)] : null;

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
          {isFieldAvg ? (
            <>
              <span
                className="font-mono text-[11px] font-bold px-1 py-0.5 rounded shrink-0"
                style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc" }}
              >
                Ø
              </span>
              <span className="text-xs font-semibold text-white">Field Avg</span>
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                · {fieldScope.count} cars
              </span>
            </>
          ) : (
            <>
              <span className="font-mono font-bold text-xs text-white">#{compareNum}</span>
              <span className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.45)", maxWidth: 160 }}>
                {compareCar?.team}
              </span>
            </>
          )}
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>▼</span>
        </button>
      </div>

      {/* Unit toggle */}
      <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-white/[0.06]">
        <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">
          Display
        </span>
        <div className="flex rounded overflow-hidden border border-white/[0.12]">
          <button
            onClick={() => setGapUnit("time")}
            className={`px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
              gapUnit === "time"
                ? "bg-white/[0.15] text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            Time
          </button>
          <button
            onClick={() => setGapUnit("pct")}
            className={`px-2.5 py-0.5 text-[11px] font-semibold transition-colors border-l border-white/[0.12] ${
              gapUnit === "pct"
                ? "bg-white/[0.15] text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            %
          </button>
        </div>
      </div>

      {!gapData ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>No overlapping laps</span>
        </div>
      ) : (
        <>
          {/* Stat boxes */}
          <div className="px-4 py-3 flex gap-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <StatBox label="Current Gap" value={formatGap(gapData.currentGap, gapUnit, focusAvgLapSec)} />
            <StatBox label="10L Min" value={formatGap(gapData.minGap, gapUnit, focusAvgLapSec)} />
            <StatBox label="10L Max" value={formatGap(gapData.maxGap, gapUnit, focusAvgLapSec)} />
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

          {/* Laps to Leader Down */}
          {leaderData && (
            <div className="px-3 py-2 border-b border-white/[0.06]">
              <div className="text-[9px] text-white/40 uppercase tracking-wider font-semibold mb-1.5">
                Laps to Leader Down
              </div>
              {leaderData.focusIsLeader ? (
                <div className="text-[11px] text-emerald-400 font-semibold">
                  Focus car is the leader
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {/* Gap to Leader */}
                  <div className="bg-white/[0.04] rounded px-2 py-1.5">
                    <div className="text-[9px] text-white/40 uppercase tracking-wider mb-0.5">
                      Gap to Leader
                    </div>
                    <div
                      className={`text-[12px] font-mono font-bold ${
                        leaderData.currentGapSec <= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {secToDisplay(leaderData.currentGapSec)}
                    </div>
                  </div>

                  {/* Rate per Lap */}
                  <div className="bg-white/[0.04] rounded px-2 py-1.5">
                    <div className="text-[9px] text-white/40 uppercase tracking-wider mb-0.5">
                      Rate/Lap
                    </div>
                    <div
                      className={`text-[12px] font-mono font-bold ${
                        leaderData.ratePerLap === null
                          ? "text-white/40"
                          : leaderData.ratePerLap > 0.5
                          ? "text-red-400"
                          : leaderData.ratePerLap > 0
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {leaderData.ratePerLap === null
                        ? "—"
                        : (leaderData.ratePerLap >= 0 ? "+" : "") +
                          leaderData.ratePerLap.toFixed(2) +
                          "s"}
                    </div>
                  </div>

                  {/* Laps to Down */}
                  <div className="bg-white/[0.04] rounded px-2 py-1.5">
                    <div className="text-[9px] text-white/40 uppercase tracking-wider mb-0.5">
                      Laps to Down
                    </div>
                    <div
                      className={`text-[12px] font-mono font-bold ${
                        leaderData.lapsToDown === null
                          ? "text-white/40"
                          : leaderData.lapsToDown === -1
                          ? "text-red-400"
                          : leaderData.lapsToDown === Infinity
                          ? "text-emerald-400"
                          : leaderData.lapsToDown < 30
                          ? "text-red-400"
                          : leaderData.lapsToDown < 80
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {leaderData.lapsToDown === null
                        ? "—"
                        : leaderData.lapsToDown === -1
                        ? "Lapped"
                        : leaderData.lapsToDown === Infinity
                        ? "∞ Closing"
                        : `≈${Math.round(leaderData.lapsToDown)} laps`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

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
                      {formatGap(g.gap, gapUnit, focusAvgLapSec)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-bold" style={{
                      color: g.delta === null ? "rgba(255,255,255,0.2)"
                        : g.delta < -0.01 ? "#4ade80"
                        : g.delta > 0.01 ? "#f87171"
                        : "rgba(255,255,255,0.3)",
                    }}>
                      {formatGap(g.delta, gapUnit, focusAvgLapSec)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Comparison cars — position and gap at active lap */}
          {compCarData.length > 0 && (
            <div className="px-3 py-2">
              <div className="text-[9px] text-white/40 uppercase tracking-wider font-semibold mb-1.5">
                Comparison Cars{" "}
                <span className="text-white/25 normal-case tracking-normal font-normal">
                  at L{activeLap}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {compCarData.map((car) => {
                  if (!car) return null;
                  const relColor =
                    car.relation === "ahead"
                      ? "text-emerald-400"
                      : car.relation === "behind"
                      ? "text-red-400"
                      : "text-amber-400";
                  const relIcon =
                    car.relation === "ahead"
                      ? "▲"
                      : car.relation === "behind"
                      ? "▼"
                      : "=";
                  const relLabel =
                    car.relation === "ahead"
                      ? `P${car.compPos} ahead`
                      : car.relation === "behind"
                      ? `P${car.compPos} behind`
                      : `P${car.compPos} same`;

                  return (
                    <div
                      key={car.carNum}
                      className="flex items-center gap-2 py-0.5 text-[11px]"
                    >
                      <span className="font-mono font-bold text-white w-9 shrink-0">
                        #{car.carNum}
                      </span>
                      <span className="text-white/40 flex-1 truncate text-[10px]">
                        {car.team}
                      </span>
                      <span className="font-mono text-white/50 text-[10px] shrink-0">
                        {car.gapSec !== null ? secToDisplay(car.gapSec) : "—"}
                      </span>
                      <span
                        className={`font-semibold shrink-0 text-[10px] ${relColor}`}
                      >
                        {relIcon} {relLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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

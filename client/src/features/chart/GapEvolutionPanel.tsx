import { useState, useMemo } from "react";
import type { RaceChartData } from "@shared/types";

interface GapEvolutionPanelProps {
  data: RaceChartData;
  focusNum: number;
  activeLap: number;
  compSet?: Set<number>;
}

function secToDisplay(sec: number): string {
  const abs = Math.abs(sec);
  const sign = sec < 0 ? "-" : "+";
  if (abs < 60) return `${sign}${abs.toFixed(2)}s`;
  const m = Math.floor(abs / 60);
  const s = abs - m * 60;
  return `${sign}${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function formatGap(
  sec: number | null,
  unit: "time" | "pct",
  avgLapSec: number | null
): string {
  if (sec === null) return "\u2014";
  if (unit === "pct") {
    const base = avgLapSec ?? 90;
    const pct = (sec / base) * 100;
    return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  }
  return secToDisplay(sec);
}

export function GapEvolutionPanel({ data, focusNum, activeLap, compSet }: GapEvolutionPanelProps) {
  // gapRefSet: empty = Field Avg (use all compSet cars), non-empty = custom selection
  const [gapRefSet, setGapRefSet] = useState<Set<number>>(new Set());
  const [gapRefClassFilter, setGapRefClassFilter] = useState<string>("");
  const [gapRefSearch, setGapRefSearch] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(true);
  const [gapUnit, setGapUnit] = useState<"time" | "pct">("time");

  // Stable string key for useMemo dependencies (Set mutations don't trigger re-renders)
  const gapRefKey = [...gapRefSet].sort((a, b) => a - b).join(",");

  const focusAvgLapSec = useMemo(() => {
    const laps = data.cars[String(focusNum)]?.laps ?? [];
    const cutoff = data.greenPaceCutoff ?? 130;
    const recent = laps
      .filter((l) => l.flag === "GF" && l.ltSec > 1 && l.ltSec < cutoff)
      .slice(-10);
    if (!recent.length) return null;
    return recent.reduce((sum, l) => sum + l.ltSec, 0) / recent.length;
  }, [data, focusNum, activeLap]);

  // The cars whose cumulative time is averaged for the gap reference
  const gapTargetNums = useMemo(() => {
    if (gapRefSet.size === 0) {
      // Field Avg: use all compSet cars except focus
      return [...(compSet ?? [])].filter((n) => n !== focusNum);
    }
    return [...gapRefSet].filter((n) => n !== focusNum);
  }, [gapRefKey, compSet, focusNum]);

  // Label shown in the VS row
  const gapRefLabel = useMemo(() => {
    if (gapRefSet.size === 0) {
      const n = [...(compSet ?? [])].filter((n) => n !== focusNum).length;
      return `Field Avg \u00b7 ${n} cars`;
    }
    if (gapRefSet.size === 1) {
      const num = [...gapRefSet][0];
      const car = data.cars[String(num)];
      return `#${num}${car?.team ? " " + car.team : ""}`;
    }
    // Check if entire class is selected
    const classes = Object.keys(data.classGroups ?? {});
    for (const cls of classes) {
      const clsCars = (data.classGroups[cls] ?? []).filter((n: number) => n !== focusNum);
      if (
        clsCars.length > 0 &&
        clsCars.length === gapRefSet.size &&
        clsCars.every((n: number) => gapRefSet.has(n))
      ) {
        return `${cls} Avg \u00b7 ${clsCars.length} cars`;
      }
    }
    return `Custom \u00b7 ${gapRefSet.size} cars`;
  }, [gapRefKey, compSet, focusNum, data]);

  // Compute per-lap gap vs reference over the last 10 laps
  const gapData = useMemo(() => {
    const focusCar = data.cars[String(focusNum)];
    if (!focusCar) return null;

    // Build per-lap reference time map (avg ltSec of gapTargetNums at each lap)
    const refLapTime = new Map<number, number>();
    for (let lap = 1; lap <= data.maxLap; lap++) {
      let sum = 0;
      let cnt = 0;
      for (const cn of gapTargetNums) {
        const carLaps = data.cars[String(cn)]?.laps;
        const ld = carLaps?.find((l) => l.l === lap);
        if (ld && ld.ltSec > 1) {
          sum += ld.ltSec;
          cnt++;
        }
      }
      if (cnt > 0) refLapTime.set(lap, sum / cnt);
    }

    const focusLapMap = new Map<number, number>();
    for (const ld of focusCar.laps) {
      if (ld.ltSec > 1) focusLapMap.set(ld.l, ld.ltSec);
    }

    const startLap = Math.max(1, activeLap - 9);
    const gaps: { lap: number; gap: number; delta: number | null }[] = [];
    let prevGap: number | null = null;

    for (let lap = startLap; lap <= activeLap; lap++) {
      const ft = focusLapMap.get(lap);
      const rt = refLapTime.get(lap);
      if (ft === undefined || rt === undefined) continue;

      const gap = ft - rt; // positive = focus slower this lap
      const delta = prevGap !== null ? gap - prevGap : null;
      gaps.push({ lap, gap, delta });
      prevGap = gap;
    }

    if (gaps.length === 0) return null;

    const currentGap = gaps[gaps.length - 1].gap;

    // Last 5 valid gaps in the window (most recent)
    const recent5 = gaps.filter((g) => g.gap !== null).slice(-5);
    let avgDelta5: number | null = null;
    if (recent5.length >= 2) {
      const totalChange = recent5[recent5.length - 1].gap - recent5[0].gap;
      avgDelta5 = totalChange / (recent5.length - 1);
    }

    // Trend: compare first and last gap in window
    let trend: "Closing" | "Fading" | "Steady" = "Steady";
    if (gaps.length >= 2) {
      const diff = gaps[gaps.length - 1].gap - gaps[0].gap;
      if (diff < -0.3) trend = "Closing";
      else if (diff > 0.3) trend = "Fading";
    }

    return { gaps, currentGap, avgDelta5, trend };
  }, [data, focusNum, activeLap, gapRefKey, gapTargetNums]);

  const leaderCalc = useMemo(() => {
    if (!activeLap || !gapData) return null;

    // Find the leader at activeLap (lowest p value)
    let leaderNum: number | null = null;
    let leaderPos = Infinity;
    for (const [numStr, car] of Object.entries(data.cars)) {
      const ld = car.laps.find((l) => l.l === activeLap);
      if (ld && ld.p > 0 && ld.p < leaderPos) {
        leaderPos = ld.p;
        leaderNum = Number(numStr);
      }
    }
    if (leaderNum === null) return null;

    const focusIsLeader = leaderNum === focusNum;

    // Per-lap delta between focus and leader over last 10 laps
    const focusLaps = data.cars[String(focusNum)]?.laps ?? [];
    const leaderLaps = data.cars[String(leaderNum)]?.laps ?? [];

    const deltas: number[] = [];
    for (let l = activeLap; l >= Math.max(1, activeLap - 9); l--) {
      const fl = focusLaps.find((d) => d.l === l);
      const ll = leaderLaps.find((d) => d.l === l);
      if (fl && ll && fl.ltSec > 1 && ll.ltSec > 1) {
        deltas.push(fl.ltSec - ll.ltSec);
      }
    }

    let avgRatePerLap: number | null = null;
    if (deltas.length >= 1) {
      avgRatePerLap = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    }

    // Cumulative gap to leader
    let focusCum = 0, leaderCum = 0;
    for (let l = 1; l <= activeLap; l++) {
      const fl = focusLaps.find((d) => d.l === l);
      const ll = leaderLaps.find((d) => d.l === l);
      if (fl?.ltSec) focusCum += fl.ltSec;
      if (ll?.ltSec) leaderCum += ll.ltSec;
    }
    const cumGapSec = focusCum - leaderCum; // positive = focus behind

    // Leader avg lap time
    const leaderAvgLap =
      leaderLaps
        .filter((l) => l.ltSec > 1)
        .slice(-10)
        .reduce((acc, l, _, arr) => acc + l.ltSec / arr.length, 0) || null;

    // Laps to leader down or laps to catch
    let lapsResult: { label: string; value: string; color: string } | null = null;

    if (focusIsLeader) {
      lapsResult = {
        label: "Status",
        value: "Leading",
        color: "text-emerald-400",
      };
    } else if (avgRatePerLap === null || leaderAvgLap === null) {
      lapsResult = {
        label: "Laps to Down",
        value: "\u2014",
        color: "text-white/40",
      };
    } else {
      const lapsDown = cumGapSec / leaderAvgLap; // fractional laps behind leader
      const wholeDown = Math.floor(lapsDown);
      const remainder = cumGapSec % leaderAvgLap; // seconds into current lap deficit

      if (avgRatePerLap > 0) {
        // Focus is SLOWER than leader — compute laps until next lap down
        if (wholeDown >= 1) {
          // Already lapped — show laps until ANOTHER lap down
          const lapsToNextDown = (leaderAvgLap - remainder) / avgRatePerLap;
          lapsResult = {
            label: `${wholeDown} Lap${wholeDown !== 1 ? "s" : ""} Down \u00b7 Next in`,
            value: `\u2248${Math.round(lapsToNextDown)} laps`,
            color: lapsToNextDown < 20 ? "text-red-400" : "text-amber-400",
          };
        } else {
          // Not yet lapped — show laps until first lap down
          const lapsToDown = (leaderAvgLap - cumGapSec) / avgRatePerLap;
          lapsResult = {
            label: "Laps to Down",
            value: lapsToDown <= 0 ? "Imminent" : `\u2248${Math.round(lapsToDown)} laps`,
            color: lapsToDown < 30 ? "text-red-400"
              : lapsToDown < 80 ? "text-amber-400"
              : "text-emerald-400",
          };
        }
      } else {
        // Focus is FASTER than leader — compute laps to close the gap
        const lapsToClose = Math.abs(cumGapSec) / Math.abs(avgRatePerLap);
        if (wholeDown >= 1) {
          lapsResult = {
            label: `${wholeDown} Lap${wholeDown !== 1 ? "s" : ""} Down \u00b7 Closing`,
            value: `\u2248${Math.round(lapsToClose)} to unlap`,
            color: "text-emerald-400",
          };
        } else {
          lapsResult = {
            label: "Gap Closing",
            value: `\u2248${Math.round(lapsToClose)} laps`,
            color: "text-emerald-400",
          };
        }
      }
    }

    return { focusIsLeader, cumGapSec, avgRatePerLap, lapsResult, leaderNum };
  }, [data, focusNum, activeLap, gapData]);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* VS row — label left, unit toggle right */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] cursor-pointer select-none hover:bg-white/[0.03]"
        onClick={() => setPickerOpen((o) => !o)}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-white/40 font-semibold uppercase tracking-wider text-[9px]">
            VS
          </span>
          <span className="text-white font-semibold truncate max-w-[160px] text-[12px]">
            {gapRefLabel}
          </span>
          <span className="text-white/30 text-[10px] ml-1">
            {pickerOpen ? "\u25B2" : "\u25BC"}
          </span>
        </div>
        <div
          className="flex rounded overflow-hidden border border-white/[0.12]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setGapUnit("time")}
            className={`px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${
              gapUnit === "time"
                ? "bg-white/[0.15] text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            Time
          </button>
          <button
            onClick={() => setGapUnit("pct")}
            className={`px-2.5 py-0.5 text-[10px] font-semibold transition-colors border-l border-white/[0.12] ${
              gapUnit === "pct"
                ? "bg-white/[0.15] text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            %
          </button>
        </div>
      </div>

      {/* Inline picker */}
      {pickerOpen && (
      <div className="border-b border-white/[0.06]">

        {/* Class filter chips */}
        <div className="flex flex-wrap gap-1.5 px-3 pt-2 pb-1.5">
          {["", ...Object.keys(data.classGroups ?? {}).sort()].map((cls) => {
            const label = cls === "" ? "All" : cls;
            const isActive = gapRefClassFilter === cls;
            const clsColors: Record<string, string> = {
              GP1: "#f87171", GP2: "#fbbf24", GP3: "#a78bfa",
              GTO: "#60a5fa", GTU: "#4ade80",
            };
            const activeColor = cls ? clsColors[cls] ?? "#4472C4" : "#4472C4";
            return (
              <button
                key={cls}
                onClick={() => setGapRefClassFilter(cls)}
                className="px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-colors border"
                style={
                  isActive
                    ? {
                        background: activeColor + "33",
                        borderColor: activeColor,
                        color: activeColor,
                      }
                    : {
                        background: "transparent",
                        borderColor: "rgba(255,255,255,0.12)",
                        color: "rgba(255,255,255,0.35)",
                      }
                }
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="px-3 pb-1.5 relative">
          <span className="absolute left-5 top-1/2 -translate-y-1/2 text-white/30 text-[11px] pointer-events-none">
            &#128269;
          </span>
          <input
            type="text"
            value={gapRefSearch}
            onChange={(e) => setGapRefSearch(e.target.value)}
            placeholder="Search car # or team…"
            className="w-full bg-white/[0.04] border border-white/[0.10] rounded-md pl-6 pr-2 py-1
                       text-[11px] text-white placeholder-white/25 outline-none
                       focus:border-white/30 font-mono"
          />
        </div>

        {/* Car list */}
        <div className="overflow-y-auto px-2 pb-1" style={{ maxHeight: 120 }}>
          {(() => {
            const q = gapRefSearch.trim().toLowerCase();
            const allCars = Object.keys(data.cars)
              .map(Number)
              .filter((n) => n !== focusNum)
              .filter((n) => {
                const c = data.cars[String(n)];
                if (gapRefClassFilter && c.cls !== gapRefClassFilter) return false;
                if (q && !String(n).includes(q) && !(c.team ?? "").toLowerCase().includes(q))
                  return false;
                return true;
              })
              .sort((a, b) => a - b);

            const showFieldAvg = !q && !gapRefClassFilter;
            const isFieldAvgChecked = gapRefSet.size === 0;

            return (
              <>
                {showFieldAvg && (
                  <label className="flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer
                                    hover:bg-white/[0.04] mb-1 border-b border-white/[0.06] pb-2">
                    <input
                      type="checkbox"
                      checked={isFieldAvgChecked}
                      onChange={() => setGapRefSet(new Set())}
                      className="accent-blue-400 w-3 h-3 cursor-pointer"
                    />
                    <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                    <span className="font-mono font-bold text-blue-400 text-[11px] w-8 shrink-0">&mdash;</span>
                    <span className="text-white/60 text-[10px] flex-1">
                      Field Avg ({[...(compSet ?? [])].filter((n) => n !== focusNum).length} cars)
                    </span>
                  </label>
                )}
                {allCars.map((n) => {
                  const c = data.cars[String(n)];
                  const isChecked = gapRefSet.has(n);
                  const isInComp = compSet?.has(n);
                  const swatchColor = isInComp ? "#60a5fa" : "rgba(255,255,255,0.2)";
                  return (
                    <label
                      key={n}
                      className={`flex items-center gap-2 px-1.5 py-0.5 rounded cursor-pointer
                                  hover:bg-white/[0.04] ${isChecked ? "bg-white/[0.06]" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setGapRefSet((prev) => {
                            const next = new Set(prev);
                            if (next.has(n)) next.delete(n);
                            else next.add(n);
                            return next;
                          });
                        }}
                        className="accent-blue-400 w-3 h-3 cursor-pointer"
                      />
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: swatchColor }}
                      />
                      <span className="font-mono font-bold text-white text-[11px] w-8 shrink-0">
                        #{n}
                      </span>
                      <span className="text-white/50 text-[10px] flex-1 truncate">
                        {c.team ?? ""}
                      </span>
                      <span className="text-white/25 text-[9px] shrink-0">{c.cls}</span>
                    </label>
                  );
                })}
                {allCars.length === 0 && (
                  <div className="text-center text-white/25 text-[11px] py-3">
                    No cars match
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Action buttons */}
        <div className="flex gap-1.5 px-3 py-2 border-t border-white/[0.06]">
          {[
            {
              label: "Select All",
              action: () => {
                const q = gapRefSearch.trim().toLowerCase();
                const visible = Object.keys(data.cars)
                  .map(Number)
                  .filter((n) => n !== focusNum)
                  .filter((n) => {
                    const c = data.cars[String(n)];
                    if (gapRefClassFilter && c.cls !== gapRefClassFilter) return false;
                    if (q && !String(n).includes(q) && !(c.team ?? "").toLowerCase().includes(q))
                      return false;
                    return true;
                  });
                setGapRefSet((prev) => {
                  const next = new Set(prev);
                  visible.forEach((n) => next.add(n));
                  return next;
                });
              },
            },
            {
              label: "Clear",
              action: () => {
                const q = gapRefSearch.trim().toLowerCase();
                const visible = Object.keys(data.cars)
                  .map(Number)
                  .filter((n) => n !== focusNum)
                  .filter((n) => {
                    const c = data.cars[String(n)];
                    if (gapRefClassFilter && c.cls !== gapRefClassFilter) return false;
                    if (q && !String(n).includes(q) && !(c.team ?? "").toLowerCase().includes(q))
                      return false;
                    return true;
                  });
                setGapRefSet((prev) => {
                  const next = new Set(prev);
                  visible.forEach((n) => next.delete(n));
                  return next;
                });
              },
            },
            {
              label: "Select Class",
              disabled: !gapRefClassFilter,
              action: () => {
                if (!gapRefClassFilter) return;
                const clsCars = (data.classGroups[gapRefClassFilter] ?? []).filter(
                  (n: number) => n !== focusNum
                );
                const allOn = clsCars.every((n: number) => gapRefSet.has(n));
                setGapRefSet((prev) => {
                  const next = new Set(prev);
                  if (allOn) clsCars.forEach((n: number) => next.delete(n));
                  else clsCars.forEach((n: number) => next.add(n));
                  return next;
                });
              },
            },
          ].map(({ label, action, disabled }) => (
            <button
              key={label}
              onClick={action}
              disabled={disabled}
              className="flex-1 py-1 text-[10px] font-semibold rounded border transition-colors
                         border-white/[0.12] text-white/40 hover:text-white/70
                         hover:border-white/25 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      )}

      {!gapData ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>No overlapping laps</span>
        </div>
      ) : (
        <>
          {/* Stat boxes */}
          <div className="grid grid-cols-3 gap-px bg-white/[0.06] border-b border-white/[0.06]">
            {/* Current Gap */}
            <div className="bg-[#0d0d1f] px-3 py-2">
              <div className="text-[9px] text-white/40 uppercase tracking-wider font-semibold mb-0.5">
                Current Gap
              </div>
              <div className={`text-[14px] font-mono font-bold ${
                gapData.currentGap === null ? "text-white/40"
                : gapData.currentGap < 0 ? "text-emerald-400"
                : "text-red-400"
              }`}>
                {formatGap(gapData.currentGap, gapUnit, focusAvgLapSec)}
              </div>
            </div>

            {/* 5L Avg */}
            <div className="bg-[#0d0d1f] px-3 py-2">
              <div className="text-[9px] text-white/40 uppercase tracking-wider font-semibold mb-0.5">
                5L Avg {"\u0394"}
              </div>
              <div className={`text-[14px] font-mono font-bold ${
                gapData.avgDelta5 === null ? "text-white/40"
                : gapData.avgDelta5 < 0 ? "text-emerald-400"
                : "text-red-400"
              }`}>
                {formatGap(gapData.avgDelta5 ?? null, gapUnit, focusAvgLapSec)}
              </div>
            </div>

            {/* Trend */}
            <div className="bg-[#0d0d1f] px-3 py-2">
              <div className="text-[9px] text-white/40 uppercase tracking-wider font-semibold mb-0.5">
                Trend
              </div>
              <div className={`text-[14px] font-bold ${
                gapData.trend === "Closing" ? "text-emerald-400"
                : gapData.trend === "Fading" ? "text-red-400"
                : "text-white/60"
              }`}>
                {gapData.trend}
              </div>
            </div>
          </div>

          {/* Laps to leader */}
          {leaderCalc && (
            <div className="px-3 py-2 border-b border-white/[0.06]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-white/40 uppercase tracking-wider font-semibold">
                  {leaderCalc.lapsResult?.label ?? "Laps to Down"}
                </span>
                <span className={`text-[13px] font-mono font-bold ${
                  leaderCalc.lapsResult?.color ?? "text-white/40"
                }`}>
                  {leaderCalc.lapsResult?.value ?? "\u2014"}
                </span>
              </div>
              <div className="text-[9px] text-white/25 font-mono">
                Leader: #{leaderCalc.leaderNum} {"\u00b7"}{" "}
                Cum gap: {leaderCalc.cumGapSec?.toFixed(1)}s {"\u00b7"}{" "}
                Rate: {leaderCalc.avgRatePerLap?.toFixed(2)}s/lap
              </div>
            </div>
          )}

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
                      {formatGap(g.gap, gapUnit, focusAvgLapSec)}
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

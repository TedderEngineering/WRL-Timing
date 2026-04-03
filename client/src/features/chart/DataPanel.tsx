import { useState, useCallback, useRef } from "react";
import { formatLapTime, getCompColor, type LapInfoData } from "./chart-renderer";
import type { RaceChartData } from "@shared/types";
import { useAuth } from "../../features/auth/AuthContext";
import { hasTeamAccess } from "../../lib/utils";

interface DataPanelProps {
  info: LapInfoData | null;
  focusNum: number;
  compSet: Set<number>;
  data: RaceChartData;
  navPrev: () => void;
  navNext: () => void;
  setSidePanel: (panel: string | null) => void;
}

const FLAG_COLORS: Record<string, string> = {
  "GREEN": "#22c55e",
  "GF": "#22c55e",
  "FCY": "#f59e0b",
  "RED": "#ef4444",
};

function secToDisplay(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
}

export function DataPanel({ info, focusNum, compSet, data, navPrev, navNext, setSidePanel }: DataPanelProps) {
  const { user } = useAuth();
  const isTeam = hasTeamAccess(user);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showTeamToast = useCallback(() => {
    setToast("Interactive analysis is available with a Team subscription");
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Gated click handler — opens panel for Team users, shows toast for others
  const gatedClick = useCallback(
    (panel: string) => {
      if (isTeam) {
        setSidePanel(panel);
      } else {
        showTeamToast();
      }
    },
    [isTeam, setSidePanel, showTeamToast],
  );

  if (!info) {
    return (
      <div
        className="flex items-center overflow-hidden"
        style={{ height: 88, background: "#0c0e16", borderTop: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* Mobile nav */}
        <button onClick={navPrev} className="sm:hidden flex items-center justify-center w-9 shrink-0 h-full text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
          ◀
        </button>
        <div className="flex-1 text-center text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>
          Tap a lap or use ◀ ▶ to step
        </div>
        <button onClick={navNext} className="sm:hidden flex items-center justify-center w-9 shrink-0 h-full text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
          ▶
        </button>
      </div>
    );
  }

  const flagColor = FLAG_COLORS[info.lap.flag] || FLAG_COLORS["GREEN"] || "#22c55e";
  const flagLabel = info.lap.flag === "FCY" ? "FCY" : "Grn";
  const isPit = info.isPit;
  const timing = info.pitInfo?.timing;
  const posDeltaColor = info.posDelta > 0 ? "#4ade80" : info.posDelta < 0 ? "#f87171" : "rgba(255,255,255,0.3)";
  const posDeltaText = info.posDelta > 0 ? `▲${info.posDelta}` : info.posDelta < 0 ? `▼${Math.abs(info.posDelta)}` : "";

  return (
    <div
      className="relative flex items-stretch overflow-hidden"
      style={{ height: 88, background: "#0c0e16", borderTop: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* Mobile nav prev */}
      <button onClick={navPrev} className="sm:hidden flex items-center justify-center w-9 shrink-0 border-r border-white/[0.07] cursor-pointer active:bg-white/5" style={{ color: "rgba(255,255,255,0.4)" }}>
        ◀
      </button>

      {/* Zone 1 — Identity (140px) */}
      <div className="hidden sm:flex flex-col justify-center px-4 shrink-0" style={{ width: 140 }}>
        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="text-2xl font-extrabold tracking-tight leading-none text-white">L{info.lap.l}</span>
          <span className="text-lg font-bold leading-none" style={{ color: "rgba(255,255,255,0.45)" }}>P{info.lap.p}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-[7px] h-[7px] rounded-full shrink-0" style={{ background: flagColor }} />
          <span className="text-xs font-semibold" style={{ color: flagColor }}>{flagLabel}</span>
          {isPit && info.pitInfo && (
            <span className="text-[10px] font-bold rounded px-1.5 py-px" style={{
              background: "rgba(251,191,36,0.12)",
              border: "1px solid rgba(251,191,36,0.3)",
              color: "#fcd34d",
            }}>
              PIT
            </span>
          )}
          {posDeltaText && (
            <span className="text-[11px] font-bold ml-auto" style={{ color: posDeltaColor }}>{posDeltaText}</span>
          )}
        </div>
      </div>

      {/* Mobile: compact identity */}
      <div className="sm:hidden flex flex-col justify-center px-3 shrink-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-extrabold text-white">L{info.lap.l}</span>
          <span className="text-sm font-bold" style={{ color: "rgba(255,255,255,0.45)" }}>P{info.lap.p}</span>
          {posDeltaText && <span className="text-[11px] font-bold" style={{ color: posDeltaColor }}>{posDeltaText}</span>}
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: flagColor }} />
          <span className="text-[10px] font-semibold" style={{ color: flagColor }}>{flagLabel}</span>
          {isPit && <span className="text-[9px] font-bold text-amber-300">PIT</span>}
        </div>
      </div>

      <Divider />

      {/* Zone 2 — Pit details OR Lap time */}
      {isPit && timing ? (
        <div
          className="flex flex-col justify-center px-4 shrink-0 cursor-pointer hover:bg-white/[0.03] transition-colors"
          style={{ width: "auto", minWidth: 120, maxWidth: 420 }}
          onClick={() => gatedClick("pit")}
        >
          <ZoneLabel>{info.pitInfo?.pitLabel || "Pit Stop"}</ZoneLabel>
          <div className="flex gap-3 sm:gap-5">
            <PitField label="In-Lap" value={secToDisplay(timing.inLapTime)} />
            {timing.pitRoadTime !== null && <PitField label="Pit Road" value={secToDisplay(timing.pitRoadTime)} />}
            <PitField label="Out-Lap" value={timing.outLapTime != null ? secToDisplay(timing.outLapTime) : "—"} />
            <PitField label="Grn Avg" value={secToDisplay(timing.avgGreenLapTime)} />
            <PitField label="Pit Loss" value={secToDisplay(timing.totalPitLoss)} warn />
          </div>
        </div>
      ) : (
        <div className="flex flex-col justify-center px-4 shrink-0" style={{ width: 140 }}>
          <ZoneLabel>Lap Time</ZoneLabel>
          <div className="text-xl sm:text-[22px] font-bold tabular-nums leading-none text-white">
            {info.paceInfo?.focusTime || formatLapTime(info.lap.lt)}
          </div>
        </div>
      )}

      {/* Zone 3+4 — VS Field + Delta (racing laps only, clickable → Gap Evolution) */}
      {!isPit && info.paceInfo && (
        <>
          <Divider />
          <div
            className="hidden lg:flex items-center gap-4 px-4 shrink-0 cursor-pointer hover:bg-white/[0.03] transition-colors"
            onClick={() => gatedClick("gap")}
          >
            {info.paceInfo.compAvg && (
              <div className="flex flex-col justify-center">
                <ZoneLabel>vs Field</ZoneLabel>
                <div className="flex gap-4 items-end">
                  <div>
                    <div className="text-[10px] mb-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>Fld Avg</div>
                    <div className="text-base font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.55)" }}>
                      {info.paceInfo.compAvg}
                    </div>
                  </div>
                  <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                    {info.paceInfo.compLabel} · {info.paceInfo.compN} cars
                  </div>
                </div>
              </div>
            )}
            {info.paceInfo.delta !== null && info.paceInfo.delta !== undefined && (
              <div className="flex flex-col justify-center">
                <ZoneLabel>Delta</ZoneLabel>
                <div className="text-xl font-extrabold tabular-nums leading-none mb-0.5" style={{
                  color: info.paceInfo.deltaColor,
                }}>
                  {info.paceInfo.delta > 0 ? "+" : ""}{info.paceInfo.delta.toFixed(2)}s
                </div>
                <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                  vs {info.paceInfo.compN} cars
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <Divider />

      {/* Zone 5 — Reason / position change events */}
      <div
        className={`flex-1 min-w-0 flex flex-col justify-center px-4 overflow-hidden${info.reason ? " cursor-pointer hover:bg-white/[0.03] transition-colors" : ""}`}
        onClick={info.reason ? () => gatedClick("event") : undefined}
      >
        {isPit && info.reason ? (
          <>
            <ZoneLabel>Event</ZoneLabel>
            <EventPreview
              reason={info.reason}
              posDelta={info.posDelta}
              posDeltaColor={posDeltaColor}
              alsoPittingCars={info.pitInfo?.alsoPittingCars}
              data={data}
              compSet={compSet}
              focusNum={focusNum}
              activeLap={info.lap.l}
            />
          </>
        ) : isPit ? (
          <div className="text-xs italic" style={{ color: "rgba(255,255,255,0.25)" }}>
            Pit lap
          </div>
        ) : info.reason ? (
          <>
            <ZoneLabel>Event</ZoneLabel>
            <EventPreview reason={info.reason} posDelta={info.posDelta} posDeltaColor={posDeltaColor} />
          </>
        ) : (
          <div className="text-xs italic" style={{ color: "rgba(255,255,255,0.18)" }}>
            No position changes this lap
          </div>
        )}
      </div>

      <Divider />

      {/* Zone 6 — Car metadata / gap drill-down */}
      <div
        className="hidden sm:flex flex-col justify-center px-4 shrink-0 text-right cursor-pointer hover:bg-white/[0.03] transition-colors"
        style={{ width: 180 }}
        onClick={() => gatedClick("gap")}
      >
        <ZoneLabel>Car Info</ZoneLabel>
        <div className="text-[13px] font-semibold text-white">#{focusNum}</div>
        <div className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.4)" }}>
          {info.carTeam} · {info.carClass}
        </div>
        <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
          Finish P{info.finishPos}
        </div>
      </div>

      {/* Zone 7 — Head-to-Head button */}
      <Divider className="hidden sm:block" />
      <div className="hidden sm:flex items-center justify-center shrink-0" style={{ width: 100 }}>
        <button
          onClick={() => gatedClick("h2h")}
          className="px-3 py-1.5 rounded-md text-[11px] font-semibold cursor-pointer transition-colors hover:bg-white/[0.08]"
          style={{
            background: "rgba(99,102,241,0.1)",
            border: "1px solid rgba(99,102,241,0.3)",
            color: "#a5b4fc",
          }}
        >
          H2H
        </button>
      </div>

      {/* Mobile nav next */}
      <button onClick={navNext} className="sm:hidden flex items-center justify-center w-9 shrink-0 border-l border-white/[0.07] cursor-pointer active:bg-white/5" style={{ color: "rgba(255,255,255,0.4)" }}>
        ▶
      </button>

      {/* Team-gated toast */}
      {toast && (
        <div
          className="absolute left-1/2 -translate-x-1/2 -top-12 px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap animate-fade-in pointer-events-none"
          style={{ background: "rgba(15,17,26,0.95)", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0", zIndex: 50 }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ---- Helpers ----

function Divider({ className = "" }: { className?: string }) {
  return (
    <div
      className={`shrink-0 self-stretch ${className}`}
      style={{ width: 1, background: "rgba(255,255,255,0.07)", margin: "10px 0" }}
    />
  );
}

function ZoneLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.09em] mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>
      {children}
    </div>
  );
}

function PitField({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[10px] mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</div>
      <div className="text-sm sm:text-[17px] font-bold tabular-nums" style={{ color: warn ? "#fca5a5" : "rgba(255,255,255,0.9)" }}>
        {value}
      </div>
    </div>
  );
}

const CLASS_ORDER = ["GTU", "GTO", "GP1", "GP2", "GP3"];

interface EventPreviewProps {
  reason: string;
  posDelta: number;
  posDeltaColor: string;
  alsoPittingCars?: number[];
  data?: RaceChartData;
  compSet?: Set<number>;
  focusNum?: number;
  activeLap?: number;
}

function EventPreview({ reason, posDelta, posDeltaColor, alsoPittingCars, data, compSet, focusNum, activeLap }: EventPreviewProps) {
  const isPitStop = reason.startsWith("Pit stop");

  if (isPitStop && alsoPittingCars && alsoPittingCars.length > 0 && data) {
    // Build per-car info grouped by class
    const carInfos: { num: number; cls: string; delta: number }[] = [];
    for (const num of alsoPittingCars) {
      const car = data.cars[String(num)];
      if (!car) continue;
      let delta = 0;
      if (activeLap) {
        const lapD = car.laps.find(l => l.l === activeLap);
        const prevD = car.laps.find(l => l.l === activeLap - 1);
        if (lapD && prevD) delta = prevD.p - lapD.p;
      }
      carInfos.push({ num, cls: car.cls, delta });
    }

    const byClass = CLASS_ORDER
      .map(cls => [cls, carInfos.filter(c => c.cls === cls)] as const)
      .filter(([, cars]) => cars.length > 0);

    // Extract pit cycle delta from reason string
    const cycleMatch = reason.match(/(Gained|Lost)\s+\d+\s+in pit cycle/i);

    return (
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold rounded px-1.5 py-0.5 shrink-0" style={{
            background: "rgba(251,191,36,0.12)",
            border: "1px solid rgba(251,191,36,0.3)",
            color: "#fcd34d",
          }}>
            PIT
          </span>
          {cycleMatch && (
            <span className="text-[10px] font-semibold shrink-0" style={{ color: posDeltaColor }}>
              {cycleMatch[0].replace(/ in pit cycle$/i, "")}
            </span>
          )}
          <span className="text-[8px] tracking-[0.06em] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>
            {carInfos.length} also pitted
          </span>
        </div>
        <div className="flex flex-col gap-px overflow-hidden">
          {byClass.map(([cls, cars]) => (
            <div key={cls} className="flex items-center gap-1 min-w-0">
              <span className="shrink-0 text-[8px] font-bold tracking-[0.06em] rounded px-1 py-px text-center" style={{
                background: "#1e2535",
                border: "1px solid #2d3748",
                color: "#9ca3af",
                minWidth: 28,
              }}>{cls}</span>
              <div className="flex flex-wrap gap-0.5 min-w-0">
                {cars.map(car => {
                  const color = compSet && focusNum != null
                    ? (compSet.has(car.num) ? getCompColor(compSet, focusNum, car.num) : "#6b7280")
                    : "#6b7280";
                  return (
                    <span key={car.num} className="inline-flex items-center gap-px rounded text-[9px] font-bold px-1 py-px" style={{
                      background: `${color}18`,
                      border: `1px solid ${color}55`,
                      color,
                      fontFamily: "monospace",
                      lineHeight: 1.3,
                      whiteSpace: "nowrap",
                    }}>
                      {car.delta < 0 && <span style={{ color: "#34d399", fontSize: 6, lineHeight: 1 }}>▲</span>}
                      {car.delta > 0 && <span style={{ color: "#f87171", fontSize: 6, lineHeight: 1 }}>▼</span>}
                      #{car.num}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isPitStop) {
    // Fallback: no structured alsoPittingCars
    const body = reason.replace(/^Pit stop\s*—?\s*/, "");
    const parts = body.split(/;\s*/).filter(Boolean);
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const p of parts) {
      const t = p.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      deduped.push(t);
    }

    const cycleMatch = deduped.find((p) => /^(Gained|Lost)\s+\d+\s+in pit cycle$/i.test(p));
    const infoParts = deduped.filter((p) => p !== cycleMatch);

    return (
      <div className="flex items-center gap-2 truncate">
        <span className="text-[10px] font-bold rounded px-1.5 py-0.5 shrink-0" style={{
          background: "rgba(251,191,36,0.12)",
          border: "1px solid rgba(251,191,36,0.3)",
          color: "#fcd34d",
        }}>
          PIT
        </span>
        {cycleMatch && (
          <span className="text-xs font-semibold shrink-0" style={{ color: posDeltaColor }}>
            {cycleMatch.replace(/ in pit cycle$/i, "")}
          </span>
        )}
        {infoParts.length > 0 && (
          <span className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.4)" }}>
            {infoParts.join(" · ")}
          </span>
        )}
      </div>
    );
  }

  // Racing lap — parse per-car segments
  const body = reason.replace(/^(Gained|Lost)\s*—?\s*(passed\s+)?/i, "");
  const isGain = posDelta > 0;
  const verb = isGain ? "Passed" : "Lost to";

  const segments = body.split(/;\s*/).filter(Boolean);
  const seen = new Set<string>();
  const items: string[] = [];
  for (const seg of segments) {
    const t = seg.trim().replace(/^passed\s+/i, "");
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const m = t.match(/^#(\d+)\b.*?\b(on pace|pitted|\(yellow\))$/i);
    if (m) items.push(`#${m[1]} ${m[2]}`);
  }

  if (items.length === 0) {
    if (posDelta === 0) return null;
    return (
      <div className="flex items-center gap-2 truncate">
        <span className="text-xs font-semibold shrink-0" style={{ color: posDeltaColor }}>
          Position changed
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 truncate">
      <span className="text-xs font-semibold shrink-0" style={{ color: posDeltaColor }}>
        {verb}
      </span>
      <span className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.5)" }}>
        {items.join(" · ")}
      </span>
    </div>
  );
}

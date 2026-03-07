import { formatLapTime, type LapInfoData } from "./chart-renderer";

interface DataPanelProps {
  info: LapInfoData | null;
  focusNum: number;
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

export function DataPanel({ info, focusNum, navPrev, navNext, setSidePanel }: DataPanelProps) {
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
      className="flex items-stretch overflow-hidden"
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
          onClick={() => setSidePanel("pit")}
        >
          <ZoneLabel>{info.pitInfo?.pitLabel || "Pit Stop"}</ZoneLabel>
          <div className="flex gap-3 sm:gap-5">
            <PitField label="In-Lap" value={secToDisplay(timing.inLapTime)} />
            {timing.pitRoadTime !== null && <PitField label="Pit Road" value={secToDisplay(timing.pitRoadTime)} />}
            <PitField label="Out-Lap" value={secToDisplay(timing.outLapTime)} />
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
            onClick={() => setSidePanel("gap")}
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
        onClick={info.reason ? () => setSidePanel("event") : undefined}
      >
        {isPit && info.reason ? (
          <>
            <ZoneLabel>Event</ZoneLabel>
            <EventPreview reason={info.reason} posDelta={info.posDelta} posDeltaColor={posDeltaColor} />
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
        onClick={() => setSidePanel("gap")}
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
          onClick={() => setSidePanel("h2h")}
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

function EventPreview({ reason, posDelta, posDeltaColor }: { reason: string; posDelta: number; posDeltaColor: string }) {
  const isPitStop = reason.startsWith("Pit stop");

  if (isPitStop) {
    // Extract pit cycle delta and info parts
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
  // Format: "Gained — passed #6 Team on pace; #31 Team pitted"
  //    or:  "Lost — #6 Team on pace; #31 Team pitted"
  //    or:  "Gained 3 positions" (no car detail)
  const body = reason.replace(/^(Gained|Lost)\s*—?\s*(passed\s+)?/i, "");
  const isGain = posDelta > 0;
  const verb = isGain ? "Passed" : "Lost to";

  // Parse each segment: "#NUM TeamName qualifier" → "#NUM qualifier"
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

interface PassEventPanelProps {
  reason: string;
  posDelta: number;
  focusNum: number;
  isPit?: boolean;
  onOpenH2H: (carNum: number) => void;
  onAddToCompare: (carNum: number) => void;
}

interface CarEvent {
  kind: "car";
  carNum: number;
  teamName: string;
  reason: "on pace" | "pitted" | "yellow" | "unknown";
  direction: "gained" | "lost" | "neutral";
}

interface PitCycleEvent {
  kind: "pitCycle";
  delta: number; // positive = gained, negative = lost
}

interface PitInfoEvent {
  kind: "pitInfo";
  text: string; // e.g. "also pitting: #33, #52"
}

type ParsedEvent = CarEvent | PitCycleEvent | PitInfoEvent;

const REASON_STYLES: Record<string, { bg: string; border: string; color: string; label: string }> = {
  "on pace": { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.3)", color: "#93c5fd", label: "on pace" },
  pitted: { bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)", color: "#fcd34d", label: "pitted" },
  yellow: { bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)", color: "#fcd34d", label: "on yellow" },
  pitCycle: { bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)", color: "#fcd34d", label: "pit cycle" },
  unknown: { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)", label: "—" },
};

function parseReason(reason: string, posDelta: number): ParsedEvent[] {
  const direction: CarEvent["direction"] = posDelta > 0 ? "gained" : posDelta < 0 ? "lost" : "neutral";

  // Split the full string on "; " first, then deduplicate
  const rawParts = reason.split(/;\s*/);
  const seen = new Set<string>();
  const dedupParts: string[] = [];
  for (const p of rawParts) {
    const t = p.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    dedupParts.push(t);
  }

  // Rejoin and parse as a single deduped string
  const deduped = dedupParts.join("; ");

  // Check if this is a pit stop reason
  const isPitStop = deduped.startsWith("Pit stop");

  const events: ParsedEvent[] = [];

  if (isPitStop) {
    // Strip "Pit stop — " or "Pit stop" prefix
    const body = deduped.replace(/^Pit stop\s*—?\s*/, "");
    if (!body) return events;

    // Parse individual parts
    for (const part of body.split(/;\s*/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // "Gained N in pit cycle" or "Lost N in pit cycle"
      const cycleMatch = trimmed.match(/^(Gained|Lost)\s+(\d+)\s+in pit cycle$/i);
      if (cycleMatch) {
        const n = parseInt(cycleMatch[2], 10);
        events.push({ kind: "pitCycle", delta: cycleMatch[1].toLowerCase() === "gained" ? n : -n });
        continue;
      }

      // "also pitting: #33, #52" or "N class cars also pitting"
      if (trimmed.startsWith("also pitting") || trimmed.includes("cars also pitting")) {
        events.push({ kind: "pitInfo", text: trimmed });
        continue;
      }

      // Fallback: treat as info text
      events.push({ kind: "pitInfo", text: trimmed });
    }
  } else {
    // Racing lap — strip prefix
    let body = deduped;
    const gainMatch = deduped.match(/^Gained\s*—\s*passed\s*/i);
    const lossMatch = deduped.match(/^Lost\s*—\s*/i);
    if (gainMatch) body = deduped.slice(gainMatch[0].length);
    else if (lossMatch) body = deduped.slice(lossMatch[0].length);

    for (const part of body.split(/;\s*/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Parse: "#NUM TeamName reason"
      const m = trimmed.match(/^#(\d+)\s*(.*?)?\s+(on pace|pitted|\(yellow\))$/i);
      if (m) {
        const carNum = parseInt(m[1], 10);
        const teamName = (m[2] || "").trim();
        let reasonType: CarEvent["reason"] = "unknown";
        const r = m[3].toLowerCase();
        if (r === "on pace") reasonType = "on pace";
        else if (r === "pitted") reasonType = "pitted";
        else if (r === "(yellow)") reasonType = "yellow";
        events.push({ kind: "car", carNum, teamName, reason: reasonType, direction });
      } else {
        const numMatch = trimmed.match(/^#(\d+)/);
        if (numMatch) {
          events.push({ kind: "car", carNum: parseInt(numMatch[1], 10), teamName: trimmed.replace(/^#\d+\s*/, ""), reason: "unknown", direction });
        }
      }
    }
  }

  return events;
}

export function PassEventPanel({ reason, posDelta, focusNum, isPit, onOpenH2H, onAddToCompare }: PassEventPanelProps) {
  const isGain = posDelta > 0;
  const allEvents = parseReason(reason, posDelta);
  const carEvents = allEvents.filter((e): e is CarEvent => e.kind === "car" && e.carNum !== focusNum);
  const pitCycleEvents = allEvents.filter((e): e is PitCycleEvent => e.kind === "pitCycle");
  const pitInfoEvents = allEvents.filter((e): e is PitInfoEvent => e.kind === "pitInfo");
  const dirColor = isGain ? "#4ade80" : posDelta < 0 ? "#f87171" : "rgba(255,255,255,0.5)";

  // Pure pit lap with no meaningful events — show clean indicator
  const isPitOnly = isPit && carEvents.length === 0 && pitCycleEvents.length === 0 && pitInfoEvents.length === 0;

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold" style={{ color: dirColor }}>
            {isGain ? `▲ Gained ${posDelta}` : posDelta < 0 ? `▼ Lost ${Math.abs(posDelta)}` : "No change"}
          </span>
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            position{Math.abs(posDelta) !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* On-track car events */}
        {carEvents.map((ev) => {
          const style = REASON_STYLES[ev.reason];
          return (
            <div
              key={`${ev.carNum}-${ev.reason}`}
              className="flex items-center gap-2 px-4 py-2.5 border-b"
              style={{ borderColor: "rgba(255,255,255,0.05)" }}
            >
              <span className="text-xs font-bold shrink-0 w-16" style={{ color: dirColor }}>
                {ev.direction === "gained" ? "▲ Gained" : ev.direction === "lost" ? "▼ Lost" : "—"}
              </span>
              <span
                className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0"
                style={{ background: "rgba(255,255,255,0.08)", color: "#fff" }}
              >
                #{ev.carNum}
              </span>
              <span className="text-xs truncate min-w-0" style={{ color: "rgba(255,255,255,0.6)" }}>
                {ev.teamName || `Car #${ev.carNum}`}
              </span>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ml-auto"
                style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}
              >
                {style.label}
              </span>
            </div>
          );
        })}

        {/* Pit cycle summary — single structured row combining cycle delta + info */}
        {(pitCycleEvents.length > 0 || pitInfoEvents.length > 0) && (() => {
          const style = REASON_STYLES.pitCycle;
          const cycleDelta = pitCycleEvents.length > 0 ? pitCycleEvents[0].delta : 0;
          const isLoss = cycleDelta < 0;
          const cycleColor = isLoss ? "#f87171" : cycleDelta > 0 ? "#4ade80" : "rgba(255,255,255,0.5)";

          // Build description parts: "Lost N" + "X class cars also pitted"
          const descParts: string[] = [];
          if (cycleDelta !== 0) {
            descParts.push(`${isLoss ? "Lost" : "Gained"} ${Math.abs(cycleDelta)}`);
          }
          for (const ev of pitInfoEvents) {
            descParts.push(ev.text.replace(/also pitting$/, "also pitted"));
          }

          return (
            <div
              className="flex items-center gap-2 px-4 py-2.5 border-b"
              style={{ borderColor: "rgba(255,255,255,0.05)" }}
            >
              <span className="text-xs font-bold shrink-0 w-16" style={{ color: cycleColor }}>
                {isLoss ? "▼ Lost" : cycleDelta > 0 ? "▲ Gained" : "—"}
              </span>
              <span
                className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0"
                style={{ background: "rgba(251,191,36,0.12)", color: "#fcd34d" }}
              >
                Pit cycle
              </span>
              <span className="text-xs truncate min-w-0" style={{ color: "rgba(255,255,255,0.6)" }}>
                {descParts.join(" · ")}
              </span>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ml-auto"
                style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}
              >
                {style.label}
              </span>
            </div>
          );
        })()}

        {/* Pit-only fallback */}
        {isPitOnly && (
          <div className="px-4 py-6">
            <div className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
              Pit lap — see pit details above
            </div>
          </div>
        )}

        {/* No events fallback (non-pit) */}
        {!isPitOnly && carEvents.length === 0 && pitCycleEvents.length === 0 && pitInfoEvents.length === 0 && (
          <div className="px-4 py-3">
            <div
              className="text-sm rounded px-3 py-2"
              style={{
                background: "rgba(255,255,255,0.04)",
                borderLeft: `3px solid ${dirColor}`,
                color: "rgba(255,255,255,0.7)",
              }}
            >
              {reason}
            </div>
          </div>
        )}

        {/* Action buttons for car events */}
        {carEvents.length > 0 && (
          <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="flex flex-col gap-1.5">
              {carEvents.map((ev) => (
                <div key={`actions-${ev.carNum}`} className="flex items-center gap-2">
                  <span className="font-mono font-bold text-[11px] text-white">#{ev.carNum}</span>
                  <div className="flex gap-1.5 ml-auto">
                    <button
                      onClick={() => onOpenH2H(ev.carNum)}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-colors hover:bg-indigo-500/20"
                      style={{
                        background: "rgba(99,102,241,0.1)",
                        border: "1px solid rgba(99,102,241,0.3)",
                        color: "#a5b4fc",
                      }}
                    >
                      H2H vs #{ev.carNum}
                    </button>
                    <button
                      onClick={() => onAddToCompare(ev.carNum)}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-colors hover:bg-white/[0.08]"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        color: "rgba(255,255,255,0.5)",
                      }}
                    >
                      + Compare
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer note */}
      <div className="px-4 py-3 mt-auto">
        <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
          Focus car #{focusNum} is highlighted on the chart above.
        </div>
      </div>
    </div>
  );
}

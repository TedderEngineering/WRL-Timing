interface PassEventPanelProps {
  reason: string;
  posDelta: number;
  focusNum: number;
  onOpenH2H: (carNum: number) => void;
  onAddToCompare: (carNum: number) => void;
}

interface ParsedEvent {
  carNum: number;
  teamName: string;
  reason: "on pace" | "pitted" | "yellow" | "unknown";
  direction: "gained" | "lost" | "neutral";
}

const REASON_STYLES: Record<string, { bg: string; border: string; color: string; label: string }> = {
  "on pace": { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.3)", color: "#93c5fd", label: "on pace" },
  pitted: { bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)", color: "#fcd34d", label: "pitted" },
  yellow: { bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)", color: "#fcd34d", label: "on yellow" },
  unknown: { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)", label: "—" },
};

function parseEvents(reason: string, posDelta: number): ParsedEvent[] {
  const direction: ParsedEvent["direction"] = posDelta > 0 ? "gained" : posDelta < 0 ? "lost" : "neutral";

  // Strip leading "Gained — passed " or "Lost — " prefix
  let body = reason;
  const gainMatch = reason.match(/^Gained\s*—\s*passed\s*/i);
  const lossMatch = reason.match(/^Lost\s*—\s*/i);
  if (gainMatch) body = reason.slice(gainMatch[0].length);
  else if (lossMatch) body = reason.slice(lossMatch[0].length);

  // Split on "; "
  const parts = body.split(/;\s*/);
  const seen = new Set<string>();
  const events: ParsedEvent[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Deduplicate
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);

    // Parse: "#NUM TeamName reason"
    const m = trimmed.match(/^#(\d+)\s*(.*?)?\s+(on pace|pitted|\(yellow\))$/i);
    if (m) {
      const carNum = parseInt(m[1], 10);
      const teamName = (m[2] || "").trim();
      let reasonType: ParsedEvent["reason"] = "unknown";
      const r = m[3].toLowerCase();
      if (r === "on pace") reasonType = "on pace";
      else if (r === "pitted") reasonType = "pitted";
      else if (r === "(yellow)") reasonType = "yellow";
      events.push({ carNum, teamName, reason: reasonType, direction });
    } else {
      // Try to at least extract a car number
      const numMatch = trimmed.match(/^#(\d+)/);
      if (numMatch) {
        events.push({ carNum: parseInt(numMatch[1], 10), teamName: trimmed.replace(/^#\d+\s*/, ""), reason: "unknown", direction });
      }
      // Skip lines without car numbers (e.g. "Gained 3 positions")
    }
  }

  return events;
}

export function PassEventPanel({ reason, posDelta, focusNum, onOpenH2H, onAddToCompare }: PassEventPanelProps) {
  const isGain = posDelta > 0;
  const events = parseEvents(reason, posDelta).filter((e) => e.carNum !== focusNum);
  const dirColor = isGain ? "#4ade80" : posDelta < 0 ? "#f87171" : "rgba(255,255,255,0.5)";

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

      {/* Structured event rows */}
      {events.length > 0 ? (
        <div className="flex-1 overflow-y-auto">
          {events.map((ev) => {
            const style = REASON_STYLES[ev.reason];
            return (
              <div
                key={`${ev.carNum}-${ev.reason}`}
                className="flex items-center gap-2 px-4 py-2.5 border-b"
                style={{ borderColor: "rgba(255,255,255,0.05)" }}
              >
                {/* Direction */}
                <span className="text-xs font-bold shrink-0 w-16" style={{ color: dirColor }}>
                  {ev.direction === "gained" ? "▲ Gained" : ev.direction === "lost" ? "▼ Lost" : "—"}
                </span>

                {/* Car badge */}
                <span
                  className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: "rgba(255,255,255,0.08)", color: "#fff" }}
                >
                  #{ev.carNum}
                </span>

                {/* Team name */}
                <span className="text-xs truncate min-w-0" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {ev.teamName || `Car #${ev.carNum}`}
                </span>

                {/* Reason pill */}
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ml-auto"
                  style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}
                >
                  {style.label}
                </span>
              </div>
            );
          })}

          {/* Action buttons per car */}
          <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="flex flex-col gap-1.5">
              {events.map((ev) => (
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
        </div>
      ) : (
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

      {/* Footer note */}
      <div className="px-4 py-3 mt-auto">
        <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
          Focus car #{focusNum} is highlighted on the chart above.
        </div>
      </div>
    </div>
  );
}

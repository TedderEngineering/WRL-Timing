interface PassEventPanelProps {
  reason: string;
  posDelta: number;
  focusNum: number;
  onOpenH2H: (carNum: number) => void;
  onAddToCompare: (carNum: number) => void;
}

function extractCarNumbers(reason: string): number[] {
  const matches = reason.matchAll(/#(\d+)/g);
  const nums = new Set<number>();
  for (const m of matches) {
    nums.add(parseInt(m[1], 10));
  }
  return [...nums];
}

export function PassEventPanel({ reason, posDelta, focusNum, onOpenH2H, onAddToCompare }: PassEventPanelProps) {
  const isGain = posDelta > 0;
  const carNums = extractCarNumbers(reason).filter((n) => n !== focusNum);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Event type badge */}
      <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-lg font-bold"
            style={{ color: isGain ? "#4ade80" : posDelta < 0 ? "#f87171" : "rgba(255,255,255,0.5)" }}
          >
            {isGain ? `▲ Gained ${posDelta}` : posDelta < 0 ? `▼ Lost ${Math.abs(posDelta)}` : "No change"}
          </span>
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            position{Math.abs(posDelta) !== 1 ? "s" : ""}
          </span>
        </div>
        <div
          className="text-sm rounded px-3 py-2"
          style={{
            background: "rgba(255,255,255,0.04)",
            borderLeft: `3px solid ${isGain ? "#4ade80" : posDelta < 0 ? "#f87171" : "rgba(255,255,255,0.2)"}`,
            color: "rgba(255,255,255,0.7)",
          }}
        >
          {reason}
        </div>
      </div>

      {/* Cars involved */}
      {carNums.length > 0 && (
        <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>
            Cars Involved
          </div>
          <div className="flex flex-col gap-1.5">
            {carNums.map((num) => (
              <div key={num} className="flex items-center gap-2">
                <span className="font-mono font-bold text-xs text-white">#{num}</span>
                <div className="flex gap-1.5 ml-auto">
                  <button
                    onClick={() => onOpenH2H(num)}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-colors hover:bg-indigo-500/20"
                    style={{
                      background: "rgba(99,102,241,0.1)",
                      border: "1px solid rgba(99,102,241,0.3)",
                      color: "#a5b4fc",
                    }}
                  >
                    H2H vs #{num}
                  </button>
                  <button
                    onClick={() => onAddToCompare(num)}
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

      {/* Highlighted on chart note */}
      <div className="px-4 py-3">
        <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
          Focus car #{focusNum} is highlighted on the chart above.
        </div>
      </div>
    </div>
  );
}

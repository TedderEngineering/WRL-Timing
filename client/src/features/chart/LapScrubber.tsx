/**
 * The race in one strip (mockup F1): FCY periods shaded, the selected lap
 * marked. Click or drag to pick a lap; arrow keys step.
 */
import { useCallback, useRef } from "react";
import { TRACE } from "./constants";

export function LapScrubber({
  maxLap,
  fcy,
  activeLap,
  flagLabel,
  onLap,
  navPrev,
  navNext,
  large = false,
}: {
  maxLap: number;
  fcy: Array<[number, number]>;
  activeLap: number | null;
  flagLabel: string | null;
  onLap: (lap: number) => void;
  navPrev: () => void;
  navNext: () => void;
  /** Phone lap sheet: 44 px buttons and a taller strip (mobile redesign, PR 4). */
  large?: boolean;
}) {
  const btn = large ? "h-11 w-11 shrink-0 rounded-lg border" : "h-9 w-9 shrink-0 rounded-md border";
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pct = (lap: number) => (maxLap > 1 ? ((lap - 1) / (maxLap - 1)) * 100 : 0);

  const pick = useCallback(
    (clientX: number) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r || r.width <= 0) return;
      const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      onLap(Math.round(1 + f * (maxLap - 1)));
    },
    [maxLap, onLap]
  );

  return (
    <div className="flex items-center gap-3">
      <button type="button" aria-label="Previous lap" onClick={navPrev} className={btn} style={{ background: "#12122a", borderColor: "#3a3a5c", color: "#e0e0e8" }}>
        ◀
      </button>
      <div
        ref={ref}
        role="slider"
        aria-label="Lap"
        aria-valuemin={1}
        aria-valuemax={maxLap}
        aria-valuenow={activeLap ?? undefined}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            // The page-level arrow-key handler steps the lap; stop the slider scrolling the page.
            e.preventDefault();
          }
        }}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          pick(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && pick(e.clientX)}
        onPointerUp={() => {
          dragging.current = false;
        }}
        className={`relative ${large ? "h-9" : "h-6"} flex-1 cursor-pointer touch-none rounded border outline-none focus-visible:ring-2 focus-visible:ring-[#F48C34]`}
        style={{ background: "#12122a", borderColor: "#1e1e38" }}
      >
        {fcy.map(([s, e]) => (
          <div
            key={`${s}-${e}`}
            className="absolute bottom-0 top-0"
            style={{ left: `${pct(s)}%`, width: `${Math.max(0.6, pct(e) - pct(s))}%`, background: "rgba(251,191,36,0.25)" }}
          />
        ))}
        {activeLap !== null && (
          <div className="absolute -bottom-1 -top-1 w-[3px] rounded-sm" style={{ left: `calc(${pct(activeLap)}% - 1px)`, background: TRACE.focus }} />
        )}
      </div>
      <button type="button" aria-label="Next lap" onClick={navNext} className={btn} style={{ background: "#12122a", borderColor: "#3a3a5c", color: "#e0e0e8" }}>
        ▶
      </button>
      <span className="hidden min-w-[96px] font-mono text-xs sm:inline" style={{ color: "#9a9ab4" }}>
        {activeLap !== null ? `Lap ${activeLap}${flagLabel ? ` · ${flagLabel}` : ""}` : `${maxLap} laps`}
      </span>
    </div>
  );
}

/**
 * The phone's lap sheet (mobile redesign, PR 4): the lap details and the side panels rise over
 * the chart from the bottom, instead of sitting below it out of sight. Three heights:
 *
 *  - peek: one line, under the thumb: ‹ the selected lap ›. The chart itself is the lap picker
 *    (tap, drag, pinch), so the peek keeps only a one-lap step either side for exact moves
 *  - half: half the screen, with the lap's details and event cards (tapping a lap opens this)
 *  - full: nearly the whole screen, for a pit cycle, gap, head-to-head or pass panel
 *
 * Drag the top of the sheet, or tap the lap line, to change height (as Apple Maps' sheet: the grab
 * bar only shows where to hold); the chart stays live above. It is not a modal: the page around it
 * keeps working, so a lap can be tapped with the sheet open.
 *
 * Look: the laptop side panel's colours (#0e0e20 panel, #1e1e38 border).
 */
import { useRef, useState, type ReactNode } from "react";

export type SheetLevel = "peek" | "half" | "full";

/** The peek's height without the home-bar inset: grab bar and the 44 px lap line. */
export const PEEK_PX = 60;

/**
 * A phone held sideways (mobile redesign, step 7, decision M7): the lap details open as a rail on
 * the right, beside the chart, instead of a sheet over it. Closed, the one-line peek stays at
 * the bottom as upright.
 */
export const RAIL_WIDTH = "min(44vw, 400px)";
/** The race page's top row, above the rail. */
const RAIL_TOP = "calc(48px + env(safe-area-inset-top))";

const ORDER: SheetLevel[] = ["peek", "half", "full"];

const STEP = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#cbd5e1] active:bg-white/10";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

function heightOf(level: SheetLevel): string {
  if (level === "peek") return `calc(${PEEK_PX}px + env(safe-area-inset-bottom))`;
  if (level === "half") return "52dvh";
  return "88dvh";
}

export function LapSheet({
  level,
  setLevel,
  label,
  summary,
  onPrev,
  onNext,
  rail = false,
  children,
}: {
  level: SheetLevel;
  setLevel: (l: SheetLevel) => void;
  /** What the sheet holds, for screen readers ("Lap details", "Pit cycle"). */
  label: string;
  /** The always-visible lap line. */
  summary: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  /** Sideways: open as a rail on the right (RAIL_WIDTH) rather than a sheet from the bottom. */
  rail?: boolean;
  children: ReactNode;
}) {
  // While dragging, the sheet follows the finger; on release it settles at the nearest height.
  const [dragPx, setDragPx] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const panel = useRef<HTMLElement>(null);

  const settle = (px: number) => {
    const vh = window.innerHeight;
    const targets: [SheetLevel, number][] = [
      ["peek", PEEK_PX],
      ["half", vh * 0.52],
      ["full", vh * 0.88],
    ];
    const nearest = targets.reduce((a, b) =>
      Math.abs(b[1] - px) < Math.abs(a[1] - px) ? b : a
    );
    setLevel(nearest[0]);
  };
  const step = (dir: 1 | -1) => {
    const i = ORDER.indexOf(level) + dir;
    if (i >= 0 && i < ORDER.length) setLevel(ORDER[i]);
  };

  const railOpen = rail && level !== "peek";
  return (
    <section
      ref={panel}
      aria-label={label}
      data-lap-sheet
      data-level={level}
      data-rail={railOpen ? "" : undefined}
      className={
        railOpen
          ? "fixed bottom-0 right-0 z-30 flex flex-col rounded-tl-2xl border-l border-t shadow-[-8px_0_24px_rgba(0,0,0,0.35)]"
          : "fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
      }
      style={{
        ...(railOpen
          ? { top: RAIL_TOP, width: RAIL_WIDTH }
          : { height: dragPx !== null ? `${dragPx}px` : heightOf(level), transition: dragPx !== null ? "none" : "height 200ms ease-out" }),
        background: "#0e0e20",
        borderColor: "#1e1e38",
        color: "#e0e0e8",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* The top of the sheet: drag anywhere on it to resize; tap the lap line to step up (or down from full) */}
      <div
        data-phone-shell="lap-sheet"
        className="shrink-0 touch-none select-none"
        onPointerDown={(e) => {
          if (rail) return;
          start.current = {
            y: e.clientY,
            h: panel.current?.getBoundingClientRect().height ?? PEEK_PX,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dy = s.y - e.clientY;
          if (!s.moved && Math.abs(dy) > 6) {
            s.moved = true;
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          }
          if (s.moved) setDragPx(Math.max(PEEK_PX, Math.min(window.innerHeight * 0.92, s.h + dy)));
        }}
        onPointerUp={() => {
          if (start.current?.moved && dragPx !== null) settle(dragPx);
          setDragPx(null);
          // Let the click that follows a drag see `moved`, then forget it.
          setTimeout(() => (start.current = null), 0);
        }}
        onPointerCancel={() => {
          setDragPx(null);
          start.current = null;
        }}
        onClickCapture={(e) => {
          // A drag that ends over a button is not a press of it.
          if (start.current?.moved) e.stopPropagation();
        }}
      >
        <div aria-hidden className="mx-auto mt-1.5 h-1 w-10 rounded-full" style={{ background: "#3a3a5c" }} />
        <div className="flex h-11 items-center px-1 pb-0.5">
          <button type="button" aria-label="Previous lap" onClick={onPrev} className={STEP}>
            <Chevron dir="left" />
          </button>
          <button
            type="button"
            aria-label={`${(rail ? railOpen : level === "full") ? "Show less" : "Show more"} of the lap details`}
            aria-expanded={level !== "peek"}
            onClick={() => (rail ? setLevel(railOpen ? "peek" : "half") : step(level === "full" ? -1 : 1))}
            className="flex h-11 min-w-0 flex-1 items-center px-1 text-left"
          >
            <span className="min-w-0 flex-1" aria-live="polite">
              {summary}
            </span>
          </button>
          <button type="button" aria-label="Next lap" onClick={onNext} className={STEP}>
            <Chevron dir="right" />
          </button>
        </div>
      </div>
      <div
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto border-t"
        style={{ borderColor: "#1e1e38", overscrollBehavior: "contain" }}
      >
        {children}
      </div>
    </section>
  );
}

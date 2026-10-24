/**
 * The phone's lap sheet (mobile redesign, PR 4): the lap details and the side panels rise over
 * the chart from the bottom, instead of sitting below it out of sight. Three heights:
 *
 *  - peek: the selected lap in one line, and the lap stepper and strip, always under the thumb
 *  - half: half the screen, with the lap's details and event cards (tapping a lap opens this)
 *  - full: nearly the whole screen, for a pit cycle, gap, head-to-head or pass panel
 *
 * Drag the handle, or tap it, to change height; the chart stays live above the sheet. It is not
 * a modal: the page around it keeps working, so a lap can be tapped with the sheet open.
 *
 * Look: the laptop side panel's colours (#0e0e20 panel, #1e1e38 border).
 */
import { useRef, useState, type ReactNode } from "react";

export type SheetLevel = "peek" | "half" | "full";

/** The peek's height without the home-bar inset: handle, summary line and lap stepper. */
export const PEEK_PX = 124;

const ORDER: SheetLevel[] = ["peek", "half", "full"];

function heightOf(level: SheetLevel): string {
  if (level === "peek") return `calc(${PEEK_PX}px + env(safe-area-inset-bottom))`;
  if (level === "half") return "52dvh";
  return "88dvh";
}

export function LapSheet({
  level,
  setLevel,
  label,
  peek,
  children,
}: {
  level: SheetLevel;
  setLevel: (l: SheetLevel) => void;
  /** What the sheet holds, for screen readers ("Lap details", "Pit cycle"). */
  label: string;
  /** The always-visible top: the lap summary and the stepper. */
  peek: ReactNode;
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

  return (
    <section
      ref={panel}
      aria-label={label}
      data-lap-sheet
      data-level={level}
      className="fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
      style={{
        height: dragPx !== null ? `${dragPx}px` : heightOf(level),
        transition: dragPx !== null ? "none" : "height 200ms ease-out",
        background: "#0e0e20",
        borderColor: "#1e1e38",
        color: "#e0e0e8",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div data-phone-shell="lap-sheet" className="shrink-0">
        {/* Handle: drag to resize, tap to step up (or down from full) */}
        <button
          type="button"
          aria-label={
            level === "full"
              ? "Show less of the lap details"
              : "Show more of the lap details"
          }
          aria-expanded={level !== "peek"}
          onClick={() => {
            if (start.current?.moved) return;
            step(level === "full" ? -1 : 1);
          }}
          onPointerDown={(e) => {
            start.current = {
              y: e.clientY,
              h: panel.current?.getBoundingClientRect().height ?? PEEK_PX,
              moved: false,
            };
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const s = start.current;
            if (!s) return;
            const dy = s.y - e.clientY;
            if (Math.abs(dy) > 6) s.moved = true;
            if (s.moved)
              setDragPx(Math.max(PEEK_PX, Math.min(window.innerHeight * 0.92, s.h + dy)));
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
          className="flex h-11 w-full shrink-0 touch-none items-center justify-center"
        >
          <span
            aria-hidden
            className="h-1 w-10 rounded-full"
            style={{ background: "#3a3a5c" }}
          />
        </button>
        <div className="shrink-0 px-3">{peek}</div>
      </div>
      <div
        className="no-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto border-t"
        style={{ borderColor: "#1e1e38", overscrollBehavior: "contain" }}
      >
        {children}
      </div>
    </section>
  );
}

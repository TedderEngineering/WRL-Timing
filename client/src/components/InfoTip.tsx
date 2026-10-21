/**
 * An ⓘ that explains a column: on hover or keyboard focus on a computer, on a tap on a phone. The
 * note is placed on the page (not inside the table), so a scrolling table never cuts it off.
 */
import { useEffect, useId, useRef, useState } from "react";

const W = 264;

export function InfoTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // A tap focuses the button (which opens the note) and then clicks it: that click must not close it.
  const openedAt = useRef(0);

  const show = () => {
    openedAt.current = Date.now();
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const half = W / 2 + 8;
    setAt({ x: Math.min(Math.max(r.left + r.width / 2, half), window.innerWidth - half), y: r.bottom + 6 });
  };
  const hide = () => setAt(null);

  useEffect(() => {
    if (!at) return;
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !btn.current?.contains(e.target as Node)) hide();
    };
    // Opening can scroll the button into view: only a later scroll closes the note.
    const gone = () => {
      if (Date.now() - openedAt.current > 400) hide();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", away);
    window.addEventListener("scroll", gone, true);
    window.addEventListener("resize", gone);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", away);
      window.removeEventListener("scroll", gone, true);
      window.removeEventListener("resize", gone);
    };
  }, [at]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`What "${label}" means`}
        aria-describedby={at ? id : undefined}
        // Hover with a mouse only: a tap also sends imitation mouse events that would close it.
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation(); // not a sort
          if (at && Date.now() - openedAt.current > 400) hide();
          else show();
        }}
        className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full align-[-2px] opacity-70 hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
          <path d="M8 7.2v4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {at && (
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-50 rounded-lg border px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal shadow-xl"
          style={{ left: at.x, top: at.y, width: W, transform: "translateX(-50%)", background: "#1a1a36", borderColor: "#3a3a5c", color: "#e0e0e8", whiteSpace: "normal" }}
        >
          {text}
        </span>
      )}
    </>
  );
}

/**
 * The phone race page's views as one row that scrolls sideways (mobile redesign): Trace · Story ·
 * Pits · Laps · Strategy · Drivers, every view one tap away with no More menu.
 *
 * What tells you the row scrolls:
 *  - the edge that has more views fades out (and the fade goes once you reach the end)
 *  - on a first visit, if the row is wider than the screen, it glides to the end and back once,
 *    as iOS and Android tab rows do; never again after that, and not at all with reduced motion
 *  - the open view is kept in sight, centred where it can be
 *
 * Looks as before: the laptop's tab colours, an orange underline on the open view, 44 px targets.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const C = { line: "#1e1e38", text: "#e0e0e8", muted: "#9a9ab4", accent: "#F48C34" };
const HINT_KEY = "rt.viewTabsHinted";
const FADE = 28;

const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function LockIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="Team plan">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}

function hinted(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true; // no storage: don't risk nudging on every visit
  }
}
function markHinted() {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* fine */
  }
}

export function PhoneViewTabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: T; label: string; locked: boolean }[];
  active: T;
  onSelect: (id: T) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const touched = useRef(false);

  const measure = useCallback(() => {
    const el = nav.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft < max - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  /** Where the row sits with the open view centred (clamped to the row's ends). */
  const activeLeft = useCallback(() => {
    const el = nav.current;
    const btn = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !btn) return 0;
    return Math.max(0, Math.min(el.scrollWidth - el.clientWidth, btn.offsetLeft - (el.clientWidth - btn.offsetWidth) / 2));
  }, []);

  // Keep the open view in sight.
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    el.scrollTo({ left: activeLeft(), behavior: reducedMotion() ? "auto" : "smooth" });
  }, [active, activeLeft]);

  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [measure, tabs.length]);

  // First visit: glide to the end of the row and back, once.
  useEffect(() => {
    const el = nav.current;
    if (!el || hinted()) return;
    if (el.scrollWidth - el.clientWidth < 8) return; // everything fits: nothing to show
    markHinted();
    if (reducedMotion()) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(
      setTimeout(() => {
        if (touched.current) return;
        el.scrollTo({ left: el.scrollWidth - el.clientWidth, behavior: "smooth" });
        timers.push(
          setTimeout(() => {
            if (!touched.current) el.scrollTo({ left: activeLeft(), behavior: "smooth" });
          }, 900)
        );
      }, 700)
    );
    return () => timers.forEach(clearTimeout);
    // Checked again when views arrive (Story joins once the race's stories load); runs once ever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  const mask = `linear-gradient(to right, ${edges.left ? "transparent" : "#000"} 0, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${edges.right ? "transparent" : "#000"} 100%)`;

  return (
    <nav
      ref={nav}
      aria-label="Race views"
      data-phone-shell="race-views"
      data-scrolls={edges.left || edges.right ? "true" : "false"}
      onScroll={measure}
      onPointerDown={() => (touched.current = true)}
      className="no-scrollbar flex shrink-0 overflow-x-auto border-b"
      style={{ borderColor: C.line, overscrollBehaviorX: "contain", maskImage: mask, WebkitMaskImage: mask }}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect(tab.id)}
            className="flex min-h-[44px] shrink-0 grow items-center justify-center gap-1 whitespace-nowrap px-4 text-sm"
            style={{
              color: isActive ? C.text : C.muted,
              fontWeight: isActive ? 600 : 400,
              borderBottom: `2px solid ${isActive ? C.accent : "transparent"}`,
            }}
          >
            {tab.label}
            {tab.locked && <LockIcon />}
          </button>
        );
      })}
    </nav>
  );
}

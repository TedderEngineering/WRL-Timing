/**
 * Bars that step aside while you read (mobile redesign): scrolling down the content slides the
 * page's top bars up out of the way; scrolling up, or reaching the top, brings them back, as
 * phone browsers and apps do. One listener on the page (scroll events in the capture phase), so
 * it follows whichever list or view is scrolling. Sideways rows, the card carousel and the lap
 * sheet are left out: they don't move the page.
 */
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from "react";

export const ChromeHiddenContext = createContext(false);
export const useChromeHidden = () => useContext(ChromeHiddenContext);

/** Below this the content is short: nothing to make room for. */
const MIN_SCROLL = 120;
/** A move smaller than this is a wobble, not a direction. */
const STEP = 6;

export function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);
  const last = useRef(new WeakMap<EventTarget, number>());
  const onScrollCapture = useCallback((e: UIEvent) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (el.closest("[data-lap-sheet],[data-carousel],nav,[role=tablist]")) return;
    if (el.scrollHeight - el.clientHeight < MIN_SCROLL) return;
    const y = el.scrollTop;
    const prev = last.current.get(el) ?? y;
    last.current.set(el, y);
    if (y < 24) setHidden(false);
    else if (y - prev > STEP) setHidden(true);
    else if (prev - y > STEP) setHidden(false);
  }, []);
  const show = useCallback(() => setHidden(false), []);
  return { hidden, onScrollCapture, show };
}

/**
 * Bars that slide away: the wrapper collapses its own height (so the content below gets the
 * room) as its bars slide up out of the page. Hidden bars can't take focus (inert).
 */
export function CollapsingBars({ hidden, children, className = "" }: { hidden: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      data-collapsing-bars={hidden ? "hidden" : "shown"}
      inert={hidden}
      className={`shrink-0 transition-[margin] duration-200 ease-out motion-reduce:transition-none ${className}`}
      style={{ marginTop: hidden ? -height : 0 }}
    >
      {children}
    </div>
  );
}

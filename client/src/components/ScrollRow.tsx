import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A horizontal row that scrolls without a scroll bar: the edges fade where more is hidden,
 * and a small arrow on each such edge scrolls by most of a width. The mouse wheel scrolls it
 * sideways, touch and trackpads swipe it, and the selected item (`data-active="true"`) is kept
 * in view. Used for the race tabs on the dashboard's recap cards.
 */
export function ScrollRow({
  children,
  className = "",
  innerClassName = "",
  activeKey,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  /** Changes when the selection changes, so the selected item is scrolled into view. */
  activeKey?: string | number;
} & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // A vertical wheel scrolls the row sideways while there is room to go; at the ends the page scrolls.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
      if (atStart || atEnd) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro?.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [measure]);

  useEffect(() => {
    // Scroll the row only (scrollIntoView would also scroll the page to the card).
    const el = ref.current;
    const active = el?.querySelector<HTMLElement>('[data-active="true"]');
    if (!el || !active) return;
    const pad = 48;
    const left = active.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft + pad) el.scrollLeft = Math.max(0, left - pad);
    else if (left + active.offsetWidth > el.scrollLeft + el.clientWidth - pad) el.scrollLeft = left + active.offsetWidth - el.clientWidth + pad;
  }, [activeKey]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  // Class names written out in full so Tailwind finds them.
  const fade = (side: "left" | "right") =>
    `pointer-events-none absolute inset-y-0 w-14 from-[var(--rt-surface)] to-transparent ${
      side === "left" ? "left-0 bg-gradient-to-r" : "right-0 bg-gradient-to-l"
    }`;
  const arrow = (side: "left" | "right") =>
    `absolute inset-y-0 flex w-8 items-center justify-center text-lg leading-none text-[var(--rt-text-muted)] hover:text-[var(--rt-text)] ${
      side === "left" ? "left-0" : "right-0"
    }`;

  return (
    <div className={`relative ${className}`}>
      <div ref={ref} onScroll={measure} className={`no-scrollbar flex overflow-x-auto overscroll-x-contain ${innerClassName}`} {...rest}>
        {children}
      </div>
      {edges.left && (
        <>
          <span aria-hidden className={fade("left")} />
          <button type="button" tabIndex={-1} aria-hidden onClick={() => page(-1)} className={arrow("left")}>
            ‹
          </button>
        </>
      )}
      {edges.right && (
        <>
          <span aria-hidden className={fade("right")} />
          <button type="button" tabIndex={-1} aria-hidden onClick={() => page(1)} className={arrow("right")}>
            ›
          </button>
        </>
      )}
    </div>
  );
}

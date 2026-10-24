/**
 * How to work the phone charts, kept off the chart itself (mobile redesign): a one-time bubble on
 * the first chart a phone opens, and the full list in the race menu (⋯ → Chart gestures).
 */
import { useEffect, useRef, useState } from "react";
import { Sheet, SHEET } from "../../components/Sheet";

export const GESTURES: { gesture: string; does: string }[] = [
  { gesture: "Tap", does: "Pick a lap and see its details" },
  { gesture: "Drag", does: "Read each lap you pass; when zoomed in, move along the race" },
  { gesture: "Pinch", does: "Zoom in or out on the laps" },
  { gesture: "Double-tap", does: "Zoom in on a lap; double-tap again for the whole race" },
  { gesture: "Two-finger tap", does: "Zoom out a step" },
  { gesture: "‹  ›", does: "Step one lap back or forward (bottom of the screen)" },
  { gesture: "Swipe the bottom sheet up", does: "More about the lap: events, pit cycles, the key" },
];

export function ChartGestureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Chart gestures">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-[15px]">
        {GESTURES.map((g) => (
          <div key={g.gesture} className="contents">
            <dt className="font-semibold" style={{ color: SHEET.text }}>
              {g.gesture}
            </dt>
            <dd className="m-0" style={{ color: SHEET.muted }}>
              {g.does}
            </dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}

const SEEN_KEY = "rt.chartHintSeen";

/**
 * A one-time bubble over the chart: "Pinch or double-tap to zoom". It goes after a few seconds or
 * at the first touch, and never shows again on this browser.
 */
export function ChartHintBubble() {
  const [show, setShow] = useState(false);
  const probe = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = probe.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => setShow(false);
    // Only once the chart is on screen: a chart kept mounted behind another view must not use it up.
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      try {
        if (localStorage.getItem(SEEN_KEY) === "1") return;
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        return;
      }
      setShow(true);
      timer = setTimeout(hide, 4500);
      window.addEventListener("touchstart", hide, { once: true, passive: true });
    });
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
      window.removeEventListener("touchstart", hide);
    };
  }, []);
  return (
    <>
      <div ref={probe} aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-px w-px" />
      {show && (
        <div
          role="status"
          data-chart-hint
          className="pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-max max-w-[90%] rounded-full px-3.5 py-1.5 text-[13px] shadow-lg"
          style={{ background: "rgba(18,18,42,0.94)", border: `1px solid ${SHEET.border}`, color: SHEET.text }}
        >
          Pinch or double-tap to zoom · ⋯ menu for more
        </div>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { ScrollRow } from "../../components/ScrollRow";

export interface FollowTab {
  id: string;
  label: string;
}

/** Hold this long (ms) without moving to pick a tab up; a quicker drag still scrolls the row. */
const HOLD_MS = 350;
const MOVE_TOLERANCE = 6;

/**
 * The followed cars' or drivers' tabs. Choose one with a click or the arrow keys. Reorder them:
 * hold a tab, then drag it left or right (mouse or touch); or, with the keyboard, Alt+← / Alt+→
 * on the chosen tab. The new order is reported once, when the tab is let go.
 */
export function FollowTabs({
  tabs,
  active,
  onChoose,
  onReorder,
  label,
  className = "border-b border-[var(--rt-border)]",
}: {
  tabs: FollowTab[];
  active: string | null;
  onChoose: (id: string) => void;
  onReorder?: (ids: string[]) => void;
  label: string;
  className?: string;
}) {
  const [order, setOrder] = useState(() => tabs.map((t) => t.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const hold = useRef<{ timer: number; x: number; y: number; id: string; pointerId: number } | null>(null);
  const moved = useRef(false);
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Follow the list when it changes from outside (a car added, a reorder saved).
  const key = tabs.map((t) => t.id).join("|");
  useEffect(() => {
    if (!dragging) setOrder(tabs.map((t) => t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // While a tab is held, a finger's move reorders instead of scrolling the page or the row.
  useEffect(() => {
    const el = rowRef.current;
    if (!el || !dragging) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, [dragging]);

  if (tabs.length < 2) return null;
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const shown = order.map((id) => byId.get(id)).filter((t): t is FollowTab => !!t);
  const idx = Math.max(0, shown.findIndex((t) => t.id === active));

  const commit = (next: string[]) => {
    if (next.join("|") !== tabs.map((t) => t.id).join("|")) onReorder?.(next);
  };

  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (!onReorder || (e.pointerType === "mouse" && e.button !== 0)) return;
    moved.current = false;
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    cancelHold();
    hold.current = {
      x: e.clientX,
      y: e.clientY,
      id,
      pointerId,
      timer: window.setTimeout(() => {
        setDragging(id);
        try {
          target.setPointerCapture(pointerId);
        } catch {
          // the pointer already went away
        }
        navigator.vibrate?.(10);
      }, HOLD_MS),
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const h = hold.current;
    if (!dragging) {
      // Moving before the hold completes is a scroll or a swipe: no pick-up.
      if (h && (Math.abs(e.clientX - h.x) > MOVE_TOLERANCE || Math.abs(e.clientY - h.y) > MOVE_TOLERANCE)) cancelHold();
      return;
    }
    e.preventDefault();
    const row = rowRef.current;
    if (!row) return;
    const buttons = [...row.querySelectorAll<HTMLButtonElement>("button[data-tab-id]")];
    const others = buttons.filter((b) => b.dataset.tabId !== dragging);
    // The dragged tab goes before the first other tab whose middle is right of the pointer.
    let at = others.findIndex((b) => {
      const r = b.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2;
    });
    if (at < 0) at = others.length;
    const rest = order.filter((id) => id !== dragging);
    const next = [...rest.slice(0, at), dragging, ...rest.slice(at)];
    if (next.join("|") !== order.join("|")) {
      moved.current = true;
      setOrder(next);
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    cancelHold();
    if (!dragging) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // not captured
    }
    setDragging(null);
    commit(order);
  };

  const move = (id: string, by: -1 | 1) => {
    const i = order.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    commit(next);
  };

  return (
    <div ref={rowRef}>
      <ScrollRow
        role="tablist"
        aria-label={label}
        activeKey={idx}
        className={className}
        innerClassName="gap-1"
        data-reordering={dragging ? "1" : undefined}
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          const dir = e.key === "ArrowRight" ? 1 : -1;
          if (e.altKey && onReorder) {
            move(shown[idx].id, dir);
            return;
          }
          const next = (idx + (dir === 1 ? 1 : shown.length - 1)) % shown.length;
          onChoose(shown[next].id);
          e.currentTarget.querySelectorAll<HTMLElement>("button[data-tab-id]")[next]?.focus();
        }}
      >
        {shown.map((t, i) => {
          const isDragged = dragging === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tab-id={t.id}
              aria-selected={i === idx}
              data-active={i === idx}
              tabIndex={i === idx ? 0 : -1}
              title={onReorder ? "Hold and drag to reorder (Alt+← / Alt+→ with the keyboard)" : undefined}
              onClick={(e) => {
                // A tab just dragged into place is not also chosen.
                if (moved.current) {
                  e.preventDefault();
                  moved.current = false;
                  return;
                }
                onChoose(t.id);
              }}
              onPointerDown={(e) => onPointerDown(e, t.id)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onContextMenu={(e) => {
                // A long press on a phone picks the tab up instead of opening the context menu.
                if (onReorder) e.preventDefault();
              }}
              className={`flex min-h-[40px] select-none items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors ${
                i === idx ? "border-[var(--rt-accent)] font-semibold text-[var(--rt-text)]" : "border-transparent text-[var(--rt-text-muted)] hover:text-[var(--rt-text)]"
              } ${isDragged ? "relative z-10 cursor-grabbing rounded-md bg-[var(--rt-surface)] shadow-lg ring-1 ring-[var(--rt-accent)]" : ""}`}
              style={{ WebkitTouchCallout: "none" }}
            >
              {t.label}
            </button>
          );
        })}
      </ScrollRow>
      {dragging && (
        <span className="sr-only" role="status">
          Moving {byId.get(dragging)?.label}. Let go to drop it.
        </span>
      )}
    </div>
  );
}

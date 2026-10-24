/**
 * A phone bottom sheet (mobile redesign, PR 2): rises from the bottom over the page, with a
 * grab handle, a title and a 44 px close button. Esc, the close button or a tap on the
 * backdrop closes it; focus moves into it on open and back to where it was on close; the page
 * behind does not scroll while it is open.
 *
 * Colours are the laptop race page's (RaceDetailPage `RT`): surface #12122a, border #1e1e38,
 * text #e0e0e8, muted #9a9ab4, so a sheet reads as the laptop's side panel moved to the bottom.
 *
 * `keepMounted` keeps the children mounted while closed (hidden), for content with effects
 * that must run whether or not the sheet is open, such as the Follow button, which opens the
 * race on the user's own car.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";

export const SHEET = { surface: "#12122a", border: "#1e1e38", text: "#e0e0e8", muted: "#9a9ab4", accent: "#F48C34" };

export function Sheet({
  open,
  onClose,
  title,
  children,
  keepMounted = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  keepMounted?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      html.style.overflow = overflow;
      returnTo.current?.focus?.();
    };
  }, [open]);

  if (!open && !keepMounted) return null;

  return (
    <div className="fixed inset-0 z-50" style={open ? undefined : { display: "none" }} aria-hidden={!open}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="custom-scroll absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t outline-none motion-safe:animate-sheet-up"
        style={{ background: SHEET.surface, borderColor: SHEET.border, color: SHEET.text, paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <div className="sticky top-0 z-10" style={{ background: SHEET.surface }}>
          <div className="mx-auto mt-2 h-1 w-10 rounded-full" style={{ background: SHEET.border }} aria-hidden />
          <div className="flex min-h-[48px] items-center justify-between gap-2 pl-4 pr-1">
            <h2 id={titleId} className="m-0 min-w-0 truncate text-base font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
              style={{ color: SHEET.muted }}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="px-4 pb-2">{children}</div>
      </div>
    </div>
  );
}

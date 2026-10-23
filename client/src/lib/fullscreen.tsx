import { useEffect, useState } from "react";

/**
 * Full screen: the page fills the whole display, the browser's bars and the computer's taskbar
 * hidden (the browser's Fullscreen API), and RaceTrace's own top bar hidden too (Layout.tsx).
 * Esc, or the button, leaves it. Not offered where the browser cannot do it (iPhone Safari).
 */
type Doc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean };
type El = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function fullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as Doc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

function current(): boolean {
  const d = document as Doc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

export async function toggleFullscreen(): Promise<void> {
  const d = document as Doc;
  try {
    if (current()) await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
    else {
      const el = document.documentElement as El;
      await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen?.());
    }
  } catch {
    /* refused (not from a tap, or blocked): nothing changes */
  }
}

/** Whether the page is full screen now, kept current (Esc leaves it without the button). */
export function useFullscreen(): boolean {
  const [on, setOn] = useState(() => (typeof document === "undefined" ? false : current()));
  useEffect(() => {
    const update = () => setOn(current());
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);
  return on;
}

const ENTER = "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5";
const EXIT = "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5";

/** The full-screen button: in the top bar, and floating at the top right while full screen (the top bar is hidden then). */
export function FullscreenButton({ on, floating = false, className = "" }: { on: boolean; floating?: boolean; className?: string }) {
  if (!fullscreenSupported()) return null;
  const label = on ? "Exit full screen (Esc)" : "Full screen";
  return (
    <button
      type="button"
      onClick={() => void toggleFullscreen()}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={
        floating
          ? `fixed right-1.5 top-1.5 z-50 flex h-7 w-7 items-center justify-center rounded-md border border-gray-700 bg-gray-950/80 text-gray-300 opacity-60 backdrop-blur-sm transition-opacity hover:opacity-100 ${className}`
          : `flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100 ${className}`
      }
    >
      <svg viewBox="0 0 24 24" className={floating ? "h-4 w-4" : "h-5 w-5"} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={on ? EXIT : ENTER} />
      </svg>
    </button>
  );
}

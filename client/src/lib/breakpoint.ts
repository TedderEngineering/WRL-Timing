/**
 * Screen-size classes, read live from the browser (mobile redesign, Step 3, PR 1).
 *
 * One place for "is this a phone?", so every component switches at the same width and
 * re-lays out when the window is resized or the phone is turned. The widths are
 * Tailwind's: `sm` (640 px) starts the medium class and `lg` (1024 px) the expanded one,
 * so a component's JS and its `sm:` / `lg:` classes always agree.
 */
import { useSyncExternalStore } from "react";

export type DeviceClass = "compact" | "medium" | "expanded";

/**
 * Phones, either way up: narrower than Tailwind's `sm`, or short and touch-only (a phone held
 * sideways is 360-430 px tall). The Tailwind screens use the same rule (tailwind.config.js), so a
 * sideways phone gets the phone layout in CSS and JS alike.
 */
export const COMPACT_QUERY = "(max-width: 639.98px), (max-height: 499.98px) and (pointer: coarse)";
/** A phone held sideways: the compact layout, with the little height it has. */
export const LANDSCAPE_PHONE_QUERY = "(max-height: 499.98px) and (pointer: coarse) and (orientation: landscape)";
/** Phones and tablets: below Tailwind's `lg`. */
const BELOW_EXPANDED_QUERY = "(max-width: 1023.98px)";

/** The class for a window this many CSS pixels wide. */
export function deviceClassOf(width: number): DeviceClass {
  if (width < 640) return "compact";
  if (width < 1024) return "medium";
  return "expanded";
}

function matches(query: string): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  } catch {
    return false;
  }
}

/** The class of the window right now, for code that is not a component (analytics). */
export function currentDeviceClass(): DeviceClass {
  if (typeof window === "undefined") return "expanded";
  if (typeof window.matchMedia !== "function") return deviceClassOf(window.innerWidth);
  if (matches(COMPACT_QUERY)) return "compact";
  return matches(BELOW_EXPANDED_QUERY) ? "medium" : "expanded";
}

function subscribe(query: string) {
  return (onChange: () => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  };
}

const subscribers = new Map<string, (onChange: () => void) => () => void>();

/** Whether a media query matches, kept current as the window changes. */
export function useMediaQuery(query: string): boolean {
  let sub = subscribers.get(query);
  if (!sub) {
    sub = subscribe(query);
    subscribers.set(query, sub);
  }
  return useSyncExternalStore(sub, () => matches(query), () => false);
}

/** True on a phone, upright or sideways. */
export function useIsCompact(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}

/** True on a phone held sideways. */
export function useIsLandscapePhone(): boolean {
  return useMediaQuery(LANDSCAPE_PHONE_QUERY);
}

/** The window's class, kept current as it changes. */
export function useDeviceClass(): DeviceClass {
  const compact = useMediaQuery(COMPACT_QUERY);
  const belowExpanded = useMediaQuery(BELOW_EXPANDED_QUERY);
  return compact ? "compact" : belowExpanded ? "medium" : "expanded";
}

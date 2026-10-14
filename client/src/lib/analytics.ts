/**
 * Product analytics shared by RaceTrace and Finding Grip (ENGAGEMENT_PRINCIPLES:
 * "same tool and the same event names on both sites").
 *
 * `track()` is the only entry point. Until an analytics service is connected it
 * sends nothing anywhere: events are kept in a short in-memory list (and logged
 * in development) so they can be checked. Connecting PostHog later means
 * registering a sender with `setAnalyticsSender()`; no call site changes.
 *
 * Privacy rules, enforced here so no call site can break them:
 *  - no names, email addresses or free text in event details;
 *  - nothing is sent when the browser asks not to be tracked
 *    (Global Privacy Control or Do Not Track);
 *  - no cookies or storage are written by this module.
 */
import { IS_GRIP_SITE } from "./site";

/** Every event either site may send. Keep the names identical across sites. */
export const ANALYTICS_EVENTS = [
  // RaceTrace
  "follow_car",
  "open_story",
  // Finding Grip
  "record_hot",
  "on_target",
  // Both
  "share_card",
  "alert_opt_in",
  "coffee_open",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Short, non-personal details: numbers, booleans and short codes only. */
export type AnalyticsDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface SentEvent {
  event: AnalyticsEvent;
  site: "racetrace" | "findinggrip";
  details: Record<string, string | number | boolean | null>;
  at: number;
}

type Sender = (e: SentEvent) => void;

let sender: Sender | null = null;
const recent: SentEvent[] = [];
const RECENT_MAX = 50;

/** Keys that could carry personal data are never sent. */
const BLOCKED_KEY = /mail|name|phone|address|note|text|comment/i;
/** Values that look like an email address are never sent. */
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function clean(details: AnalyticsDetails | undefined): SentEvent["details"] {
  const out: SentEvent["details"] = {};
  if (!details) return out;
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || BLOCKED_KEY.test(key)) continue;
    if (typeof value === "string") {
      // Short codes only ("header", "on-target", "INDY"), never free text.
      if (value.length > 40 || EMAIL_LIKE.test(value)) continue;
    }
    out[key] = value;
  }
  return out;
}

/** True when the browser has asked sites not to track it. */
export function trackingRefused(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

/** Record that something happened. Never throws and never blocks the page. */
export function track(event: AnalyticsEvent, details?: AnalyticsDetails): void {
  try {
    if (trackingRefused()) return;
    const e: SentEvent = {
      event,
      site: IS_GRIP_SITE ? "findinggrip" : "racetrace",
      details: clean(details),
      at: Date.now(),
    };
    recent.push(e);
    if (recent.length > RECENT_MAX) recent.shift();
    if (import.meta.env?.DEV) console.debug("[analytics]", e.event, e.site, e.details);
    sender?.(e);
  } catch {
    // Analytics must never break the site.
  }
}

/** Connect an analytics service (PostHog, once chosen). Pass null to disconnect. */
export function setAnalyticsSender(next: Sender | null): void {
  sender = next;
}

/** The last few events, newest last. For tests and checking in the browser console. */
export function recentEvents(): readonly SentEvent[] {
  return recent;
}

// Handy when checking a live page: `__teAnalytics()` in the console.
if (typeof window !== "undefined") {
  (window as Window & { __teAnalytics?: () => readonly SentEvent[] }).__teAnalytics =
    recentEvents;
}

/**
 * Product analytics shared by RaceTrace and Finding Grip (ENGAGEMENT_PRINCIPLES:
 * "same tool and the same event names on both sites").
 *
 * `track()` is the only entry point. Events go to PostHog Cloud US when
 * VITE_POSTHOG_KEY is set (one project key for both sites); without it nothing
 * leaves the browser. Either way the last few events are kept in memory (and
 * logged in development) so they can be checked with `__teAnalytics()`.
 *
 * Privacy rules, enforced here so no call site can break them (they match the
 * "Product analytics" section of the privacy page):
 *  - anonymous: a random id for this page visit only, never the account, and
 *    PostHog is told not to build a person profile;
 *  - no names, email addresses or free text in event details, and no page
 *    addresses (they can contain record ids);
 *  - nothing is sent when the browser asks not to be tracked
 *    (Global Privacy Control or Do Not Track);
 *  - no cookies or storage; events are posted directly, without PostHog's
 *    script, so there is no click capture or session recording.
 * Return visits are measured from our own database, not from analytics.
 *
 * Visits: `visit { source, landing, device }` once per page load. `source` is the link's `?from=` tag
 * (instagram, email, share…) or, without one, the kind of site that linked here (google,
 * facebook, other_site, direct), never the page or search that sent the visitor; `landing` is a
 * short code for the page type; `device` is the screen size class (compact, medium, expanded:
 * lib/breakpoint.ts), so phone use can be told apart. See `noteVisit`.
 */
import { IS_GRIP_SITE } from "./site";
import { currentDeviceClass } from "./breakpoint";

/** Every event either site may send. Keep the names identical across sites. */
export const ANALYTICS_EVENTS = [
  // RaceTrace
  "follow_car",
  "follow_driver", // { source }
  "open_story",
  "download_pdf", // { tab }: a race-page tab saved as a PDF
  "pdf_failed", // { tab, reason }: site_updated (reloaded to finish), load or build
  // Finding Grip
  "record_hot",
  "on_target",
  // Both
  "share_card", // { kind, method, device }
  "share_app", // { source, method }: someone shared the site's link
  "share_arrival", // { landing }: a visit came from a shared link (?from=share)
  "alert_opt_in", // { channel, on, source }
  "alert_open", // arrival from an alert email
  "checklist_step", // { step }
  "coffee_open", // { from }
  "coffee_paid", // { coffees }, on the thank-you page
  "visit", // { source, landing, device }: a page load, where it came from (noteVisit), and the screen size class
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

/** Connect an analytics service. Pass null to disconnect. (PostHog connects itself below.) */
export function setAnalyticsSender(next: Sender | null): void {
  sender = next;
}

/** The last few events, newest last. For tests and checking in the browser console. */
export function recentEvents(): readonly SentEvent[] {
  return recent;
}

// ─── PostHog Cloud US ────────────────────────────────────────────────────────

/** A random id for this page visit only; never stored, never the account. */
function visitId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Sender that posts one event to PostHog's capture endpoint. */
export function postHogSender(
  key: string,
  host: string,
  fetchImpl: typeof fetch = fetch
): Sender {
  const distinctId = visitId();
  const url = `${host.replace(/\/+$/, "")}/i/v0/e/`;
  return (e) => {
    void fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // keepalive lets an event sent just before leaving the page still arrive.
      keepalive: true,
      body: JSON.stringify({
        api_key: key,
        event: e.event,
        distinct_id: distinctId,
        timestamp: new Date(e.at).toISOString(),
        properties: {
          ...e.details,
          site: e.site,
          $process_person_profile: false,
          $geoip_disable: true,
          $lib: "tedder-web",
        },
      }),
    }).catch(() => {
      // Offline or blocked: drop it.
    });
  };
}

const POSTHOG_KEY = (import.meta.env?.VITE_POSTHOG_KEY as string | undefined)?.trim();
const POSTHOG_HOST =
  (import.meta.env?.VITE_POSTHOG_HOST as string | undefined)?.trim() ||
  "https://us.i.posthog.com";
if (POSTHOG_KEY && typeof window !== "undefined") {
  sender = postHogSender(POSTHOG_KEY, POSTHOG_HOST);
}

// Handy when checking a live page: `__teAnalytics()` in the console.
if (typeof window !== "undefined") {
  (window as Window & { __teAnalytics?: () => readonly SentEvent[] }).__teAnalytics =
    recentEvents;
}

// ─── Visits ──────────────────────────────────────────────────────────────────

/**
 * The address and referrer the page was opened with, read when this module first loads (before
 * any arrival handler takes its `?from=` tag out of the address bar).
 */
const OPENED_WITH =
  typeof window !== "undefined"
    ? { href: window.location.href, referrer: typeof document !== "undefined" ? document.referrer : "" }
    : null;

/** Referrer hosts named by their site; anything else is "other_site". */
const REFERRERS: [RegExp, string][] = [
  [/(^|\.)google\./, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)yahoo\./, "yahoo"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "x"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)whatsapp\.(com|net)$/, "whatsapp"],
  [/(^|\.)tedderengineering\.com$/, "internal"],
];

/**
 * Where a visit came from: the address's `?from=` tag when it has one (lower case, letters,
 * digits, - and _, at most 24 characters; anything else is "other_tag"), else the referring
 * site's name, "other_site", or "direct" without a referrer. Never a page address or search.
 */
export function visitSource(href: string, referrer: string): string {
  try {
    const tag = new URL(href).searchParams.get("from");
    if (tag !== null) {
      const t = tag.trim().toLowerCase();
      return /^[a-z0-9_-]{1,24}$/.test(t) ? t : "other_tag";
    }
  } catch {
    // not a URL: fall through to the referrer
  }
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (typeof window !== "undefined" && host === window.location.hostname) return "internal";
    for (const [re, name] of REFERRERS) if (re.test(host)) return name;
    return "other_site";
  } catch {
    return "other_site";
  }
}

let visitNoted = false;

/**
 * Once per page load: send `visit { source, landing, device }`. `landing(path)` gives a short code for
 * the page type (home, race, live…); the address itself is never sent. A `?from=` tag other
 * than the ones their own handlers read (share, alert) is then taken out of the address bar,
 * so a reload or bookmark doesn't count it again.
 */
export function noteVisit(landing: (path: string) => string): void {
  const at =
    OPENED_WITH ??
    (typeof window !== "undefined"
      ? { href: window.location.href, referrer: typeof document !== "undefined" ? document.referrer : "" }
      : null);
  if (visitNoted || !at) return;
  visitNoted = true;
  try {
    const opened = new URL(at.href);
    track("visit", { source: visitSource(at.href, at.referrer), landing: landing(opened.pathname), device: currentDeviceClass() });
    const now = new URL(window.location.href);
    const tag = now.searchParams.get("from");
    if (tag !== null && tag !== "share" && tag !== "alert") {
      now.searchParams.delete("from");
      window.history.replaceState(window.history.state, "", `${now.pathname}${now.search}${now.hash}`);
    }
  } catch {
    // never break the page for analytics
  }
}

export function __resetVisitForTests(): void {
  visitNoted = false;
}

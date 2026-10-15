import { track } from "@/lib/analytics";

/**
 * Sharing a link to the site (shared by RaceTrace and Finding Grip; same API as Finding Grip's
 * `feature/grip-share-app`).
 *
 * A shared link carries `?from=share`: the same tag for everyone, never who shared it, so the
 * two events (`share_app` when someone shares, `share_arrival` when a visit comes from a
 * share) count sharing without tying a link to an account (Privacy page, "Product analytics").
 */

export type ShareLinkMethod = "share" | "copy" | "cancelled" | "failed";

const TAG = "from";
const TAG_VALUE = "share";

/** `base` with `?from=share` added, keeping anything already in it. */
export function sharedUrl(base: string): string {
  const u = new URL(base, typeof window !== "undefined" ? window.location.origin : "https://racetrace.tedderengineering.com");
  u.searchParams.set(TAG, TAG_VALUE);
  return u.toString();
}

/**
 * Open the share sheet; where there is none, or it refuses, copy `text + " " + url` instead.
 * Sends `share_app { source, method }` only when something was shared or copied.
 */
export async function shareLink(args: { url: string; title: string; text: string; source: string }): Promise<ShareLinkMethod> {
  const nav = (typeof navigator !== "undefined" ? navigator : undefined) as
    | (Navigator & { share?: (d: ShareData) => Promise<void> })
    | undefined;
  let method: ShareLinkMethod;
  if (nav && typeof nav.share === "function") {
    try {
      await nav.share({ title: args.title, text: args.text, url: args.url });
      method = "share";
    } catch (err) {
      method = err instanceof DOMException && err.name === "AbortError" ? "cancelled" : await copy(`${args.text} ${args.url}`);
    }
  } else {
    method = await copy(`${args.text} ${args.url}`);
  }
  if (method === "share" || method === "copy") track("share_app", { source: args.source, method });
  return method;
}

async function copy(text: string): Promise<ShareLinkMethod> {
  try {
    await navigator.clipboard.writeText(text);
    return "copy";
  } catch {
    return "failed";
  }
}

let arrivalNoted = false;

/**
 * Once per page load: when the address has `?from=share`, send `share_arrival { landing }` and
 * take the tag out of the address bar, so a reload, bookmark or re-share doesn't count again.
 * `landing(path)` gives a short code; the page address itself is never sent.
 */
export function noteShareArrival(landing: (path: string) => string): void {
  if (arrivalNoted || typeof window === "undefined") return;
  arrivalNoted = true;
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get(TAG) !== TAG_VALUE) return;
    track("share_arrival", { landing: landing(u.pathname) });
    u.searchParams.delete(TAG);
    window.history.replaceState(window.history.state, "", `${u.pathname}${u.search}${u.hash}`);
  } catch {
    // never break the page for analytics
  }
}

/** For tests: forget that this page load's arrival was noted. */
export function __resetShareArrivalForTests(): void {
  arrivalNoted = false;
}

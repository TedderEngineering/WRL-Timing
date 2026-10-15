import { track } from "@/lib/analytics";

export type LinkShareMethod = "share" | "copy" | "cancelled" | "failed";

/**
 * A race link to send a friend, with `utm_source=share` so a later arrival event can count
 * friends who came from a shared link. Nothing about the sender is in it.
 */
export function shareUrl(path: string, origin = window.location.origin): string {
  const u = new URL(path, origin);
  u.searchParams.set("utm_source", "share");
  return u.toString();
}

/**
 * Share a link: the phone's share sheet (Messages, WhatsApp…) on a touch device that has
 * one, otherwise copy it. Sends `share_card { kind, method }`, the agreed event on both
 * sites, unless the person cancelled.
 */
export async function shareLink(args: { url: string; title: string; kind: string }): Promise<LinkShareMethod> {
  let method: LinkShareMethod;
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  let coarse = false;
  try {
    coarse = window.matchMedia("(pointer: coarse)").matches;
  } catch {
    coarse = false;
  }
  if (coarse && typeof nav.share === "function") {
    try {
      await nav.share({ title: args.title, text: args.title, url: args.url });
      method = "share";
    } catch (err) {
      method = err instanceof DOMException && err.name === "AbortError" ? "cancelled" : await copy(args.url);
    }
  } else {
    method = await copy(args.url);
  }
  if (method === "share" || method === "copy") track("share_card", { kind: args.kind, method });
  return method;
}

async function copy(text: string): Promise<LinkShareMethod> {
  try {
    await navigator.clipboard.writeText(text);
    return "copy";
  } catch {
    return "failed";
  }
}

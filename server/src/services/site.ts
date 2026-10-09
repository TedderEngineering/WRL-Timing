/**
 * Which Tedder Engineering site a request came from.
 *
 * One API serves RaceTrace and Finding Grip. Account emails (verify, reset)
 * and return links use the name and address of the site the person is on.
 * Only the two configured addresses are ever used, so a forged header cannot
 * point a link anywhere else.
 */
import type { Request } from "express";
import { env } from "../config/env.js";

export interface Site {
  key: "racetrace" | "grip";
  name: string;
  /** Base address, no trailing slash. */
  url: string;
  /** Button and heading colour in emails. */
  accent: string;
}

const trim = (url: string) => url.replace(/\/+$/, "");

export function racetraceSite(): Site {
  return {
    key: "racetrace",
    name: "RaceTrace",
    url: trim(env.FRONTEND_URL),
    accent: "#4263eb",
  };
}

/**
 * GRIP_PUBLIC_URL as typed by a person: tolerate spaces, a missing https://
 * and a trailing path. Returns the origin, or a reason it cannot be used.
 */
export function readGripPublicUrl(): { url: string | null; problem: string | null } {
  const raw = (env.GRIP_PUBLIC_URL ?? "").trim();
  if (!raw) return { url: null, problem: null };
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!parsed.hostname.includes(".")) throw new Error("no domain");
    return { url: parsed.origin, problem: null };
  } catch {
    return { url: null, problem: "GRIP_PUBLIC_URL is not a web address" };
  }
}

/** Finding Grip's own site, once GRIP_PUBLIC_URL is set. */
export function gripSite(): Site | null {
  const { url } = readGripPublicUrl();
  if (!url) return null;
  return { key: "grip", name: "Finding Grip", url, accent: "#e05a00" };
}

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Pick the site from the browser's Origin / Referer, or the host the proxy forwarded. */
export function siteForRequest(req: Pick<Request, "headers">): Site {
  const grip = gripSite();
  if (grip) {
    const gripHost = hostOf(grip.url);
    const forwarded = req.headers["x-forwarded-host"];
    const candidates = [
      req.headers.origin,
      req.headers.referer,
      Array.isArray(forwarded) ? forwarded[0] : forwarded,
    ];
    for (const candidate of candidates) {
      const host = hostOf(candidate);
      if (!host) continue;
      return host === gripHost ? grip : racetraceSite();
    }
  }
  return racetraceSite();
}

/** Address of a Finding Grip page: on its own site if it has one, otherwise under /grip on RaceTrace. */
export function gripPageUrl(path: string): string {
  const grip = gripSite();
  return grip ? `${grip.url}${path}` : `${trim(env.FRONTEND_URL)}/grip${path}`;
}

/** Browser origins allowed to call the API directly. */
export function allowedOrigins(): string[] {
  const grip = gripSite();
  return [trim(env.FRONTEND_URL), ...(grip ? [grip.url] : [])];
}

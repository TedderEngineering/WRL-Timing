/**
 * Which Tedder Engineering site a request came from.
 *
 * One API serves RaceTrace, Finding Grip and Setup Sheet. Account emails
 * (verify, reset) and return links use the name and address of the site the
 * person is on. Only configured addresses are ever used, so a forged header
 * cannot point a link anywhere else.
 */
import type { Request } from "express";
import { env } from "../config/env.js";

export interface Site {
  key: "racetrace" | "grip" | "setup";
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
  return readPublicUrl("GRIP_PUBLIC_URL", env.GRIP_PUBLIC_URL);
}

/** SETUP_PUBLIC_URL, read with the same tolerance as GRIP_PUBLIC_URL. */
export function readSetupPublicUrl(): { url: string | null; problem: string | null } {
  return readPublicUrl("SETUP_PUBLIC_URL", env.SETUP_PUBLIC_URL);
}

function readPublicUrl(
  name: string,
  value: string | undefined
): { url: string | null; problem: string | null } {
  const raw = (value ?? "").trim();
  if (!raw) return { url: null, problem: null };
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    // A real domain, or localhost for local development.
    if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost")
      throw new Error("no domain");
    return { url: parsed.origin, problem: null };
  } catch {
    return { url: null, problem: `${name} is not a web address` };
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

/** Setup Sheet's own site, once SETUP_PUBLIC_URL is set. */
export function setupSite(): Site | null {
  const { url } = readSetupPublicUrl();
  if (!url) return null;
  return { key: "setup", name: "Setup Sheet", url, accent: "#1f5fbf" };
}

/** Sites with their own address, besides RaceTrace. */
function otherSites(): Site[] {
  return [gripSite(), setupSite()].filter((s): s is Site => s !== null);
}

/** Pick the site from the browser's Origin / Referer, or the host the proxy forwarded. */
export function siteForRequest(req: Pick<Request, "headers">): Site {
  const others = otherSites();
  if (others.length > 0) {
    const forwarded = req.headers["x-forwarded-host"];
    const candidates = [
      req.headers.origin,
      req.headers.referer,
      Array.isArray(forwarded) ? forwarded[0] : forwarded,
    ];
    for (const candidate of candidates) {
      const host = hostOf(candidate);
      if (!host) continue;
      return others.find((site) => hostOf(site.url) === host) ?? racetraceSite();
    }
  }
  return racetraceSite();
}

/** Address of a Finding Grip page: on its own site if it has one, otherwise under /grip on RaceTrace. */
export function gripPageUrl(path: string): string {
  const grip = gripSite();
  return grip ? `${grip.url}${path}` : `${trim(env.FRONTEND_URL)}/grip${path}`;
}

/**
 * Browser origins allowed to call the API directly: every configured site,
 * plus EXTRA_CORS_ORIGINS outside production (e.g. http://localhost:3000).
 */
export function allowedOrigins(): string[] {
  const extra =
    env.NODE_ENV === "production"
      ? []
      : (env.EXTRA_CORS_ORIGINS ?? "")
          .split(",")
          .map((o) => readPublicUrl("EXTRA_CORS_ORIGINS", o).url)
          .filter((o): o is string => !!o);
  return [
    ...new Set([trim(env.FRONTEND_URL), ...otherSites().map((s) => s.url), ...extra]),
  ];
}

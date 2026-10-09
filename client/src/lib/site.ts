/**
 * Which Tedder Engineering site this page is being served as.
 *
 * The same build serves RaceTrace and Finding Grip. On the Finding Grip
 * address the app shows only Finding Grip, at clean URLs (/dashboard), with
 * its own name, colours and sign-in pages. On the RaceTrace address Finding
 * Grip lives under /grip until its own address is configured, after which
 * /grip forwards there.
 */
const hostname =
  typeof window === "undefined" ? "" : window.location.hostname.toLowerCase();

/** True on findinggrip.tedderengineering.com (and findinggrip.localhost in development). */
export const IS_GRIP_SITE = hostname.startsWith("findinggrip.");

export const SITE_NAME = IS_GRIP_SITE ? "Finding Grip" : "RaceTrace";
export const RACETRACE_URL = "https://racetrace.tedderengineering.com";

/** Path of a Finding Grip page: gp("/dashboard") is /dashboard on its own site, /grip/dashboard on RaceTrace. */
export function gp(path = ""): string {
  if (IS_GRIP_SITE) return path || "/";
  return `/grip${path}`;
}

/** The same page's path on the Finding Grip site, given a RaceTrace-style /grip/... path. */
export function stripGripPrefix(pathname: string): string {
  const rest = pathname.replace(/^\/grip(?=\/|$)/, "");
  return rest || "/";
}

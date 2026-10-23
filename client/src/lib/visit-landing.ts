/**
 * The page type a visit landed on, as a short code for the `visit` event (never the address,
 * which can hold record ids). Finding Grip: home or app. RaceTrace: home, race, live, events,
 * dashboard, sign_in, settings, qualifying or other.
 */
import { IS_GRIP_SITE } from "./site";

export function landingCode(path: string): string {
  const p = path.replace(/\/+$/, "") || "/";
  if (IS_GRIP_SITE || p === "/grip" || p.startsWith("/grip/")) return p === "/" || p === "/grip" ? "grip_home" : "grip_app";
  if (p === "/") return "home";
  if (p === "/chart" || p.startsWith("/races/")) return "race";
  if (p.startsWith("/live")) return "live";
  if (p === "/races" || p.startsWith("/events")) return "events";
  if (p === "/dashboard") return "dashboard";
  if (/^\/(login|signup|forgot-password|reset-password|verify-email)/.test(p)) return "sign_in";
  if (p.startsWith("/settings")) return "settings";
  if (p.startsWith("/qualifying")) return "qualifying";
  return "other";
}

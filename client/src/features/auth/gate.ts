/**
 * What a visitor was trying to open when the sign-in gate stopped them (a shared race link, a live
 * race, the race list), so the log-in and sign-up pages can name it: the most direct reason to
 * sign up is the thing they already wanted to see.
 */
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export type GateTarget =
  | { kind: "race"; id: string }
  | { kind: "live"; slug: string }
  | { kind: "races" }
  | { kind: "qualifying" }
  | null;

/** The gated page a path leads to (/chart?race=…, /races/:id, /live/:slug, /races, /qualifying). */
export function gateTarget(path: string | null | undefined): GateTarget {
  if (!path) return null;
  const url = new URL(path, "https://x.invalid");
  const p = url.pathname;
  const race = url.searchParams.get("race");
  if (p === "/chart" && race) return { kind: "race", id: race };
  const m = p.match(/^\/races\/([^/]+)$/);
  if (m) return { kind: "race", id: decodeURIComponent(m[1]) };
  const live = p.match(/^\/live\/(?!next\/)([^/]+)$/);
  if (live) return { kind: "live", slug: decodeURIComponent(live[1]) };
  if (p === "/races" || p === "/chart" || p === "/live") return { kind: "races" };
  if (p.startsWith("/qualifying")) return { kind: "qualifying" };
  return null;
}

/** "Sunday 7 Hour" from a live slug ("wrl-sebring-2026-sunday-7-hour" → the words after the year). */
export function liveName(slug: string): string {
  const words = slug.split("-");
  const y = words.findIndex((w) => /^\d{4}$/.test(w));
  const rest = (y >= 0 ? words.slice(y + 1) : words).filter(Boolean);
  // Short words are class names (GTO, GP1); the rest take a capital.
  const word = (w: string) =>
    /^\d+$/.test(w)
      ? w
      : w.length <= 3 && !/^(and|the|of|day)$/.test(w)
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1);
  return rest.map(word).join(" ") || "the live race";
}

export interface GateRace {
  name: string;
  track: string;
  date: string;
  series: string;
}

/** The name of the race a gated link leads to (published races only; null while loading or unknown). */
export function useGateRace(target: GateTarget): GateRace | null {
  const id = target?.kind === "race" ? target.id : null;
  const [race, setRace] = useState<GateRace | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    api
      .get<GateRace>(`/landing/race/${encodeURIComponent(id)}`)
      .then((r) => alive && setRace(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  return id ? race : null;
}

/** The page title's object: what signing in opens. */
export function gateObject(target: GateTarget, race: GateRace | null): string | null {
  if (!target) return null;
  if (target.kind === "race") return race ? race.name.split(" — ")[0] : "this race";
  if (target.kind === "live") return `${liveName(target.slug)}, live`;
  if (target.kind === "races") return "every race";
  return "qualifying";
}

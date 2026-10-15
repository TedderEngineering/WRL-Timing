/**
 * My cars (engagement plan B): the cars a user follows, and the follow a signed-out visitor
 * asked for before making an account (kept for a few minutes in this tab, then done on return).
 */
import { api } from "../../lib/api";

export type SeriesFamily = "imsa" | "sro" | "wrl";
export const SERIES_LABEL: Record<SeriesFamily, string> = { imsa: "IMSA", sro: "SRO", wrl: "WRL" };

export interface MyCar {
  id: string;
  label: string | null;
  number: string;
  series: SeriesFamily;
  teamName: string | null;
  carClass: string | null;
  season: number | null;
}

export type CarInput = Partial<Omit<MyCar, "id">>;

export const listCars = () => api.get<{ cars: MyCar[]; max: number }>("/me/cars");
export const addCar = (car: CarInput) => api.post<{ car: MyCar }>("/me/cars", car);
export const updateCar = (id: string, car: CarInput) => api.patch<{ car: MyCar }>(`/me/cars/${id}`, car);
export const removeCar = (id: string) => api.delete<void>(`/me/cars/${id}`);
export const followCar = (raceId: string, carNumber: string) =>
  api.post<{ car: MyCar; created: boolean }>("/me/cars/follow", { raceId, carNumber });
export const followedInRace = (raceId: string) =>
  api.get<{ followed: { carNumber: string; carId: string }[] }>(`/me/cars/in-race/${raceId}`);

/** "#67 · Blackdog Racing · 2026", or the user's own label first. */
export function carTitle(c: MyCar): string {
  const rest = [c.teamName, c.season ? String(c.season) : "any season"].filter(Boolean).join(" · ");
  return c.label ? `${c.label} (#${c.number})` : `#${c.number}${rest ? ` · ${rest}` : ""}`;
}

// ─── A follow asked for before signing up ────────────────────────────────────

const KEY = "racetrace.pendingFollow";
const MAX_AGE_MS = 15 * 60 * 1000;

export function rememberPendingFollow(raceId: string, carNumber: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ raceId, carNumber, at: Date.now() }));
  } catch {
    // storage blocked: they can press Follow again after signing in
  }
}

/** A follow is waiting for the visitor to finish signing up (onboarding then skips asking). */
export function hasPendingFollow(now = Date.now()): boolean {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY) || "null") as { at?: unknown } | null;
    return !!p && typeof p.at === "number" && now - p.at <= MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** The pending follow for this race, removed once read; null when none or too old. */
export function takePendingFollow(raceId: string, now = Date.now()): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { raceId?: unknown; carNumber?: unknown; at?: unknown };
    if (p.raceId !== raceId) return null;
    sessionStorage.removeItem(KEY);
    if (typeof p.at !== "number" || now - p.at > MAX_AGE_MS || typeof p.carNumber !== "string") return null;
    return p.carNumber;
  } catch {
    return null;
  }
}

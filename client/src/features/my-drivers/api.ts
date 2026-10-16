/**
 * My drivers: the drivers a user follows, whatever car or series they race in. Server:
 * /api/me/drivers (server/src/services/my-drivers.ts). One shared list for the page, so the race
 * page's Follow buttons, the search results and Settings agree without reloading.
 */
import { useEffect, useSyncExternalStore } from "react";
import { api } from "../../lib/api";

export interface MyDriver {
  id: string;
  name: string;
  key: string;
  /** Race emails about this driver (on unless switched off; the account-wide switch comes first). */
  alerts: boolean;
}

export const MAX_DRIVERS = 20;

// ─── Names (the same rules as the server's sameDriver) ───────────────────────

export function driverKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

const wordsOf = (key: string) => key.split(" ").filter((w) => w.length > 1 || /\d/.test(w));

/** True when two names are one driver: accents, case and word order ignored; a middle name allowed. */
export function sameDriver(a: string, b: string): boolean {
  const ka = driverKey(a);
  const kb = driverKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const wa = wordsOf(ka);
  const wb = wordsOf(kb);
  if (wa.length < 2 || wb.length < 2) return false;
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return short.every((w) => long.includes(w));
}

/**
 * A short name from the timing ("Boehm", "K. Boehm") as the car's full one ("Kevin Boehm"), when
 * exactly one of the car's drivers fits (the server's expandDriverName).
 */
export function expandDriverName(name: string, carDrivers: string[]): string {
  const same = carDrivers.find((d) => sameDriver(d, name));
  if (same) return same;
  const key = driverKey(name).split(" ").filter(Boolean);
  const full = key.filter((w) => w.length > 1);
  const initials = key.filter((w) => w.length === 1);
  if (!full.length) return name;
  const fits = carDrivers.filter((d) => {
    const dw = driverKey(d).split(" ");
    return full.every((w) => dw.includes(w)) && initials.every((i) => dw.some((x) => x.startsWith(i)));
  });
  return fits.length === 1 ? fits[0] : name;
}

/** "Zach VEACH" → "Zach Veach"; mixed-case names are kept as written (as the server shows them). */
export function displayName(name: string): string {
  return /[a-z]/.test(name) && /[A-Z]/.test(name) && !/\b[A-Z]{3,}\b/.test(name)
    ? name
    : name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
}

// ─── The shared list ─────────────────────────────────────────────────────────

let drivers: MyDriver[] | null = null;
/** Whose list `drivers` is: another sign-in reads it again. */
let owner: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: MyDriver[]) => {
  drivers = next;
  emit();
};

/** Load the user's drivers (once per user); `force` reads them again. */
export function loadDrivers(userId: string, force = false): Promise<void> {
  if (owner !== userId) {
    owner = userId;
    drivers = null;
    loading = null;
  }
  if (loading && !force) return loading;
  loading = api
    .get<{ drivers: MyDriver[] }>("/me/drivers")
    .then((r) => {
      if (owner === userId) set(r.drivers);
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The signed-in user's followed drivers; null until loaded, and when signed out. */
export function useMyDrivers(userId: string | null | undefined): MyDriver[] | null {
  const list = useSyncExternalStore(subscribe, () => drivers);
  useEffect(() => {
    if (userId) void loadDrivers(userId);
  }, [userId]);
  return userId && owner === userId ? list : null;
}

export const followedAs = (list: MyDriver[] | null, name: string) => list?.find((d) => sameDriver(d.name, name)) ?? null;

export async function followDriver(name: string): Promise<{ driver: MyDriver; created: boolean }> {
  const r = await api.post<{ driver: MyDriver; created: boolean }>("/me/drivers", { name });
  if (drivers && !drivers.some((d) => d.id === r.driver.id)) set([...drivers, r.driver]);
  else if (!drivers && owner) await loadDrivers(owner, true);
  return r;
}

export async function unfollowDriver(id: string): Promise<void> {
  await api.delete<void>(`/me/drivers/${id}`);
  if (drivers) set(drivers.filter((d) => d.id !== id));
}

/** The order of the driver tabs (drag to reorder); the shared list follows it. */
export async function reorderDrivers(ids: string[]): Promise<MyDriver[]> {
  const r = await api.put<{ drivers: MyDriver[] }>("/me/drivers/order", { ids });
  if (drivers) set(r.drivers);
  return r.drivers;
}

export async function setDriverAlerts(id: string, alerts: boolean): Promise<MyDriver> {
  const r = await api.patch<{ driver: MyDriver }>(`/me/drivers/${id}`, { alerts });
  if (drivers) set(drivers.map((d) => (d.id === id ? r.driver : d)));
  return r.driver;
}

// ─── A follow asked for before signing up ────────────────────────────────────

const KEY = "racetrace.pendingDriverFollow";
const MAX_AGE_MS = 15 * 60 * 1000;

export function rememberPendingDriver(name: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ name, at: Date.now() }));
  } catch {
    // storage blocked: they can press Follow again after signing in
  }
}

/** A driver follow is waiting for the visitor to finish signing up (onboarding then skips asking). */
export function hasPendingDriver(now = Date.now()): boolean {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY) || "null") as { at?: unknown } | null;
    return !!p && typeof p.at === "number" && now - p.at <= MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** The pending driver follow, removed once read; null when none or too old. */
export function takePendingDriver(now = Date.now()): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const p = JSON.parse(raw) as { name?: unknown; at?: unknown };
    if (typeof p.at !== "number" || now - p.at > MAX_AGE_MS || typeof p.name !== "string") return null;
    return p.name;
  } catch {
    return null;
  }
}

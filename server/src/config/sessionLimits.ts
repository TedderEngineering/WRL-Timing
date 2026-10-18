/**
 * Where one account can stay signed in at once, across RaceTrace, Finding Grip and Setup Sheet
 * (they share one login): one phone and one tablet or computer. Signing in on another phone
 * signs out the earlier phone; the same for a tablet or computer. Admin accounts have no limit.
 *
 * The device kind comes from the browser's user agent at sign-in. iPads report themselves as a
 * Mac, so they count as a tablet or computer, which is where they belong.
 */
export type DeviceClass = "phone" | "computer" | "unknown";

/** At most this many sessions in all (one phone + one tablet or computer). */
export const MAX_SESSIONS = 2;

const PHONE_UA = /iPhone|iPod|Android.*Mobile|Mobile.*Firefox|Windows Phone|BlackBerry|BB10|Opera Mini|IEMobile|webOS/i;

export function deviceClassOf(userAgent: string | null | undefined): DeviceClass {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "unknown";
  return PHONE_UA.test(ua) ? "phone" : "computer";
}

/** Plain words for messages: "phone", "tablet or computer". */
export function deviceWord(c: DeviceClass): string {
  return c === "phone" ? "phone" : c === "computer" ? "tablet or computer" : "device";
}

export function sessionLimitApplies(role: string | null | undefined): boolean {
  return role !== "ADMIN";
}

/**
 * Which active sessions a new sign-in from `newClass` displaces: every session of the same kind,
 * then (oldest first, unknown kinds before known ones) whatever is still over MAX_SESSIONS - 1.
 */
export function sessionsToDisplace<T extends { id: string; userAgent: string | null; createdAt: Date }>(
  active: T[],
  newClass: DeviceClass
): string[] {
  const out = new Set<string>();
  if (newClass !== "unknown") {
    for (const s of active) if (deviceClassOf(s.userAgent) === newClass) out.add(s.id);
  }
  const rest = active
    .filter((s) => !out.has(s.id))
    .sort((a, b) => {
      const ua = Number(deviceClassOf(a.userAgent) !== "unknown") - Number(deviceClassOf(b.userAgent) !== "unknown");
      return ua || a.createdAt.getTime() - b.createdAt.getTime();
    });
  const excess = rest.length - (MAX_SESSIONS - 1);
  for (const s of rest.slice(0, Math.max(0, excess))) out.add(s.id);
  return [...out];
}

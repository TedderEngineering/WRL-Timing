/**
 * How many devices one account can be signed in on at once, across RaceTrace,
 * Finding Grip and Setup Sheet (they share one login). Signing in on one more
 * device signs out the oldest.
 *
 * Three for every plan, so a pit laptop, a phone and a tablet can all stay
 * signed in while account sharing is still capped.
 */
export const DEFAULT_SESSION_LIMIT = 3;

export const SESSION_LIMITS: Record<string, number> = {
  FREE: DEFAULT_SESSION_LIMIT,
  PRO: DEFAULT_SESSION_LIMIT,
  TEAM: DEFAULT_SESSION_LIMIT,
} as const;

export function getSessionLimit(plan: string | null | undefined): number {
  return SESSION_LIMITS[(plan ?? "FREE").toUpperCase()] ?? DEFAULT_SESSION_LIMIT;
}

export const SESSION_LIMITS: Record<string, number> = {
  FREE: 1,
  PRO: 1,
  TEAM: 2,
} as const;

export function getSessionLimit(plan: string | null | undefined): number {
  return SESSION_LIMITS[(plan ?? "FREE").toUpperCase()] ?? 1;
}

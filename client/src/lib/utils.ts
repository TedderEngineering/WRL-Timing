import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** User-like shape expected by access helpers (matches AuthContext User). */
interface AccessUser {
  role?: string;
  subscription?: { plan?: string };
}

/** True for PRO, TEAM, or ADMIN — use to gate any paid feature. */
export function hasFullAccess(user: AccessUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const plan = user.subscription?.plan;
  return plan === "PRO" || plan === "TEAM";
}

/** True for TEAM or ADMIN — use to gate Team-only features (strategy, lap times). */
export function hasTeamAccess(user: AccessUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return user.subscription?.plan === "TEAM";
}

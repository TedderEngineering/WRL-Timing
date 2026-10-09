/**
 * Finding Grip — per-user account: units, plan and the free-tier allowance.
 * Kept separate from the RaceTrace `subscriptions` row so that a subscription
 * to one product never unlocks the other.
 */
import type { GripAccount } from "@prisma/client";
import { prisma } from "../../models/prisma.js";

export const FREE_CALCULATION_LIMIT = 3;
const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export async function getOrCreateGripAccount(userId: string): Promise<GripAccount> {
  return prisma.gripAccount.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

/**
 * True when the account currently has paid access. Mirrors the RaceTrace
 * rules: canceled subscriptions keep access to the end of the paid period,
 * past-due subscriptions get a 7-day grace period.
 */
export function hasGripPro(
  account: Pick<GripAccount, "plan" | "status" | "currentPeriodEnd">,
  role: "USER" | "ADMIN",
  now: Date = new Date()
): boolean {
  if (role === "ADMIN") return true;
  if (account.plan !== "PRO") return false;

  switch (account.status) {
    case "ACTIVE":
    case "TRIALING":
      return true;
    case "CANCELED":
      return !!account.currentPeriodEnd && account.currentPeriodEnd > now;
    case "PAST_DUE":
      return (
        !!account.currentPeriodEnd &&
        now.getTime() <= account.currentPeriodEnd.getTime() + PAST_DUE_GRACE_MS
      );
    default:
      return false;
  }
}

export function serializeGripAccount(account: GripAccount, role: "USER" | "ADMIN") {
  const isPro = hasGripPro(account, role);
  return {
    plan: account.plan,
    status: account.status,
    isPro,
    units: account.units,
    currentPeriodEnd: account.currentPeriodEnd,
    cancelAtPeriodEnd: account.cancelAtPeriodEnd,
    calculationsUsed: account.calcCount,
    freeCalculationLimit: FREE_CALCULATION_LIMIT,
    freeCalculationsLeft: isPro
      ? null
      : Math.max(0, FREE_CALCULATION_LIMIT - account.calcCount),
  };
}

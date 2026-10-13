/**
 * Race access gating shared by GET /api/races/:id/chart-data and
 * GET /api/races/:id/package (moved out of routes/races.ts unchanged).
 */
import { prisma } from "../models/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import { canUserAccessRace } from "./races.js";

export interface Viewer {
  userId: string | null;
  role: string | null;
  /** Subscription plan; null for anonymous viewers and admins. */
  plan: string | null;
  signedIn: boolean;
}

export async function resolveViewer(user?: { userId: string; role: string } | null): Promise<Viewer> {
  if (!user) return { userId: null, role: null, plan: null, signedIn: false };
  if (user.role === "ADMIN") return { userId: user.userId, role: user.role, plan: null, signedIn: true };
  const sub = await prisma.subscription.findUnique({ where: { userId: user.userId } });
  return { userId: user.userId, role: user.role, plan: sub?.plan ?? "FREE", signedIn: true };
}

/** Throws the same 403s the chart-data endpoint has always returned. */
export async function assertRaceAccess(
  viewer: Viewer,
  race: { id: string; premium: boolean; createdAt: Date }
): Promise<void> {
  const access = await canUserAccessRace(race, viewer.plan, viewer.role);
  if (access.accessible) return;
  if (!viewer.signedIn) {
    throw new AppError(403, "Sign in to access this race.", "AUTH_REQUIRED");
  }
  if (access.reason === "available_soon") {
    throw new AppError(
      403,
      "This race will be available to free members shortly. Pro members get instant access.",
      "AVAILABLE_SOON"
    );
  }
  throw new AppError(403, "Upgrade to Pro or Team to access this race.", "SUBSCRIPTION_REQUIRED");
}

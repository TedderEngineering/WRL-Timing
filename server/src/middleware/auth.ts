import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "../utils/tokens.js";
import { prisma } from "../models/prisma.js";
import { AppError } from "./error-handler.js";

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload & {
        subscriptionPlan?: string;
        subscriptionStatus?: string;
      };
    }
  }
}

/**
 * Require a valid access token. Attaches user payload to req.user.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return next(new AppError(401, "Authentication required", "AUTH_REQUIRED"));
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    next(new AppError(401, "Invalid or expired token", "INVALID_TOKEN"));
  }
}

/**
 * Optionally attach user if a valid token is present, but don't require it.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.slice(7);
  try {
    req.user = verifyAccessToken(token);
  } catch {
    // Invalid token — just proceed without user
  }
  next();
}

/**
 * Require admin role. Must be placed after requireAuth.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new AppError(401, "Authentication required", "AUTH_REQUIRED"));
  }
  if (req.user.role !== "ADMIN") {
    return next(new AppError(403, "Admin access required", "ADMIN_REQUIRED"));
  }
  next();
}

/**
 * Require a minimum subscription tier. Must be placed after requireAuth.
 * Tier hierarchy: FREE < PRO < TEAM
 *
 * Usage: requireSubscription("PRO") — allows PRO and TEAM
 */
export function requireSubscription(minimumTier: "FREE" | "PRO" | "TEAM") {
  const tierLevel: Record<string, number> = { FREE: 0, PRO: 1, TEAM: 2 };

  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, "Authentication required", "AUTH_REQUIRED"));
    }

    // Admins bypass subscription checks
    if (req.user.role === "ADMIN") {
      return next();
    }

    try {
      const subscription = await prisma.subscription.findUnique({
        where: { userId: req.user.userId },
      });

      const plan = subscription?.plan ?? "FREE";
      const status = subscription?.status ?? "ACTIVE";

      // Attach to request for downstream use
      req.user.subscriptionPlan = plan;
      req.user.subscriptionStatus = status;

      // Check status
      if (status === "CANCELED") {
        // If canceled, check if still within period
        if (subscription?.currentPeriodEnd && subscription.currentPeriodEnd > new Date()) {
          // Still within paid period — allow access
        } else {
          // Expired — treat as free
          if (tierLevel["FREE"] < tierLevel[minimumTier]) {
            return next(
              new AppError(403, "Your subscription has expired. Please renew to access this content.", "SUBSCRIPTION_EXPIRED")
            );
          }
          return next();
        }
      }

      if (status === "PAST_DUE") {
        // Grace period: allow access for 7 days past the period end
        const gracePeriodEnd = subscription?.currentPeriodEnd
          ? new Date(subscription.currentPeriodEnd.getTime() + 7 * 24 * 60 * 60 * 1000)
          : new Date();
        if (new Date() > gracePeriodEnd) {
          return next(
            new AppError(403, "Payment past due. Please update your payment method.", "PAYMENT_PAST_DUE")
          );
        }
      }

      // Check tier level
      if (tierLevel[plan] < tierLevel[minimumTier]) {
        return next(
          new AppError(
            403,
            `This requires a ${minimumTier} subscription or higher`,
            "INSUFFICIENT_TIER"
          )
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

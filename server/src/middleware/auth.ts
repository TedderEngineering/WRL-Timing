import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "../utils/tokens.js";
import { prisma } from "../models/prisma.js";
import { AppError } from "./error-handler.js";
import { authenticateApiToken, hasScope, isApiTokenString } from "../services/api-tokens.js";
import { freeMode } from "../lib/free-mode.js";

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload & {
        subscriptionPlan?: string;
        subscriptionStatus?: string;
      };
      /** Set when the request authenticated with a machine API token (rt_…). */
      apiToken?: { id: string; name: string; prefix: string; scopes: string[] };
    }
  }
}

/**
 * Require a valid access token. Attaches user payload to req.user.
 *
 * Also accepts a machine API token (`Authorization: Bearer rt_…`, G4 intake).
 * The request then acts as the admin who created the token and carries
 * `req.apiToken`; requireAdmin checks its scope.
 */
/**
 * The only routes a machine API token may call (RaceTrace 2.0, Stage 3).
 * A token acts as the admin who made it, so without this list a leaked
 * token could delete races, manage users or publish. It may only pull
 * races in, upload a package as a DRAFT and read packages back.
 * Publishing, rollback, reject and the per-race override stay with a
 * signed-in person.
 */
const API_TOKEN_ROUTES: ReadonlyArray<[method: string, path: RegExp]> = [
  ["GET", /^\/api\/admin\/intake(\/.*)?$/],
  ["POST", /^\/api\/admin\/intake(\/.*)?$/],
  ["GET", /^\/api\/admin\/races\/[^/]+\/packages\/?$/],
  ["GET", /^\/api\/admin\/races\/[^/]+\/packages\/\d+\/?$/],
  ["POST", /^\/api\/admin\/races\/[^/]+\/packages\/?$/],
];

export function apiTokenMayCall(method: string, originalUrl: string): boolean {
  const path = originalUrl.split("?")[0].replace(/\/{2,}/g, "/");
  if (path.split("/").some((seg) => seg === ".." || seg === ".")) return false;
  const m = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  return API_TOKEN_ROUTES.some(([rm, re]) => rm === m && re.test(path));
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return next(new AppError(401, "Authentication required", "AUTH_REQUIRED"));
  }

  const token = authHeader.slice(7);
  if (isApiTokenString(token)) {
    if (!apiTokenMayCall(req.method, req.originalUrl ?? req.url)) {
      return next(
        new AppError(403, "API tokens may only call the intake and draft-package endpoints; sign in for anything else", "TOKEN_ROUTE_NOT_ALLOWED")
      );
    }
    authenticateApiToken(token)
      .then((r) => {
        if (!r.ok) return next(new AppError(401, r.message, r.code));
        req.user = r.auth.user;
        req.apiToken = r.auth.token;
        next();
      })
      .catch(next);
    return;
  }
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
  if (req.apiToken && !hasScope(req.apiToken.scopes, "intake")) {
    return next(new AppError(403, "This API token does not have the intake scope", "TOKEN_SCOPE_REQUIRED"));
  }
  if (req.user.role !== "ADMIN") {
    return next(new AppError(403, "Admin access required", "ADMIN_REQUIRED"));
  }
  next();
}

/**
 * Refuse machine API tokens: for routes only a signed-in person may use
 * (creating and revoking tokens). Place after requireAuth.
 */
export function rejectApiToken(req: Request, _res: Response, next: NextFunction) {
  if (req.apiToken) {
    return next(new AppError(403, "API tokens cannot manage API tokens; sign in to the admin page", "SESSION_REQUIRED"));
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

    // Admins bypass subscription checks; while RaceTrace is free, so does everyone.
    if (req.user.role === "ADMIN" || freeMode()) {
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

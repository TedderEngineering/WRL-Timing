/**
 * GET  /api/site-config        free mode and how support is offered (public)
 * POST /api/support/checkout   start a one-off Stripe Checkout for N coffees
 *                              (for RaceTrace, or Finding Grip with site: "grip")
 */
import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env.js";
import { optionalAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/error-handler.js";
import { freeMode } from "../lib/free-mode.js";
import { gripIsFree } from "../services/grip/account.js";
import { gripPageUrl } from "../services/site.js";
import {
  SUPPORT_OPTIONS,
  checkoutEnabled,
  checkoutParams,
  coffeeCents,
  paymentLinkUrl,
  safeReturnPath,
} from "../support/support.js";

export const siteConfigRouter = Router();
export const supportRouter = Router();

siteConfigRouter.get("/", (_req: Request, res: Response) => {
  const checkout = checkoutEnabled();
  const link = paymentLinkUrl();
  res.set("Cache-Control", "public, max-age=60");
  res.json({
    freeMode: freeMode(),
    support: {
      enabled: checkout || !!link,
      checkout,
      paymentLinkUrl: checkout ? null : link,
      coffeeCents: coffeeCents(),
      options: SUPPORT_OPTIONS,
    },
  });
});

const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: "Too many checkout attempts. Please try again shortly.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

const bodySchema = z.object({
  coffees: z.union([z.literal(1), z.literal(3), z.literal(20)]),
  returnPath: z.string().max(300).optional(),
  // Finding Grip sends "grip" so the coffee is named for it and the supporter returns there.
  site: z.enum(["racetrace", "grip"]).optional(),
});

supportRouter.post("/checkout", checkoutLimiter, optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!checkoutEnabled()) {
      throw new AppError(404, "Support checkout is not set up", "SUPPORT_UNAVAILABLE");
    }
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Choose 1, 3 or 20 coffees", "VALIDATION_ERROR");
    const site = parsed.data.site ?? "racetrace";
    // No coffee asks while Finding Grip is charging for Pro.
    if (site === "grip" && !gripIsFree()) {
      throw new AppError(404, "Support checkout is not set up", "SUPPORT_UNAVAILABLE");
    }
    const { stripe } = await import("../lib/stripe.js");
    const session = await stripe.checkout.sessions.create(
      checkoutParams({
        coffees: parsed.data.coffees,
        returnPath: safeReturnPath(parsed.data.returnPath),
        userId: req.user?.userId ?? null,
        frontendUrl: site === "grip" ? gripPageUrl("") : env.FRONTEND_URL,
        site,
      })
    );
    if (!session.url) throw new AppError(502, "Stripe did not return a checkout page", "STRIPE_NO_URL");
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

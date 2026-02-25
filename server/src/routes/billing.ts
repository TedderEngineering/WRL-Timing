import { Router, Request, Response, NextFunction } from "express";
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { stripe } from "../lib/stripe.js";
import { env } from "../config/env.js";
import * as billingSvc from "../services/billing.js";

export const billingRouter = Router();

// ─── Webhook (must use raw body, registered before JSON parser) ─────────────

billingRouter.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response, next: NextFunction) => {
    const sig = req.headers["stripe-signature"];
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        env.STRIPE_WEBHOOK_SECRET
      );
      await billingSvc.handleWebhookEvent(event);
      res.json({ received: true });
    } catch (err: any) {
      console.error("Webhook error:", err.message);
      res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }
  }
);

// ─── Create Checkout Session ────────────────────────────────────────────────

billingRouter.post(
  "/create-checkout-session",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tier = req.body?.tier;
      if (tier !== "PRO" && tier !== "TEAM") {
        res.status(400).json({ error: "Invalid tier. Must be PRO or TEAM.", code: "INVALID_TIER" });
        return;
      }
      const url = await billingSvc.createCheckoutSession(req.user!.userId, tier);
      res.json({ url });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Create Portal Session ──────────────────────────────────────────────────

billingRouter.post(
  "/create-portal-session",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const url = await billingSvc.createPortalSession(req.user!.userId);
      res.json({ url });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Status (public) ────────────────────────────────────────────────────────

billingRouter.get("/status", (_req, res) => {
  res.json({ message: "Billing API active" });
});

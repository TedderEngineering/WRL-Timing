import { Router, Request, Response, NextFunction } from "express";
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { stripe } from "../lib/stripe.js";
import { env } from "../config/env.js";
import { prisma } from "../models/prisma.js";
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
  async (req: Request, res: Response) => {
    try {
      const { priceId } = req.body as { priceId: string };
      if (!priceId) {
        res.status(400).json({ error: "priceId is required" });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        include: { subscription: true },
      });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Get or create Stripe customer
      let customerId = user.subscription?.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: user.id },
        });
        customerId = customer.id;

        await prisma.subscription.upsert({
          where: { userId: user.id },
          create: { userId: user.id, stripeCustomerId: customerId, plan: "FREE", status: "ACTIVE" },
          update: { stripeCustomerId: customerId },
        });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.FRONTEND_URL}/pricing?canceled=true`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("Checkout session error:", err.message);
      res.status(500).json({ error: err.message });
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

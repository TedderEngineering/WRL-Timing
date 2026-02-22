import { Router } from "express";

export const billingRouter = Router();

// Phase 6: Billing endpoints
// POST /api/billing/create-checkout-session  — create Stripe checkout
// POST /api/billing/create-portal-session    — create Stripe customer portal
// POST /api/billing/webhook                  — Stripe webhook handler

billingRouter.get("/status", (_req, res) => {
  res.json({ message: "Billing routes placeholder — implement in Phase 6" });
});

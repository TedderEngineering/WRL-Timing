import Stripe from "stripe";
import { env } from "../config/env.js";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-02-24.acacia",
  typescript: true,
});

export const TIER_PRICE_MAP: Record<string, string | undefined> = {
  PRO: env.STRIPE_PRICE_PRO_ANNUAL,
  TEAM: env.STRIPE_PRICE_TEAM_ANNUAL,
};

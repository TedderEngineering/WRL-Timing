/**
 * Optional support for RaceTrace ("Buy me a coffee", October 2026).
 *
 * A one-off Stripe Checkout payment for N coffees, on the Stripe account the
 * site already uses. It never creates a subscription, so the billing webhook
 * (which only acts on mode "subscription") leaves it alone.
 */
import { env } from "../config/env.js";

/** The amounts offered: 1 coffee, 3 (a race weekend), 10 (a season). */
export const SUPPORT_OPTIONS = [1, 3, 10] as const;
export type SupportCoffees = (typeof SUPPORT_OPTIONS)[number];

export function coffeeCents(): number {
  const raw = Number(process.env.SUPPORT_COFFEE_CENTS ?? env.SUPPORT_COFFEE_CENTS ?? 500);
  return Number.isInteger(raw) && raw >= 100 && raw <= 10000 ? raw : 500;
}

export function stripeConfigured(): boolean {
  const key = process.env.STRIPE_SECRET_KEY ?? env.STRIPE_SECRET_KEY ?? "";
  return /^sk_(live|test)_/.test(key) && !key.endsWith("placeholder");
}

export function checkoutEnabled(): boolean {
  return (process.env.SUPPORT_CHECKOUT ?? env.SUPPORT_CHECKOUT ?? "on") !== "off" && stripeConfigured();
}

export function paymentLinkUrl(): string | null {
  const v = process.env.SUPPORT_PAYMENT_LINK_URL ?? env.SUPPORT_PAYMENT_LINK_URL;
  return v && /^https:\/\//.test(v) ? v : null;
}

/** Only same-site paths may be the page a supporter returns to. */
export function safeReturnPath(p: unknown): string {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//") || p.includes("\\")) return "/dashboard";
  return p.slice(0, 300);
}

export function checkoutParams(args: { coffees: SupportCoffees; returnPath: string; userId: string | null; frontendUrl: string }) {
  const base = args.frontendUrl.replace(/\/+$/, "");
  return {
    mode: "payment" as const,
    submit_type: "donate" as const,
    line_items: [
      {
        quantity: args.coffees,
        price_data: {
          currency: "usd",
          unit_amount: coffeeCents(),
          product_data: {
            name: "A coffee for RaceTrace",
            description: "Optional support. RaceTrace stays free with no ads.",
          },
        },
      },
    ],
    success_url: `${base}/support/thanks?session_id={CHECKOUT_SESSION_ID}&return=${encodeURIComponent(args.returnPath)}`,
    cancel_url: `${base}${args.returnPath}`,
    metadata: { kind: "racetrace_support", coffees: String(args.coffees), ...(args.userId ? { userId: args.userId } : {}) },
  };
}

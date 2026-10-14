/**
 * Optional support for RaceTrace and Finding Grip ("Buy me a coffee", October 2026).
 *
 * A one-off Stripe Checkout payment for N coffees, on the Stripe account the
 * site already uses. It never creates a subscription, so the billing webhook
 * (which only acts on mode "subscription") leaves it alone.
 */
import { env } from "../config/env.js";

/** The amounts offered: 1 coffee, 3 (a race weekend), 20 (a full season, $100 at the default price). */
export const SUPPORT_OPTIONS = [1, 3, 20] as const;
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

/** Which site the coffee is for. Each has its own name in Stripe and its own metadata kind. */
export type SupportSite = "racetrace" | "grip";

const SITE_PRODUCT: Record<SupportSite, { name: string; description: string; kind: string }> = {
  racetrace: {
    name: "A coffee for RaceTrace",
    description: "Optional support. RaceTrace stays free with no ads.",
    kind: "racetrace_support",
  },
  grip: {
    name: "A coffee for Finding Grip",
    description: "Optional support. Finding Grip stays free with no ads.",
    kind: "findinggrip_support",
  },
};

/**
 * `frontendUrl` is the base address of the site the supporter returns to. It always comes
 * from configuration (FRONTEND_URL, or Finding Grip's address), never from the request.
 */
export function checkoutParams(args: {
  coffees: SupportCoffees;
  returnPath: string;
  userId: string | null;
  frontendUrl: string;
  site?: SupportSite;
}) {
  const base = args.frontendUrl.replace(/\/+$/, "");
  const product = SITE_PRODUCT[args.site ?? "racetrace"];
  return {
    mode: "payment" as const,
    submit_type: "donate" as const,
    line_items: [
      {
        quantity: args.coffees,
        price_data: {
          currency: "usd",
          unit_amount: coffeeCents(),
          product_data: { name: product.name, description: product.description },
        },
      },
    ],
    // `coffees` lets the thank-you page count the payment (analytics event coffee_paid).
    success_url: `${base}/support/thanks?session_id={CHECKOUT_SESSION_ID}&coffees=${args.coffees}&return=${encodeURIComponent(args.returnPath)}`,
    cancel_url: `${base}${args.returnPath}`,
    metadata: { kind: product.kind, coffees: String(args.coffees), ...(args.userId ? { userId: args.userId } : {}) },
  };
}

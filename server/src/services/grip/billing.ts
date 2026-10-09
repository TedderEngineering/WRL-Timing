/**
 * Finding Grip — Stripe billing. Uses the same Stripe account, the same
 * customer record and the same billing portal as RaceTrace. Only the price
 * and the table the subscription state is written to differ.
 *
 * State is never taken from a single webhook payload. Every Finding Grip
 * event triggers a re-read of the customer's Finding Grip subscriptions from
 * Stripe and the best one is written, so duplicate subscriptions, stale events
 * and out-of-order delivery cannot leave a paying customer on Free.
 */
import type Stripe from "stripe";
import { stripe } from "../../lib/stripe.js";
import { prisma } from "../../models/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error-handler.js";

export const GRIP_PRODUCT = "FINDING_GRIP";

/** Price ids that mean "Finding Grip Pro". The first is the one sold at checkout. */
export function gripPriceIds(): string[] {
  return (env.STRIPE_GRIP_PRO_PRICE_ID ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** True when a Stripe subscription belongs to Finding Grip rather than RaceTrace. */
export function isGripSubscription(
  sub: Pick<Stripe.Subscription, "metadata" | "items">
): boolean {
  if (sub.metadata?.product === GRIP_PRODUCT) return true;
  const prices = gripPriceIds();
  if (prices.length === 0) return false;
  return (
    sub.items?.data?.some((item) => !!item.price?.id && prices.includes(item.price.id)) ??
    false
  );
}

const customerIdOf = (c: string | { id: string } | null | undefined): string | null =>
  !c ? null : typeof c === "string" ? c : c.id;

// ─── Reading invoices across Stripe API versions ─────────────────────────────
// Webhook payloads follow the endpoint's API version, not the SDK's. Newer
// versions moved the subscription and price references, so read both shapes.

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as unknown as Loose;
  const ref = inv.subscription ?? inv.parent?.subscription_details?.subscription;
  return customerIdOf(ref);
}

function invoiceIsForGrip(invoice: Stripe.Invoice): boolean {
  const inv = invoice as unknown as Loose;
  const metadata =
    inv.subscription_details?.metadata ?? inv.parent?.subscription_details?.metadata;
  if (metadata?.product === GRIP_PRODUCT) return true;

  const prices = gripPriceIds();
  if (prices.length === 0) return false;
  const lines: Loose[] = inv.lines?.data ?? [];
  return lines.some((line) => {
    const priceRef = line.price?.id ?? line.pricing?.price_details?.price;
    const priceId = customerIdOf(priceRef);
    return !!priceId && prices.includes(priceId);
  });
}

// ─── Customer ────────────────────────────────────────────────────────────────

async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });
  if (!user) throw new AppError(404, "User not found", "USER_NOT_FOUND");

  if (user.subscription?.stripeCustomerId) return user.subscription.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { userId },
  });

  // The Stripe customer is shared across products and stored on the existing
  // subscriptions row (as RaceTrace does), with RaceTrace left on FREE.
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, stripeCustomerId: customer.id, plan: "FREE", status: "ACTIVE" },
    update: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

async function userIdForCustomer(
  customerId: string,
  fallback?: string | null
): Promise<string | null> {
  const row = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  });
  return row?.userId ?? fallback ?? null;
}

// ─── Reconcile from Stripe ───────────────────────────────────────────────────

function mapStatus(status: Stripe.Subscription.Status) {
  switch (status) {
    case "active":
    case "paused":
      return "ACTIVE" as const;
    case "past_due":
    case "unpaid":
      return "PAST_DUE" as const;
    case "canceled":
      return "CANCELED" as const;
    case "trialing":
      return "TRIALING" as const;
    default:
      return "INCOMPLETE" as const;
  }
}

/** Higher is better. A paid subscription always beats an ended or unpaid one. */
function rank(sub: Stripe.Subscription): number {
  switch (sub.status) {
    case "active":
    case "trialing":
    case "paused":
      return 3;
    case "past_due":
    case "unpaid":
      return 2;
    case "canceled":
      return 1;
    default:
      return 0;
  }
}

export function pickBestGripSubscription(
  subs: Stripe.Subscription[]
): Stripe.Subscription | null {
  const grip = subs.filter(isGripSubscription);
  if (grip.length === 0) return null;
  return grip.sort(
    (a, b) =>
      rank(b) - rank(a) || (b.current_period_end ?? 0) - (a.current_period_end ?? 0)
  )[0];
}

/**
 * Re-read the customer's Finding Grip subscriptions from Stripe and store the
 * best one in grip_accounts. `hint` is the subscription from the webhook, used
 * only to find the user when the customer row is not linked yet.
 */
export async function reconcileGripSubscription(
  customerId: string,
  hint?: Stripe.Subscription
): Promise<void> {
  const userId = await userIdForCustomer(customerId, hint?.metadata?.userId);
  if (!userId) {
    console.error(`Finding Grip: Stripe customer ${customerId} has no matching user`);
    return;
  }

  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  const best = pickBestGripSubscription(listed.data);

  if (!best) {
    // No Finding Grip subscription at all: make sure the account is Free.
    await prisma.gripAccount.updateMany({
      where: { userId, plan: "PRO" },
      data: { plan: "FREE", status: "CANCELED", cancelAtPeriodEnd: false },
    });
    return;
  }

  const status = mapStatus(best.status);
  const data = {
    stripeSubscriptionId: best.id,
    // Pro only while Stripe says the subscription is live. "canceled" in
    // Stripe means it has ended (a scheduled cancellation stays "active"
    // with cancel_at_period_end until the period is over).
    plan:
      status === "CANCELED" || status === "INCOMPLETE"
        ? ("FREE" as const)
        : ("PRO" as const),
    status,
    currentPeriodStart: new Date(best.current_period_start * 1000),
    currentPeriodEnd: new Date(best.current_period_end * 1000),
    cancelAtPeriodEnd: best.cancel_at_period_end,
  };

  await prisma.gripAccount.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

/** Webhook entry point for customer.subscription.* events on a Finding Grip subscription. */
export async function syncGripSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(sub.customer);
  if (customerId) await reconcileGripSubscription(customerId, sub);
}

/**
 * Apply an invoice event if (and only if) the invoice is for Finding Grip.
 * Returns true when it was handled here, so the caller skips the RaceTrace
 * handling.
 */
export async function applyGripInvoice(invoice: Stripe.Invoice): Promise<boolean> {
  const subId = invoiceSubscriptionId(invoice);
  const known = subId
    ? await prisma.gripAccount.findUnique({
        where: { stripeSubscriptionId: subId },
        select: { userId: true },
      })
    : null;

  if (!known && !invoiceIsForGrip(invoice)) return false;

  const customerId = customerIdOf(invoice.customer);
  if (customerId) await reconcileGripSubscription(customerId);
  return true;
}

// ─── Checkout and portal ─────────────────────────────────────────────────────

export async function createGripCheckoutSession(userId: string): Promise<string> {
  const priceId = gripPriceIds()[0];
  if (!priceId) {
    throw new AppError(
      503,
      "Finding Grip Pro is not on sale yet",
      "GRIP_PRICE_NOT_CONFIGURED"
    );
  }

  const customerId = await getOrCreateStripeCustomer(userId);

  // Guard against a second subscription (two tabs, or a webhook that has not
  // landed yet): ask Stripe, not our own table.
  const existing = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  const live = pickBestGripSubscription(existing.data);
  if (live && rank(live) >= 2) {
    await reconcileGripSubscription(customerId);
    throw new AppError(409, "You already have Finding Grip Pro", "ALREADY_SUBSCRIBED");
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.FRONTEND_URL}/grip/settings?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.FRONTEND_URL}/grip/pricing?canceled=true`,
    metadata: { userId, product: GRIP_PRODUCT },
    subscription_data: { metadata: { userId, product: GRIP_PRODUCT } },
  });

  if (!session.url) {
    throw new AppError(500, "Failed to create checkout session", "CHECKOUT_FAILED");
  }
  return session.url;
}

export async function createGripPortalSession(userId: string): Promise<string> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription?.stripeCustomerId) {
    throw new AppError(400, "No billing account found", "NO_BILLING_ACCOUNT");
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${env.FRONTEND_URL}/grip/settings`,
  });
  return session.url;
}

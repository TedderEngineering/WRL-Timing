/**
 * Finding Grip — Stripe billing. Uses the same Stripe account, the same
 * customer record and the same billing portal as RaceTrace. Only the price
 * and the table the subscription state is written to differ.
 */
import type Stripe from "stripe";
import { stripe } from "../../lib/stripe.js";
import { prisma } from "../../models/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error-handler.js";

export const GRIP_PRODUCT = "FINDING_GRIP";

/** True when a Stripe subscription belongs to Finding Grip rather than RaceTrace. */
export function isGripSubscription(
  sub: Pick<Stripe.Subscription, "metadata" | "items">
): boolean {
  if (sub.metadata?.product === GRIP_PRODUCT) return true;
  const gripPrice = env.STRIPE_GRIP_PRO_PRICE_ID;
  if (!gripPrice) return false;
  return sub.items?.data?.some((item) => item.price?.id === gripPrice) ?? false;
}

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

export async function createGripCheckoutSession(userId: string): Promise<string> {
  const priceId = env.STRIPE_GRIP_PRO_PRICE_ID;
  if (!priceId) {
    throw new AppError(
      503,
      "Finding Grip Pro is not on sale yet",
      "GRIP_PRICE_NOT_CONFIGURED"
    );
  }

  const customerId = await getOrCreateStripeCustomer(userId);

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
    case "incomplete":
    case "incomplete_expired":
      return "INCOMPLETE" as const;
    default:
      return "ACTIVE" as const;
  }
}

async function resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
  if (sub.metadata?.userId) return sub.metadata.userId;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const row = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  });
  return row?.userId ?? null;
}

/** Write a Finding Grip subscription's state to grip_accounts. */
export async function syncGripSubscription(sub: Stripe.Subscription): Promise<void> {
  const userId = await resolveUserId(sub);
  if (!userId) {
    console.error(`Finding Grip subscription ${sub.id} has no matching user`);
    return;
  }

  const status = mapStatus(sub.status);
  const data = {
    stripeSubscriptionId: sub.id,
    // An incomplete checkout has not been paid for; do not grant Pro.
    plan: status === "INCOMPLETE" ? ("FREE" as const) : ("PRO" as const),
    status,
    currentPeriodStart: new Date(sub.current_period_start * 1000),
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };

  await prisma.gripAccount.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

/** Subscription ended in Stripe: drop to Free. */
export async function endGripSubscription(sub: Stripe.Subscription): Promise<void> {
  await prisma.gripAccount.updateMany({
    where: { stripeSubscriptionId: sub.id },
    data: { plan: "FREE", status: "CANCELED", cancelAtPeriodEnd: false },
  });
}

/**
 * Apply an invoice event if (and only if) the invoice is for a Finding Grip
 * subscription. Returns true when it was handled here, so the caller can skip
 * the RaceTrace handling.
 */
export async function applyGripInvoice(
  invoice: Stripe.Invoice,
  outcome: "paid" | "payment_failed"
): Promise<boolean> {
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
  if (!subId) return false;

  const account = await prisma.gripAccount.findUnique({
    where: { stripeSubscriptionId: subId },
    select: { userId: true },
  });
  if (!account) {
    // The invoice can arrive before the subscription has been synced. If it is
    // for the Finding Grip price, claim it so it is not applied to RaceTrace;
    // the subscription events carry the same period and status.
    const gripPrice = env.STRIPE_GRIP_PRO_PRICE_ID;
    return (
      !!gripPrice &&
      (invoice.lines?.data?.some((line) => line.price?.id === gripPrice) ?? false)
    );
  }

  if (outcome === "payment_failed") {
    await prisma.gripAccount.update({
      where: { userId: account.userId },
      data: { status: "PAST_DUE" },
    });
    return true;
  }

  const period = invoice.lines?.data?.[0]?.period;
  await prisma.gripAccount.update({
    where: { userId: account.userId },
    data: {
      status: "ACTIVE",
      ...(period
        ? {
            currentPeriodStart: new Date(period.start * 1000),
            currentPeriodEnd: new Date(period.end * 1000),
          }
        : {}),
    },
  });
  return true;
}

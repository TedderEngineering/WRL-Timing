import Stripe from "stripe";
import { stripe, TIER_PRICE_MAP } from "../lib/stripe.js";
import { prisma } from "../models/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../middleware/error-handler.js";

// ─── Create Checkout Session ────────────────────────────────────────────────

export async function createCheckoutSession(
  userId: string,
  tier: "PRO" | "TEAM"
): Promise<string> {
  const priceId = TIER_PRICE_MAP[tier];
  if (!priceId) {
    throw new AppError(400, `No price configured for tier: ${tier}`, "INVALID_TIER");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });
  if (!user) throw new AppError(404, "User not found", "USER_NOT_FOUND");

  // Get or create Stripe customer
  let customerId = user.subscription?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId },
    });
    customerId = customer.id;

    // Upsert subscription record with customer ID
    await prisma.subscription.upsert({
      where: { userId },
      create: { userId, stripeCustomerId: customerId, plan: "FREE", status: "ACTIVE" },
      update: { stripeCustomerId: customerId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.FRONTEND_URL}/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.FRONTEND_URL}/pricing`,
    subscription_data: {
      metadata: { userId, tier },
    },
  });

  if (!session.url) {
    throw new AppError(500, "Failed to create checkout session", "CHECKOUT_FAILED");
  }
  return session.url;
}

// ─── Create Portal Session ──────────────────────────────────────────────────

export async function createPortalSession(userId: string): Promise<string> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!subscription?.stripeCustomerId) {
    throw new AppError(400, "No billing account found", "NO_BILLING_ACCOUNT");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${env.FRONTEND_URL}/settings/billing`,
  });

  return session.url;
}

// ─── Handle Webhook Event ───────────────────────────────────────────────────

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || !session.subscription) break;

      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (!customerId) break;

      // Find user by metadata or customer email
      const userId = session.metadata?.userId
        || (session.customer_email
          ? (await prisma.user.findUnique({ where: { email: session.customer_email }, select: { id: true } }))?.id
          : undefined);

      if (userId) {
        // Ensure subscription record exists with stripeCustomerId
        await prisma.subscription.upsert({
          where: { userId },
          create: { userId, stripeCustomerId: customerId, plan: "FREE", status: "ACTIVE" },
          update: { stripeCustomerId: customerId },
        });
      }

      // Retrieve and sync the full subscription object
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      const sub = await stripe.subscriptions.retrieve(subId);
      await syncSubscription(sub);
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscription(sub);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      await prisma.subscription.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          plan: "FREE",
          status: "CANCELED",
          cancelAtPeriodEnd: false,
        },
      });
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (customerId && invoice.lines?.data?.[0]?.period) {
        const period = invoice.lines.data[0].period;
        await prisma.subscription.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            status: "ACTIVE",
            currentPeriodStart: new Date(period.start * 1000),
            currentPeriodEnd: new Date(period.end * 1000),
          },
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (customerId) {
        await prisma.subscription.updateMany({
          where: { stripeCustomerId: customerId },
          data: { status: "PAST_DUE" },
        });
      }
      break;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const tier = (sub.metadata?.tier as "PRO" | "TEAM") || inferTierFromPrice(sub);
  const plan = tier === "PRO" || tier === "TEAM" ? tier : "PRO";

  await prisma.subscription.updateMany({
    where: { stripeCustomerId: customerId },
    data: {
      stripeSubscriptionId: sub.id,
      plan,
      status: mapStripeStatus(sub.status),
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  });
}

function inferTierFromPrice(sub: Stripe.Subscription): string {
  const priceId = sub.items.data[0]?.price?.id;
  if (!priceId) return "PRO";
  for (const [tier, id] of Object.entries(TIER_PRICE_MAP)) {
    if (id === priceId) return tier;
  }
  return "PRO";
}

function mapStripeStatus(status: Stripe.Subscription.Status): "ACTIVE" | "PAST_DUE" | "CANCELED" | "TRIALING" | "INCOMPLETE" {
  switch (status) {
    case "active": return "ACTIVE";
    case "past_due": return "PAST_DUE";
    case "canceled": return "CANCELED";
    case "trialing": return "TRIALING";
    case "incomplete":
    case "incomplete_expired": return "INCOMPLETE";
    case "unpaid": return "PAST_DUE";
    case "paused": return "ACTIVE";
    default: return "ACTIVE";
  }
}

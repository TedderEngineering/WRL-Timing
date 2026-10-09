import { describe, it, expect, vi, beforeEach } from "vitest";

// Finding Grip and RaceTrace share one Stripe customer. These tests pin down
// that a webhook for one product never changes the other product's plan.

const db = vi.hoisted(() => ({
  subscription: { updateMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn() },
  gripAccount: {
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  user: { findUnique: vi.fn() },
}));

vi.mock("../../models/prisma.js", () => ({ prisma: db }));
vi.mock("../../config/env.js", () => ({
  env: { STRIPE_GRIP_PRO_PRICE_ID: "price_grip", FRONTEND_URL: "http://localhost:5173" },
}));
vi.mock("../../lib/stripe.js", () => ({
  stripe: { subscriptions: { retrieve: vi.fn() } },
  TIER_PRICE_MAP: { PRO: "price_rt_pro", TEAM: "price_rt_team" },
}));

import { handleWebhookEvent } from "../billing.js";

const sub = (priceId: string, extra: Record<string, unknown> = {}) => ({
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  metadata: {},
  items: { data: [{ price: { id: priceId } }] },
  current_period_start: 1_760_000_000,
  current_period_end: 1_791_536_000,
  cancel_at_period_end: false,
  ...extra,
});

const event = (type: string, object: unknown) => ({ type, data: { object } }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  db.subscription.findUnique.mockResolvedValue({ userId: "user_1" });
  db.gripAccount.findUnique.mockResolvedValue(null);
});

describe("subscription events", () => {
  it("writes a Finding Grip subscription to grip_accounts only", async () => {
    await handleWebhookEvent(event("customer.subscription.updated", sub("price_grip")));

    expect(db.gripAccount.upsert).toHaveBeenCalledTimes(1);
    const arg = db.gripAccount.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: "user_1" });
    expect(arg.update).toMatchObject({
      plan: "PRO",
      status: "ACTIVE",
      stripeSubscriptionId: "sub_1",
    });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("recognises Finding Grip by metadata even if the price id changes", async () => {
    await handleWebhookEvent(
      event(
        "customer.subscription.created",
        sub("price_new", { metadata: { product: "FINDING_GRIP", userId: "user_9" } })
      )
    );
    expect(db.gripAccount.upsert.mock.calls[0][0].where).toEqual({ userId: "user_9" });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("does not grant Pro for an incomplete checkout", async () => {
    await handleWebhookEvent(
      event("customer.subscription.created", sub("price_grip", { status: "incomplete" }))
    );
    expect(db.gripAccount.upsert.mock.calls[0][0].update).toMatchObject({
      plan: "FREE",
      status: "INCOMPLETE",
    });
  });

  it("leaves RaceTrace subscriptions on the existing path", async () => {
    await handleWebhookEvent(
      event("customer.subscription.updated", sub("price_rt_team"))
    );

    expect(db.subscription.updateMany).toHaveBeenCalledTimes(1);
    expect(db.subscription.updateMany.mock.calls[0][0]).toMatchObject({
      where: { stripeCustomerId: "cus_1" },
      data: { plan: "TEAM", status: "ACTIVE" },
    });
    expect(db.gripAccount.upsert).not.toHaveBeenCalled();
  });

  it("cancelling Finding Grip does not cancel RaceTrace", async () => {
    await handleWebhookEvent(event("customer.subscription.deleted", sub("price_grip")));

    expect(db.gripAccount.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: "sub_1" },
      data: { plan: "FREE", status: "CANCELED", cancelAtPeriodEnd: false },
    });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("cancelling RaceTrace does not touch Finding Grip", async () => {
    await handleWebhookEvent(event("customer.subscription.deleted", sub("price_rt_pro")));

    expect(db.subscription.updateMany).toHaveBeenCalledTimes(1);
    expect(db.gripAccount.updateMany).not.toHaveBeenCalled();
  });
});

describe("invoice events", () => {
  const invoice = (priceId: string) => ({
    customer: "cus_1",
    subscription: "sub_1",
    lines: {
      data: [
        { price: { id: priceId }, period: { start: 1_760_000_000, end: 1_791_536_000 } },
      ],
    },
  });

  it("applies a paid Finding Grip invoice to grip_accounts only", async () => {
    db.gripAccount.findUnique.mockResolvedValue({ userId: "user_1" });
    await handleWebhookEvent(event("invoice.paid", invoice("price_grip")));

    expect(db.gripAccount.update).toHaveBeenCalledTimes(1);
    expect(db.gripAccount.update.mock.calls[0][0].data).toMatchObject({
      status: "ACTIVE",
    });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("marks only Finding Grip past due when its payment fails", async () => {
    db.gripAccount.findUnique.mockResolvedValue({ userId: "user_1" });
    await handleWebhookEvent(event("invoice.payment_failed", invoice("price_grip")));

    expect(db.gripAccount.update).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      data: { status: "PAST_DUE" },
    });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("does not apply a Finding Grip invoice to RaceTrace when it arrives before the subscription is synced", async () => {
    await handleWebhookEvent(event("invoice.paid", invoice("price_grip")));

    expect(db.gripAccount.update).not.toHaveBeenCalled();
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("leaves RaceTrace invoices on the existing path", async () => {
    await handleWebhookEvent(event("invoice.paid", invoice("price_rt_pro")));

    expect(db.subscription.updateMany).toHaveBeenCalledTimes(1);
    expect(db.subscription.updateMany.mock.calls[0][0].where).toEqual({
      stripeCustomerId: "cus_1",
    });
    expect(db.gripAccount.update).not.toHaveBeenCalled();
  });
});

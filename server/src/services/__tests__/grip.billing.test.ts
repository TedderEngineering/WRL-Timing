import { describe, it, expect, vi, beforeEach } from "vitest";

// Finding Grip and RaceTrace share one Stripe customer. These tests pin down
// that a webhook for one product never changes the other product's plan, and
// that Finding Grip state always comes from re-reading Stripe.

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
const stripeMock = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), list: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
  customers: { create: vi.fn() },
}));
const envMock = vi.hoisted(() => ({
  env: {
    STRIPE_GRIP_PRO_PRICE_ID: "price_grip, price_grip_old" as string | undefined,
    FRONTEND_URL: "http://localhost:5173",
  },
}));

vi.mock("../../models/prisma.js", () => ({ prisma: db }));
vi.mock("../../config/env.js", () => envMock);
vi.mock("../../lib/stripe.js", () => ({
  stripe: stripeMock,
  TIER_PRICE_MAP: { PRO: "price_rt_pro", TEAM: "price_rt_team" },
}));

import { handleWebhookEvent } from "../billing.js";
import { createGripCheckoutSession } from "../grip/billing.js";

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
const stripeHas = (...subs: unknown[]) =>
  stripeMock.subscriptions.list.mockResolvedValue({ data: subs });
const written = () => db.gripAccount.upsert.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  envMock.env.STRIPE_GRIP_PRO_PRICE_ID = "price_grip, price_grip_old";
  db.subscription.findUnique.mockResolvedValue({
    userId: "user_1",
    stripeCustomerId: "cus_1",
  });
  db.gripAccount.findUnique.mockResolvedValue(null);
  stripeHas();
});

describe("subscription events", () => {
  it("writes a Finding Grip subscription to grip_accounts only", async () => {
    const s = sub("price_grip");
    stripeHas(s);
    await handleWebhookEvent(event("customer.subscription.updated", s));

    expect(written().where).toEqual({ userId: "user_1" });
    expect(written().update).toMatchObject({
      plan: "PRO",
      status: "ACTIVE",
      stripeSubscriptionId: "sub_1",
    });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("recognises every configured Finding Grip price", async () => {
    const s = sub("price_grip_old");
    stripeHas(s);
    await handleWebhookEvent(event("customer.subscription.updated", s));
    expect(written().update).toMatchObject({ plan: "PRO" });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("recognises Finding Grip by metadata even if the price id is unknown", async () => {
    db.subscription.findUnique.mockResolvedValue(null);
    const s = sub("price_new", {
      metadata: { product: "FINDING_GRIP", userId: "user_9" },
    });
    stripeHas(s);
    await handleWebhookEvent(event("customer.subscription.created", s));
    expect(written().where).toEqual({ userId: "user_9" });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("does not grant Pro for an incomplete checkout", async () => {
    const s = sub("price_grip", { status: "incomplete" });
    stripeHas(s);
    await handleWebhookEvent(event("customer.subscription.created", s));
    expect(written().update).toMatchObject({ plan: "FREE", status: "INCOMPLETE" });
  });

  it("drops to Free when the subscription has ended", async () => {
    const s = sub("price_grip", { status: "canceled" });
    stripeHas(s);
    await handleWebhookEvent(event("customer.subscription.deleted", s));
    expect(written().update).toMatchObject({ plan: "FREE", status: "CANCELED" });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("keeps Pro when a duplicate subscription is cancelled but another is still active", async () => {
    const ended = sub("price_grip", { id: "sub_A", status: "canceled" });
    const live = sub("price_grip", { id: "sub_B" });
    stripeHas(ended, live);
    await handleWebhookEvent(event("customer.subscription.deleted", ended));
    expect(written().update).toMatchObject({
      plan: "PRO",
      status: "ACTIVE",
      stripeSubscriptionId: "sub_B",
    });
  });

  it("is not fooled by a stale 'incomplete' event arriving after activation", async () => {
    stripeHas(sub("price_grip")); // Stripe's current truth: active
    await handleWebhookEvent(
      event("customer.subscription.created", sub("price_grip", { status: "incomplete" }))
    );
    expect(written().update).toMatchObject({ plan: "PRO", status: "ACTIVE" });
  });

  it("ignores the customer's RaceTrace subscription when reconciling", async () => {
    const grip = sub("price_grip", { id: "sub_grip", status: "canceled" });
    stripeHas(sub("price_rt_team", { id: "sub_rt" }), grip);
    await handleWebhookEvent(event("customer.subscription.deleted", grip));
    expect(written().update).toMatchObject({
      plan: "FREE",
      stripeSubscriptionId: "sub_grip",
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
    expect(stripeMock.subscriptions.list).not.toHaveBeenCalled();
  });

  it("cancelling RaceTrace does not touch Finding Grip", async () => {
    await handleWebhookEvent(event("customer.subscription.deleted", sub("price_rt_pro")));

    expect(db.subscription.updateMany).toHaveBeenCalledTimes(1);
    expect(db.gripAccount.upsert).not.toHaveBeenCalled();
    expect(db.gripAccount.updateMany).not.toHaveBeenCalled();
  });

  it("routes nothing to Finding Grip when no price is configured and there is no metadata", async () => {
    envMock.env.STRIPE_GRIP_PRO_PRICE_ID = undefined;
    await handleWebhookEvent(event("customer.subscription.updated", sub("price_grip")));
    expect(db.gripAccount.upsert).not.toHaveBeenCalled();
    expect(db.subscription.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe("checkout.session.completed", () => {
  it("syncs a Finding Grip checkout to grip_accounts without changing the RaceTrace plan", async () => {
    const s = sub("price_grip", {
      metadata: { product: "FINDING_GRIP", userId: "user_1" },
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue(s);
    stripeHas(s);
    await handleWebhookEvent(
      event("checkout.session.completed", {
        mode: "subscription",
        subscription: "sub_1",
        customer: "cus_1",
        metadata: { userId: "user_1", product: "FINDING_GRIP" },
      })
    );

    expect(written().update).toMatchObject({ plan: "PRO", status: "ACTIVE" });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
    // The shared customer id is linked, with the RaceTrace plan left alone.
    expect(db.subscription.upsert.mock.calls[0][0].update).toEqual({
      stripeCustomerId: "cus_1",
    });
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
  /** Shape used by newer Stripe API versions. */
  const newStyleInvoice = (priceId: string) => ({
    customer: "cus_1",
    parent: { subscription_details: { subscription: "sub_1", metadata: {} } },
    lines: {
      data: [
        { pricing: { price_details: { price: priceId } }, period: { start: 1, end: 2 } },
      ],
    },
  });

  it("applies a paid Finding Grip invoice by reconciling, and leaves RaceTrace alone", async () => {
    db.gripAccount.findUnique.mockResolvedValue({ userId: "user_1" });
    stripeHas(sub("price_grip"));
    await handleWebhookEvent(event("invoice.paid", invoice("price_grip")));

    expect(written().update).toMatchObject({ plan: "PRO", status: "ACTIVE" });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("marks only Finding Grip past due when its payment fails", async () => {
    db.gripAccount.findUnique.mockResolvedValue({ userId: "user_1" });
    stripeHas(sub("price_grip", { status: "past_due" }));
    await handleWebhookEvent(event("invoice.payment_failed", invoice("price_grip")));

    expect(written().update).toMatchObject({ plan: "PRO", status: "PAST_DUE" });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("claims a Finding Grip invoice that arrives before the subscription is synced", async () => {
    stripeHas(sub("price_grip"));
    await handleWebhookEvent(event("invoice.paid", invoice("price_grip")));

    expect(written().update).toMatchObject({ plan: "PRO" });
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("recognises a Finding Grip invoice in the newer Stripe payload shape", async () => {
    stripeHas(sub("price_grip"));
    await handleWebhookEvent(
      event("invoice.payment_failed", newStyleInvoice("price_grip"))
    );
    expect(db.subscription.updateMany).not.toHaveBeenCalled();
    expect(db.gripAccount.upsert).toHaveBeenCalledTimes(1);
  });

  it("leaves RaceTrace invoices on the existing path", async () => {
    await handleWebhookEvent(event("invoice.paid", invoice("price_rt_pro")));

    expect(db.subscription.updateMany).toHaveBeenCalledTimes(1);
    expect(db.subscription.updateMany.mock.calls[0][0].where).toEqual({
      stripeCustomerId: "cus_1",
    });
    expect(db.gripAccount.upsert).not.toHaveBeenCalled();
  });
});

describe("createGripCheckoutSession", () => {
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.c",
      subscription: { stripeCustomerId: "cus_1" },
    });
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.example/x",
    });
  });

  it("sells the first configured price and tags the subscription as Finding Grip", async () => {
    await expect(createGripCheckoutSession("user_1")).resolves.toBe(
      "https://checkout.example/x"
    );
    const arg = stripeMock.checkout.sessions.create.mock.calls[0][0];
    expect(arg.line_items).toEqual([{ price: "price_grip", quantity: 1 }]);
    expect(arg.subscription_data.metadata).toEqual({
      userId: "user_1",
      product: "FINDING_GRIP",
    });
    expect(arg.success_url).toContain("/grip/settings?session_id=");
  });

  it("refuses a second subscription when Stripe already shows a live one", async () => {
    stripeHas(sub("price_grip"));
    await expect(createGripCheckoutSession("user_1")).rejects.toMatchObject({
      code: "ALREADY_SUBSCRIBED",
    });
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("is unavailable until a price is configured", async () => {
    envMock.env.STRIPE_GRIP_PRO_PRICE_ID = undefined;
    await expect(createGripCheckoutSession("user_1")).rejects.toMatchObject({
      code: "GRIP_PRICE_NOT_CONFIGURED",
    });
  });
});

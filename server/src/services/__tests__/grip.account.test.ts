import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from "vitest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));

import { gripIsFree, hasGripPro, serializeGripAccount } from "../grip/account.js";

const now = new Date("2026-10-09T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);

describe("free for everyone (the default)", () => {
  const original = process.env.GRIP_PRICING;
  afterEach(() => {
    if (original === undefined) delete process.env.GRIP_PRICING;
    else process.env.GRIP_PRICING = original;
  });

  it("is on unless GRIP_PRICING is paid", () => {
    delete process.env.GRIP_PRICING;
    expect(gripIsFree()).toBe(true);
    process.env.GRIP_PRICING = "free";
    expect(gripIsFree()).toBe(true);
    process.env.GRIP_PRICING = "paid";
    expect(gripIsFree()).toBe(false);
  });

  it("gives a free account full access with no calculation limit", () => {
    delete process.env.GRIP_PRICING;
    const account = {
      userId: "u1",
      units: "STANDARD",
      plan: "FREE",
      status: "ACTIVE",
      stripeSubscriptionId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      calcCount: 250,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Parameters<typeof serializeGripAccount>[0];
    expect(hasGripPro(account, "USER")).toBe(true);
    const dto = serializeGripAccount(account, "USER");
    expect(dto.isPro).toBe(true);
    expect(dto.freeForAll).toBe(true);
    expect(dto.freeCalculationsLeft).toBeNull();
  });
});

describe("hasGripPro with paid plans switched on", () => {
  const original = process.env.GRIP_PRICING;
  beforeAll(() => {
    process.env.GRIP_PRICING = "paid";
  });
  afterAll(() => {
    if (original === undefined) delete process.env.GRIP_PRICING;
    else process.env.GRIP_PRICING = original;
  });

  it("is false on the free plan", () => {
    expect(
      hasGripPro({ plan: "FREE", status: "ACTIVE", currentPeriodEnd: null }, "USER", now)
    ).toBe(false);
  });

  it("is true for admins whatever the plan", () => {
    expect(
      hasGripPro({ plan: "FREE", status: "ACTIVE", currentPeriodEnd: null }, "ADMIN", now)
    ).toBe(true);
  });

  it("is true for an active or trialing Pro subscription", () => {
    expect(
      hasGripPro({ plan: "PRO", status: "ACTIVE", currentPeriodEnd: at(30) }, "USER", now)
    ).toBe(true);
    expect(
      hasGripPro(
        { plan: "PRO", status: "TRIALING", currentPeriodEnd: at(7) },
        "USER",
        now
      )
    ).toBe(true);
  });

  it("keeps access after cancelling until the paid period ends", () => {
    expect(
      hasGripPro(
        { plan: "PRO", status: "CANCELED", currentPeriodEnd: at(3) },
        "USER",
        now
      )
    ).toBe(true);
    expect(
      hasGripPro(
        { plan: "PRO", status: "CANCELED", currentPeriodEnd: at(-1) },
        "USER",
        now
      )
    ).toBe(false);
  });

  it("allows seven days of grace when payment is past due", () => {
    expect(
      hasGripPro(
        { plan: "PRO", status: "PAST_DUE", currentPeriodEnd: at(-6) },
        "USER",
        now
      )
    ).toBe(true);
    expect(
      hasGripPro(
        { plan: "PRO", status: "PAST_DUE", currentPeriodEnd: at(-8) },
        "USER",
        now
      )
    ).toBe(false);
  });

  it("does not grant access for an incomplete checkout", () => {
    expect(
      hasGripPro(
        { plan: "PRO", status: "INCOMPLETE", currentPeriodEnd: at(30) },
        "USER",
        now
      )
    ).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));

import { hasGripPro } from "../grip/account.js";

const now = new Date("2026-10-09T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);

describe("hasGripPro", () => {
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

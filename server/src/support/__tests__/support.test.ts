import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));
vi.mock("../../lib/supabase.js", () => ({ supabase: null, STORAGE_BUCKET: "race-files" }));
const created: any[] = [];
vi.mock("../../lib/stripe.js", () => ({
  stripe: { checkout: { sessions: { create: async (p: any) => { created.push(p); return { url: "https://checkout.stripe.com/c/pay/cs_test_123" }; } } } },
  TIER_PRICE_MAP: {},
}));

import { createApp } from "../../app.js";
import { checkoutParams, safeReturnPath } from "../support.js";
import { freeMode } from "../../lib/free-mode.js";

const app = createApp();
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  created.length = 0;
});

describe("free mode", () => {
  it("is on unless RACETRACE_FREE is off", () => {
    delete process.env.RACETRACE_FREE;
    expect(freeMode()).toBe(true);
    process.env.RACETRACE_FREE = "off";
    expect(freeMode()).toBe(false);
  });
});

describe("GET /api/site-config", () => {
  it("reports free mode and that checkout is ready when Stripe is configured", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    const res = await request(app).get("/api/site-config");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ freeMode: true, support: { enabled: true, checkout: true, coffeeCents: 500, options: [1, 3, 20] } });
  });

  it("falls back to a Stripe Payment Link when checkout is off", async () => {
    process.env.SUPPORT_CHECKOUT = "off";
    process.env.SUPPORT_PAYMENT_LINK_URL = "https://buy.stripe.com/test_123";
    const res = await request(app).get("/api/site-config");
    expect(res.body.support).toMatchObject({ enabled: true, checkout: false, paymentLinkUrl: "https://buy.stripe.com/test_123" });
  });
});

describe("POST /api/support/checkout", () => {
  it("creates a one-off donation for the chosen number of coffees", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    const res = await request(app).post("/api/support/checkout").send({ coffees: 3, returnPath: "/dashboard" });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const p = created[0];
    expect(p.mode).toBe("payment");
    expect(p.submit_type).toBe("donate");
    expect(p.line_items[0]).toMatchObject({ quantity: 3, price_data: { currency: "usd", unit_amount: 500 } });
    expect(p.metadata).toMatchObject({ kind: "racetrace_support", coffees: "3" });
  });

  it("only offers 1, 3 or 20 coffees", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    expect((await request(app).post("/api/support/checkout").send({ coffees: 1000 })).status).toBe(400);
  });

  it("is unavailable without a real Stripe key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    expect((await request(app).post("/api/support/checkout").send({ coffees: 1 })).status).toBe(404);
  });

  it("returns only to pages on this site", () => {
    expect(safeReturnPath("https://evil.example")).toBe("/dashboard");
    expect(safeReturnPath("//evil.example")).toBe("/dashboard");
    expect(safeReturnPath("/chart?race=abc")).toBe("/chart?race=abc");
    const p = checkoutParams({ coffees: 1, returnPath: "/x", userId: null, frontendUrl: "https://racetrace.example/" });
    expect(p.success_url).toBe("https://racetrace.example/support/thanks?session_id={CHECKOUT_SESSION_ID}&return=%2Fx");
    expect(p.cancel_url).toBe("https://racetrace.example/x");
  });

  it("names the coffee for Finding Grip and returns there when site is grip", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    const res = await request(app).post("/api/support/checkout").send({ coffees: 20, returnPath: "/calculate?calc=abc", site: "grip" });
    expect(res.status).toBe(200);
    const p = created[0];
    expect(p.mode).toBe("payment");
    expect(p.line_items[0]).toMatchObject({ quantity: 20, price_data: { product_data: { name: "A coffee for Finding Grip" } } });
    expect(p.metadata).toMatchObject({ kind: "findinggrip_support", coffees: "20" });
    // Without GRIP_PUBLIC_URL (as in tests) Finding Grip lives under /grip on the RaceTrace address.
    expect(p.success_url).toMatch(/\/grip\/support\/thanks\?session_id=\{CHECKOUT_SESSION_ID\}&return=%2Fcalculate%3Fcalc%3Dabc$/);
    expect(p.cancel_url).toMatch(/\/grip\/calculate\?calc=abc$/);
  });

  it("uses Finding Grip's own address for the return links", () => {
    const p = checkoutParams({ coffees: 3, returnPath: "/dashboard", userId: "u1", frontendUrl: "https://findinggrip.example", site: "grip" });
    expect(p.success_url).toBe("https://findinggrip.example/support/thanks?session_id={CHECKOUT_SESSION_ID}&return=%2Fdashboard");
    expect(p.cancel_url).toBe("https://findinggrip.example/dashboard");
    expect(p.metadata).toEqual({ kind: "findinggrip_support", coffees: "3", userId: "u1" });
  });

  it("offers no Finding Grip coffee while Finding Grip is paid", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    process.env.GRIP_PRICING = "paid";
    expect((await request(app).post("/api/support/checkout").send({ coffees: 1, site: "grip" })).status).toBe(404);
    expect((await request(app).post("/api/support/checkout").send({ coffees: 1 })).status).toBe(200);
  });

  it("refuses an unknown site", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    expect((await request(app).post("/api/support/checkout").send({ coffees: 1, site: "evil.example" })).status).toBe(400);
  });
});

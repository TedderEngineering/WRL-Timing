import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { canAsk, isSupporter, markAsked, markDismissed, markThanked, recentlyThanked } from "../storage";
import { SupportSheet, dollars } from "../SupportSheet";
import { SupportAsk, SupportCard, SupportLink } from "../SupportPrompts";
import { SupportProvider } from "../SupportContext";
import { __setSiteConfigForTests } from "../../../lib/site-config";
import { hasFullAccess, hasTeamAccess } from "../../../lib/utils";

// A tiny in-memory localStorage (vitest runs these in Node).
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => {
  delete (globalThis as any).localStorage;
  __setSiteConfigForTests({});
});

const DAY = 86_400_000;
const text = (s: string) => s.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const SUPPORT = { enabled: true, checkout: true, paymentLinkUrl: null, coffeeCents: 500, options: [1, 3, 10] };

describe("when to ask (F9 note 5)", () => {
  it("asks at most once every 30 days, and Not now counts as an answer", () => {
    const t0 = Date.UTC(2026, 9, 14);
    expect(canAsk(t0)).toBe(true);
    markAsked(t0);
    expect(canAsk(t0 + 29 * DAY)).toBe(false);
    expect(canAsk(t0 + 30 * DAY)).toBe(true);
    markDismissed(t0 + 30 * DAY);
    expect(canAsk(t0 + 45 * DAY)).toBe(false);
  });

  it("never asks a supporter again for a year, and thanks them for two weeks", () => {
    const t0 = Date.UTC(2026, 9, 14);
    markThanked(t0);
    expect(canAsk(t0 + 200 * DAY)).toBe(false);
    expect(isSupporter(t0 + 200 * DAY)).toBe(true);
    expect(recentlyThanked(t0 + 13 * DAY)).toBe(true);
    expect(recentlyThanked(t0 + 15 * DAY)).toBe(false);
    expect(canAsk(t0 + 366 * DAY)).toBe(true);
  });

  it("still works when storage is blocked", () => {
    (globalThis as any).localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(canAsk()).toBe(true);
    expect(() => markAsked()).not.toThrow();
  });
});

describe("support sheet (F9-C / F10)", () => {
  const out = text(renderToStaticMarkup(<SupportSheet support={SUPPORT} onClose={() => {}} />));

  it("is personal and says what the money pays for", () => {
    expect(out).toContain("Keep RaceTrace free");
    expect(out).toContain("Brent Tedder · Tedder Engineering");
    expect(out).toContain("no paywall and no ads");
  });

  it("offers 1, 3 (preselected, 'a race weekend') and a season, priced from the coffee price", () => {
    const html = renderToStaticMarkup(<SupportSheet support={SUPPORT} onClose={() => {}} />);
    expect(out).toContain("1 coffee $5");
    expect(out).toContain("A race weekend");
    expect(out).toContain("A full season $50");
    expect(html).toMatch(/aria-checked="true"[^>]*>(?:(?!<button).)*3 coffees/s);
    expect(out).toContain("Buy me 3 coffees · $15");
    expect(dollars(250)).toBe("$2.50");
  });
});

describe("prompts", () => {
  it("shows the header link and the after-value ask only when support is set up", () => {
    __setSiteConfigForTests({ support: SUPPORT });
    const on = text(renderToStaticMarkup(<MemoryRouter><SupportProvider><SupportLink /><SupportAsk /></SupportProvider></MemoryRouter>));
    expect(on).toContain("☕ Buy me a coffee");
    expect(on).toContain("Enjoyed this recap?");
    __setSiteConfigForTests({ support: { ...SUPPORT, enabled: false } });
    const off = text(renderToStaticMarkup(<MemoryRouter><SupportProvider><SupportLink /><SupportAsk /></SupportProvider></MemoryRouter>));
    expect(off).toBe("");
  });

  it("thanks a supporter instead of asking", () => {
    __setSiteConfigForTests({ support: SUPPORT });
    markThanked();
    const out = text(renderToStaticMarkup(<MemoryRouter><SupportProvider><SupportCard /><SupportAsk /></SupportProvider></MemoryRouter>));
    expect(out).toContain("Thank you");
    expect(out).not.toContain("Enjoyed this recap?");
  });
});

describe("free mode", () => {
  it("opens everything to everyone, and plans come back when it is off", () => {
    __setSiteConfigForTests({ freeMode: true });
    expect(hasFullAccess(null)).toBe(true);
    expect(hasTeamAccess({ role: "USER", subscription: { plan: "FREE" } } as any)).toBe(true);
    __setSiteConfigForTests({ freeMode: false });
    expect(hasFullAccess(null)).toBe(false);
    expect(hasFullAccess({ role: "USER", subscription: { plan: "PRO" } } as any)).toBe(true);
    expect(hasTeamAccess({ role: "USER", subscription: { plan: "PRO" } } as any)).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const env = vi.hoisted(
  (): Record<string, string | undefined> => ({
    NODE_ENV: "production",
    COOKIE_DOMAIN: undefined,
    JWT_ACCESS_SECRET: "x".repeat(32),
    JWT_REFRESH_SECRET: "y".repeat(32),
  })
);
vi.mock("../../config/env.js", () => ({ env }));

import {
  clearRefreshCookie,
  cookieDomain,
  readRefreshCookie,
  refreshCookieName,
  refreshCookieOptions,
  setRefreshCookie,
} from "../tokens.js";

function fakeResponse() {
  const calls: { op: "set" | "clear"; name: string; value?: string; options: Record<string, unknown> }[] = [];
  return {
    calls,
    cookie: (name: string, value: string, options: object) => calls.push({ op: "set", name, value, options: options as Record<string, unknown> }),
    clearCookie: (name: string, options: object) => calls.push({ op: "clear", name, options: options as Record<string, unknown> }),
  };
}

describe("refresh cookie without COOKIE_DOMAIN (original behaviour)", () => {
  beforeEach(() => {
    env.COOKIE_DOMAIN = undefined;
    env.NODE_ENV = "production";
  });

  it("is the host-only refresh_token cookie, SameSite=None in production", () => {
    expect(refreshCookieName()).toBe("refresh_token");
    const o = refreshCookieOptions();
    expect(o).toMatchObject({ httpOnly: true, secure: true, sameSite: "none", path: "/api/auth" });
    expect(o).not.toHaveProperty("domain");
  });

  it("sets and clears only that cookie", () => {
    const res = fakeResponse();
    setRefreshCookie(res, "tok");
    clearRefreshCookie(res);
    expect(res.calls.map((c) => `${c.op}:${c.name}`)).toEqual(["set:refresh_token", "clear:refresh_token"]);
  });

  it("is Lax and not Secure in development", () => {
    env.NODE_ENV = "development";
    expect(refreshCookieOptions()).toMatchObject({ secure: false, sameSite: "lax" });
  });
});

describe("refresh cookie with COOKIE_DOMAIN (shared login)", () => {
  beforeEach(() => {
    env.COOKIE_DOMAIN = "tedderengineering.com";
    env.NODE_ENV = "production";
  });

  it("normalises the domain and rejects unusable values", () => {
    expect(cookieDomain("tedderengineering.com")).toBe(".tedderengineering.com");
    expect(cookieDomain(" .TedderEngineering.com ")).toBe(".tedderengineering.com");
    expect(cookieDomain("localhost")).toBeNull();
    expect(cookieDomain("https://x.com/")).toBeNull();
    expect(cookieDomain("")).toBeNull();
  });

  it("is a first-party cookie on the parent domain", () => {
    expect(refreshCookieName()).toBe("te_session");
    expect(refreshCookieOptions()).toMatchObject({
      domain: ".tedderengineering.com",
      secure: true,
      sameSite: "lax",
      path: "/api/auth",
      httpOnly: true,
    });
  });

  it("clears the old host-only cookie whenever it sets the new one", () => {
    const res = fakeResponse();
    setRefreshCookie(res, "tok");
    expect(res.calls.map((c) => `${c.op}:${c.name}`)).toEqual(["clear:refresh_token", "set:te_session"]);
    expect(res.calls[0].options).not.toHaveProperty("domain");
    expect(res.calls[1].options).toMatchObject({ domain: ".tedderengineering.com" });
  });

  it("clears with the attributes it was set with", () => {
    const res = fakeResponse();
    clearRefreshCookie(res);
    expect(res.calls[0]).toMatchObject({ op: "clear", name: "te_session", options: { domain: ".tedderengineering.com", path: "/api/auth" } });
    expect(res.calls[1]).toMatchObject({ op: "clear", name: "refresh_token" });
  });

  it("still reads the old cookie once, so nobody is signed out by the switch", () => {
    expect(readRefreshCookie({ cookies: { refresh_token: "old" } })).toBe("old");
    expect(readRefreshCookie({ cookies: { refresh_token: "old", te_session: "new" } })).toBe("new");
    expect(readRefreshCookie({})).toBeUndefined();
  });
});

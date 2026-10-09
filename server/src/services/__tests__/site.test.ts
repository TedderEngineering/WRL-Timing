import { describe, it, expect, vi, beforeEach } from "vitest";

const env = vi.hoisted(
  (): Record<string, string | undefined> => ({
    FRONTEND_URL: "https://racetrace.example.com/",
    EMAIL_FROM: "noreply@example.com",
    GRIP_PUBLIC_URL: undefined,
    SETUP_PUBLIC_URL: undefined,
    EXTRA_CORS_ORIGINS: undefined,
    NODE_ENV: "production",
  })
);
vi.mock("../../config/env.js", () => ({ env }));

import {
  allowedOrigins,
  gripPageUrl,
  gripSite,
  readGripPublicUrl,
  readSetupPublicUrl,
  setupSite,
  siteForRequest,
} from "../site.js";
import { senderFor } from "../email.js";

const req = (headers: Record<string, string>) => ({ headers });

describe("site selection", () => {
  beforeEach(() => {
    env.GRIP_PUBLIC_URL = undefined;
    env.SETUP_PUBLIC_URL = undefined;
    env.EXTRA_CORS_ORIGINS = undefined;
    env.NODE_ENV = "production";
  });

  it("is always RaceTrace until Finding Grip has its own address", () => {
    expect(gripSite()).toBeNull();
    expect(siteForRequest(req({ origin: "https://findinggrip.example.com" })).key).toBe(
      "racetrace"
    );
    expect(gripPageUrl("/settings")).toBe("https://racetrace.example.com/grip/settings");
    expect(allowedOrigins()).toEqual(["https://racetrace.example.com"]);
  });

  it("recognises the Finding Grip site by origin, referer or forwarded host", () => {
    env.GRIP_PUBLIC_URL = "https://findinggrip.example.com/";
    const grip = {
      key: "grip",
      name: "Finding Grip",
      url: "https://findinggrip.example.com",
    };
    expect(
      siteForRequest(req({ origin: "https://findinggrip.example.com" }))
    ).toMatchObject(grip);
    expect(
      siteForRequest(req({ referer: "https://FindingGrip.example.com/signup" }))
    ).toMatchObject(grip);
    expect(
      siteForRequest(req({ "x-forwarded-host": "findinggrip.example.com" }))
    ).toMatchObject(grip);
    expect(siteForRequest(req({ origin: "https://racetrace.example.com" })).key).toBe(
      "racetrace"
    );
    expect(siteForRequest(req({})).key).toBe("racetrace");
    expect(gripPageUrl("/settings")).toBe("https://findinggrip.example.com/settings");
    expect(allowedOrigins()).toEqual([
      "https://racetrace.example.com",
      "https://findinggrip.example.com",
    ]);
  });

  it("never builds a link to an address that is not configured", () => {
    env.GRIP_PUBLIC_URL = "https://findinggrip.example.com";
    const site = siteForRequest(
      req({ origin: "https://evil.example.net", "x-forwarded-host": "evil.example.net" })
    );
    expect(site.url).toBe("https://racetrace.example.com");
  });
});

describe("Setup Sheet as a third site", () => {
  beforeEach(() => {
    env.GRIP_PUBLIC_URL = "https://findinggrip.example.com";
    env.SETUP_PUBLIC_URL = "setup.example.com/";
    env.EXTRA_CORS_ORIGINS = undefined;
    env.NODE_ENV = "production";
  });

  it("is recognised by origin and gets its own name in emails", () => {
    expect(setupSite()).toMatchObject({ key: "setup", name: "Setup Sheet", url: "https://setup.example.com" });
    expect(siteForRequest(req({ origin: "https://setup.example.com" })).key).toBe("setup");
    expect(siteForRequest(req({ referer: "https://setup.example.com/login" })).key).toBe("setup");
    expect(siteForRequest(req({ origin: "https://findinggrip.example.com" })).key).toBe("grip");
    expect(siteForRequest(req({ origin: "https://racetrace.example.com" })).key).toBe("racetrace");
    expect(siteForRequest(req({ origin: "https://evil.example.net" })).key).toBe("racetrace");
  });

  it("is allowed to call the API, and only configured sites are", () => {
    expect(allowedOrigins()).toEqual([
      "https://racetrace.example.com",
      "https://findinggrip.example.com",
      "https://setup.example.com",
    ]);
  });

  it("is recognised without Finding Grip configured", () => {
    env.GRIP_PUBLIC_URL = undefined;
    expect(siteForRequest(req({ origin: "https://setup.example.com" })).key).toBe("setup");
    expect(siteForRequest(req({ origin: "https://findinggrip.example.com" })).key).toBe("racetrace");
  });

  it("ignores an unusable SETUP_PUBLIC_URL", () => {
    env.SETUP_PUBLIC_URL = "yes";
    expect(readSetupPublicUrl().problem).toMatch(/SETUP_PUBLIC_URL is not a web address/);
    expect(setupSite()).toBeNull();
  });

  it("adds EXTRA_CORS_ORIGINS outside production only", () => {
    env.EXTRA_CORS_ORIGINS = "http://localhost:3000, nonsense, http://127.0.0.1:4173";
    expect(allowedOrigins()).not.toContain("http://localhost:3000");
    env.NODE_ENV = "development";
    expect(allowedOrigins()).toEqual(
      expect.arrayContaining(["http://localhost:3000"])
    );
    expect(allowedOrigins()).not.toContain("https://nonsense");
  });
});

describe("GRIP_PUBLIC_URL as typed", () => {
  it("accepts a bare domain, spaces and a trailing path", () => {
    for (const typed of [
      "findinggrip.example.com",
      "  https://findinggrip.example.com/  ",
      "https://FindingGrip.example.com/dashboard",
    ]) {
      env.GRIP_PUBLIC_URL = typed;
      expect(readGripPublicUrl()).toEqual({
        url: "https://findinggrip.example.com",
        problem: null,
      });
    }
  });

  it("ignores an empty or unusable value instead of failing", () => {
    env.GRIP_PUBLIC_URL = "";
    expect(readGripPublicUrl()).toEqual({ url: null, problem: null });
    for (const typed of ["yes", "Get-Content file | Set-Clipboard", "http://"]) {
      env.GRIP_PUBLIC_URL = typed;
      const read = readGripPublicUrl();
      expect(read.url).toBeNull();
      expect(read.problem).toMatch(/not a web address/);
      expect(gripSite()).toBeNull();
    }
  });
});

describe("senderFor", () => {
  it("keeps the configured sender unless a name is given", () => {
    expect(senderFor("noreply@example.com")).toBe("noreply@example.com");
    expect(senderFor("RaceTrace <noreply@example.com>")).toBe(
      "RaceTrace <noreply@example.com>"
    );
  });
  it("swaps only the display name", () => {
    expect(senderFor("noreply@example.com", "Finding Grip")).toBe(
      "Finding Grip <noreply@example.com>"
    );
    expect(senderFor("RaceTrace <noreply@example.com>", "Finding Grip")).toBe(
      "Finding Grip <noreply@example.com>"
    );
  });
});

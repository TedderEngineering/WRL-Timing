import { describe, it, expect, vi, beforeEach } from "vitest";

const env = vi.hoisted(
  (): Record<string, string | undefined> => ({
    FRONTEND_URL: "https://racetrace.example.com/",
    EMAIL_FROM: "noreply@example.com",
    GRIP_PUBLIC_URL: undefined,
  })
);
vi.mock("../../config/env.js", () => ({ env }));

import {
  allowedOrigins,
  gripPageUrl,
  gripSite,
  readGripPublicUrl,
  siteForRequest,
} from "../site.js";
import { senderFor } from "../email.js";

const req = (headers: Record<string, string>) => ({ headers });

describe("site selection", () => {
  beforeEach(() => {
    env.GRIP_PUBLIC_URL = undefined;
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

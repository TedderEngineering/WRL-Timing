import { describe, it, expect, vi } from "vitest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));
vi.mock("../../config/env.js", () => ({
  env: { NODE_ENV: "test", JWT_ACCESS_SECRET: "x".repeat(32), JWT_REFRESH_SECRET: "y".repeat(32) },
}));

import { isReplayAfterGrace, ROTATION_GRACE_MS } from "../auth.js";
import { getSessionLimit } from "../../config/sessionLimits.js";

describe("device limit", () => {
  it("is three devices on every plan", () => {
    for (const plan of ["FREE", "PRO", "TEAM", "free", null, undefined, "SOMETHING_NEW"]) {
      expect(getSessionLimit(plan)).toBe(3);
    }
  });
});

describe("refresh token rotation grace", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("treats a token that was never rotated as fresh", () => {
    expect(isReplayAfterGrace({ rotatedAt: null }, now)).toBe(false);
  });

  it("honours a just-rotated token (a concurrent refresh from another tab or site)", () => {
    expect(isReplayAfterGrace({ rotatedAt: ago(1_000) }, now)).toBe(false);
    expect(isReplayAfterGrace({ rotatedAt: ago(ROTATION_GRACE_MS) }, now)).toBe(false);
  });

  it("treats reuse after the window as a replayed (possibly stolen) token", () => {
    expect(isReplayAfterGrace({ rotatedAt: ago(ROTATION_GRACE_MS + 1) }, now)).toBe(true);
    expect(isReplayAfterGrace({ rotatedAt: ago(60 * 60 * 1000) }, now)).toBe(true);
  });
});

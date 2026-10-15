import { describe, expect, it } from "vitest";
import { installHintMode } from "../InstallHint";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 15);
const base = { now, installed: false, phone: true, canPrompt: false, platform: "android" as const };

describe("RaceTrace install hint", () => {
  it("offers the browser's dialog whenever the browser has offered install", () => {
    expect(installHintMode({ ...base, canPrompt: true })).toBe("prompt");
    expect(installHintMode({ ...base, phone: false, canPrompt: true, platform: "other" })).toBe("prompt");
  });

  it("gives written steps on phones without the offer", () => {
    expect(installHintMode({ ...base, platform: "ios" })).toBe("ios");
    expect(installHintMode(base)).toBe("menu");
    expect(installHintMode({ ...base, platform: "other" })).toBeNull();
  });

  it("never shows on a computer whose browser has not offered install, or inside the app", () => {
    expect(installHintMode({ ...base, phone: false, platform: "other" })).toBeNull();
    expect(installHintMode({ ...base, phone: false, platform: "ios" })).toBeNull();
    expect(installHintMode({ ...base, canPrompt: true, installed: true })).toBeNull();
  });

  it("'Not now' hides it for 60 days", () => {
    expect(installHintMode({ ...base, canPrompt: true, dismissedAt: now - 59 * DAY })).toBeNull();
    expect(installHintMode({ ...base, canPrompt: true, dismissedAt: now - 61 * DAY })).toBe("prompt");
  });
});

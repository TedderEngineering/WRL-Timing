import { describe, expect, it, vi, afterEach } from "vitest";
import { currentDeviceClass, deviceClassOf } from "../breakpoint";

describe("screen size classes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("split at Tailwind's sm (640) and lg (1024)", () => {
    expect(deviceClassOf(320)).toBe("compact");
    expect(deviceClassOf(639)).toBe("compact");
    expect(deviceClassOf(640)).toBe("medium");
    expect(deviceClassOf(1023)).toBe("medium");
    expect(deviceClassOf(1024)).toBe("expanded");
  });

  it("read the window through matchMedia when the browser has it", () => {
    const widths = { "(max-width: 639.98px)": true, "(max-width: 1023.98px)": true } as Record<string, boolean>;
    const matchMedia = (q: string) => ({ matches: !!widths[q], addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("window", { matchMedia, innerWidth: 375 });
    expect(currentDeviceClass()).toBe("compact");
    widths["(max-width: 639.98px)"] = false;
    expect(currentDeviceClass()).toBe("medium");
    widths["(max-width: 1023.98px)"] = false;
    expect(currentDeviceClass()).toBe("expanded");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { recentEvents } from "@/lib/analytics";
import { shareLink, shareUrl } from "../shareLink";

afterEach(() => vi.unstubAllGlobals());
const last = () => recentEvents()[recentEvents().length - 1];

function stub({ coarse, share, clipboard }: { coarse: boolean; share?: (d: ShareData) => Promise<void>; clipboard?: (t: string) => Promise<void> }) {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: coarse }), location: { origin: "https://racetrace.tedderengineering.com" } });
  vi.stubGlobal("navigator", { share, clipboard: { writeText: clipboard ?? (async () => undefined) } });
}

describe("sharing a race link", () => {
  it("adds utm_source=share and nothing about the sender", () => {
    expect(shareUrl("/chart?race=r1", "https://racetrace.tedderengineering.com")).toBe("https://racetrace.tedderengineering.com/chart?race=r1&utm_source=share");
  });

  it("uses the share sheet on a phone and records share_card", async () => {
    const share = vi.fn(async () => undefined);
    stub({ coarse: true, share });
    expect(await shareLink({ url: "https://x/chart?race=r1", title: "Race", kind: "race_link" })).toBe("share");
    expect(share).toHaveBeenCalledWith({ title: "Race", text: "Race", url: "https://x/chart?race=r1" });
    expect(last()).toMatchObject({ event: "share_card", details: { kind: "race_link", method: "share" } });
  });

  it("copies the link on a computer", async () => {
    const writeText = vi.fn(async () => undefined);
    stub({ coarse: false, share: vi.fn(), clipboard: writeText });
    expect(await shareLink({ url: "https://x/a", title: "Race", kind: "race_link" })).toBe("copy");
    expect(writeText).toHaveBeenCalledWith("https://x/a");
    expect(last()).toMatchObject({ event: "share_card", details: { method: "copy" } });
  });

  it("records nothing when the person cancels", async () => {
    stub({ coarse: true, share: async () => Promise.reject(new DOMException("no", "AbortError")) });
    const before = recentEvents().length;
    expect(await shareLink({ url: "https://x/a", title: "Race", kind: "race_link" })).toBe("cancelled");
    expect(recentEvents().length).toBe(before);
  });
});

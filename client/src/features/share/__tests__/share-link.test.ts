import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recentEvents } from "@/lib/analytics";
import { __resetShareArrivalForTests, noteShareArrival, shareLink, sharedUrl } from "../shareLink";

afterEach(() => vi.unstubAllGlobals());
const last = () => recentEvents()[recentEvents().length - 1];

function stub({ share, clipboard }: { share?: (d: ShareData) => Promise<void>; clipboard?: (t: string) => Promise<void> }) {
  vi.stubGlobal("navigator", { share, clipboard: { writeText: clipboard ?? (async () => undefined) } });
}
const args = { url: "https://racetrace.tedderengineering.com/?from=share", title: "RaceTrace", text: "RaceTrace: free lap charts.", source: "footer" };

describe("sharing the site", () => {
  it("tags the link ?from=share and keeps what is already there", () => {
    expect(sharedUrl("https://racetrace.tedderengineering.com/")).toBe("https://racetrace.tedderengineering.com/?from=share");
    expect(sharedUrl("https://racetrace.tedderengineering.com/chart?race=r1")).toBe("https://racetrace.tedderengineering.com/chart?race=r1&from=share");
  });

  it("uses the share sheet when there is one and records share_app", async () => {
    const share = vi.fn(async () => undefined);
    stub({ share });
    expect(await shareLink(args)).toBe("share");
    expect(share).toHaveBeenCalledWith({ title: "RaceTrace", text: "RaceTrace: free lap charts.", url: args.url });
    expect(last()).toMatchObject({ event: "share_app", details: { source: "footer", method: "share" } });
  });

  it("copies the message and link where there is no share sheet", async () => {
    const writeText = vi.fn(async () => undefined);
    stub({ clipboard: writeText });
    expect(await shareLink(args)).toBe("copy");
    expect(writeText).toHaveBeenCalledWith("RaceTrace: free lap charts. https://racetrace.tedderengineering.com/?from=share");
    expect(last()).toMatchObject({ event: "share_app", details: { method: "copy" } });
  });

  it("records nothing when the sheet is closed", async () => {
    stub({ share: async () => Promise.reject(new DOMException("no", "AbortError")) });
    const before = recentEvents().length;
    expect(await shareLink(args)).toBe("cancelled");
    expect(recentEvents().length).toBe(before);
  });
});

describe("arrivals from a shared link", () => {
  let replaced: string[];
  beforeEach(() => {
    __resetShareArrivalForTests();
    replaced = [];
  });
  const at = (href: string) =>
    vi.stubGlobal("window", { location: { href }, history: { state: null, replaceState: (_s: unknown, _t: string, u: string) => replaced.push(u) } });

  it("is counted once per load, with a landing code and no address, and the tag removed", () => {
    at("https://racetrace.tedderengineering.com/dashboard?x=1&from=share#top");
    noteShareArrival((p) => (p === "/" ? "home" : "app"));
    expect(last()).toMatchObject({ event: "share_arrival", details: { landing: "app" } });
    expect(replaced).toEqual(["/dashboard?x=1#top"]);
    const n = recentEvents().length;
    noteShareArrival(() => "home");
    expect(recentEvents().length).toBe(n);
  });

  it("does nothing without the tag", () => {
    at("https://racetrace.tedderengineering.com/");
    const n = recentEvents().length;
    noteShareArrival(() => "home");
    expect(recentEvents().length).toBe(n);
    expect(replaced).toEqual([]);
  });
});

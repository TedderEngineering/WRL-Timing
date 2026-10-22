import { describe, expect, it } from "vitest";
import { datesText, untilText } from "../RaceNews";
import { needsLiveKey, withLiveKey } from "../../live/liveKey";

describe("landing race news", () => {
  it("writes a weekend's dates and how far off it is", () => {
    expect(datesText("2026-12-04", "2026-12-06")).toBe("Dec 4–6, 2026");
    expect(datesText("2026-10-30", "2026-11-01")).toBe("Oct 30–Nov 1, 2026");
    expect(datesText("2026-10-18")).toBe("Oct 18, 2026");
    const now = new Date(2026, 9, 21, 15);
    expect(untilText("2026-12-04", "2026-12-06", now)).toBe("In 44 days");
    expect(untilText("2026-10-22", "2026-10-24", now)).toBe("Tomorrow");
    expect(untilText("2026-10-21", "2026-10-23", now)).toBe("Today");
    expect(untilText("2026-10-20", "2026-10-22", now)).toBe("Under way");
  });
});

describe("the live key on requests", () => {
  it("goes on live race URLs only, not the listing", () => {
    expect(needsLiveKey("/live")).toBe(false);
    expect(needsLiveKey("/live/sebring-2026-sunday/head")).toBe(true);
    expect(needsLiveKey("/live/next/wrl-2026-cota-race-1")).toBe(true);
    // A replay is open to everyone.
    expect(needsLiveKey("/live/replay-sebring-international-raceway-2026-sunday-7-hour/head")).toBe(false);
    expect(needsLiveKey("/live/replay-sebring-international-raceway-2026-sunday-7-hour/events")).toBe(false);
    expect(withLiveKey("/live/x/head", "abc")).toBe("/live/x/head?k=abc");
    expect(withLiveKey("/live/x?enc=2&v=0", "a b")).toBe("/live/x?enc=2&v=0&k=a%20b");
  });
});

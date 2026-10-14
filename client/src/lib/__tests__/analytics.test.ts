import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_EVENTS,
  recentEvents,
  setAnalyticsSender,
  track,
  type SentEvent,
} from "../analytics";

const last = () => recentEvents()[recentEvents().length - 1];

afterEach(() => {
  setAnalyticsSender(null);
  vi.unstubAllGlobals();
});

describe("analytics", () => {
  it("uses the shared event names, the same on both sites", () => {
    expect([...ANALYTICS_EVENTS].sort()).toEqual(
      [
        "alert_opt_in",
        "coffee_open",
        "follow_car",
        "on_target",
        "open_story",
        "record_hot",
        "share_card",
      ].sort()
    );
  });

  it("records the event with the site it came from", () => {
    track("coffee_open", { from: "header" });
    expect(last()).toMatchObject({
      event: "coffee_open",
      site: "racetrace",
      details: { from: "header" },
    });
  });

  it("never passes on names, email addresses or free text", () => {
    track("record_hot", {
      corners: 4,
      onTarget: true,
      email: "a@b.com",
      displayName: "Pat",
      referenceName: "INDY P2",
      notes: "x",
      track: "INDY",
      where: "pat@example.com",
      long: "x".repeat(41),
    });
    expect(last().details).toEqual({ corners: 4, onTarget: true, track: "INDY" });
  });

  it("sends nothing when the browser asks not to be tracked", () => {
    const before = recentEvents().length;
    const sent: SentEvent[] = [];
    setAnalyticsSender((e) => sent.push(e));
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    track("share_card");
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    track("share_card");
    expect(recentEvents().length).toBe(before);
    expect(sent).toEqual([]);
  });

  it("hands events to a connected service, and a failing service never breaks the page", () => {
    const sent: SentEvent[] = [];
    setAnalyticsSender((e) => sent.push(e));
    track("on_target", { worstMissPsi: 0.3 });
    expect(sent.map((e) => e.event)).toEqual(["on_target"]);
    setAnalyticsSender(() => {
      throw new Error("offline");
    });
    expect(() => track("alert_opt_in")).not.toThrow();
  });
});

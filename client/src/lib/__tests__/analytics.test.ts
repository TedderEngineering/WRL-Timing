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
        "alert_open",
        "alert_opt_in",
        "checklist_step",
        "coffee_open",
        "coffee_paid",
        "download_pdf",
        "pdf_failed",
        "follow_car",
        "follow_driver",
        "on_target",
        "open_story",
        "record_hot",
        "share_card",
        "share_app",
        "share_arrival",
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

describe("PostHog sender", () => {
  it("posts an anonymous event to the US capture endpoint, without the page address", async () => {
    const calls: { url: string; body: any; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), init });
      return new Response("{}");
    }) as unknown as typeof fetch;
    const { postHogSender } = await import("../analytics");
    const send = postHogSender("phc_test", "https://us.i.posthog.com/", fakeFetch);
    send({
      event: "on_target",
      site: "findinggrip",
      details: { worstMissPsi: 0.3 },
      at: Date.UTC(2026, 9, 14),
    });
    send({
      event: "record_hot",
      site: "findinggrip",
      details: {},
      at: Date.UTC(2026, 9, 14),
    });
    expect(calls[0].url).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(calls[0].init.keepalive).toBe(true);
    expect(calls[0].body).toMatchObject({
      api_key: "phc_test",
      event: "on_target",
      timestamp: "2026-10-14T00:00:00.000Z",
      properties: {
        worstMissPsi: 0.3,
        site: "findinggrip",
        $process_person_profile: false,
        $geoip_disable: true,
      },
    });
    expect(calls[0].body.properties).not.toHaveProperty("$current_url");
    // One random id for the visit, the same for each event, never an account id.
    expect(calls[0].body.distinct_id).toBe(calls[1].body.distinct_id);
    expect(calls[0].body.distinct_id).toMatch(/^[0-9a-f-]{36}$|^v-/);
  });

  it("knows the agreed event names", () => {
    for (const e of ["alert_open", "checklist_step", "coffee_paid"])
      expect(ANALYTICS_EVENTS).toContain(e);
  });
});

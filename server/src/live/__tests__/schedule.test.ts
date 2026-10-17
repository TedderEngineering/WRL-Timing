import { describe, expect, it } from "vitest";
import { feedUtc, sessionKind } from "../poller.js";
import { LIVE_SCHEDULE, upcomingSessions, type ScheduledSession } from "../schedule.js";

const race: ScheduledSession = {
  id: "wrl-test-race-2",
  series: "WRL",
  eventName: "Synthetic Park 2026",
  sessionName: "Race 2 · 7 Hour",
  track: "Synthetic Park",
  kind: "race",
  startsAt: "2026-10-18T08:00:00-04:00",
  endsAt: "2026-10-18T15:00:00-04:00",
  source: "test",
};
const at = (iso: string) => Date.parse(iso);

describe("upcomingSessions", () => {
  it("announces a session from a day and a half before until it ends, without its source note", () => {
    expect(upcomingSessions(at("2026-10-16T19:00:00Z"), [], [race])).toEqual([]);
    const u = upcomingSessions(at("2026-10-17T21:00:00Z"), [], [race]);
    expect(u.map((x) => x.id)).toEqual(["wrl-test-race-2"]);
    expect(u[0]).not.toHaveProperty("source");
    expect(upcomingSessions(at("2026-10-18T13:00:00Z"), [], [race]).length).toBe(1); // started, timing not open yet
    expect(upcomingSessions(at("2026-10-18T19:00:00Z"), [], [race])).toEqual([]); // over
  });
  it("gives way once the timing feed has the session (its timing opens before the green flag)", () => {
    const onFeed = [{ kind: "race" as const, startedAt: "2026-10-18T11:18:00.000Z" }];
    expect(upcomingSessions(at("2026-10-18T11:30:00Z"), onFeed, [race])).toEqual([]);
    // Practice on the same morning is not the race.
    expect(upcomingSessions(at("2026-10-18T11:30:00Z"), [{ kind: "practice", startedAt: "2026-10-18T11:18:00.000Z" }], [race]).length).toBe(1);
  });
  it("has Sebring Race 2 on the schedule for Sunday 18 October, 8 AM to 3 PM local", () => {
    const s = LIVE_SCHEDULE.find((x) => x.id === "wrl-2026-sebring-race-2")!;
    expect(new Date(s.startsAt).toISOString()).toBe("2026-10-18T12:00:00.000Z");
    expect(new Date(s.endsAt).toISOString()).toBe("2026-10-18T19:00:00.000Z");
  });
});

describe("feed session helpers", () => {
  it("reads the feed's zone-less times as UTC", () => {
    expect(feedUtc("2026-10-17T11:18:13.345109")).toBe("2026-10-17T11:18:13.345Z");
    expect(feedUtc(null)).toBeNull();
  });
  it("names practice, qualifying and race sessions", () => {
    expect(sessionKind({ pq: true, n: "GTO/GTU Qualifying" })).toBe("qualify");
    expect(sessionKind({ pq: true, n: "Race Practice 1" })).toBe("practice");
    expect(sessionKind({ pq: false, n: "Saturday 8 Hour" })).toBe("race");
  });
});

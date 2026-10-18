import { describe, expect, it } from "vitest";
import { bannerFor, countdownText, goesLiveText, sessionFor, shortEvent, whenText, type LiveListed } from "../banner";

const live = (over: Partial<LiveListed> = {}): LiveListed => ({
  slug: "sebring-international-raceway-2026-saturday-8-hour",
  eventName: "Sebring International Raceway 2026",
  sessionName: "Saturday 8 Hour",
  track: "Sebring International Raceway",
  startedAt: "2026-10-17T11:18:13.345Z",
  endedAt: null,
  kind: "race",
  status: { leaderLap: 112, flag: "Green" },
  ...over,
});
const race2 = {
  id: "wrl-2026-sebring-race-2",
  series: "WRL",
  eventName: "Sebring International Raceway 2026",
  sessionName: "Race 2 · 7 Hour",
  track: "Sebring International Raceway",
  kind: "race" as const,
  startsAt: "2026-10-18T08:00:00-04:00",
  endsAt: "2026-10-18T15:00:00-04:00",
};
const NY = "America/New_York";

describe("bannerFor", () => {
  it("shows a live race with its lap and flag, ahead of practice", () => {
    const b = bannerFor({ sessions: [live({ slug: "p", kind: "practice", sessionName: "Race Practice 1" }), live()] }, Date.now(), NY)!;
    expect(b).toMatchObject({ state: "live", when: "LIVE", what: "WRL Sebring · Saturday 8 Hour", detail: "Lap 112 · Green", action: "Watch live", more: 1 });
    expect(b.to).toBe("/live/sebring-international-raceway-2026-saturday-8-hour");
  });
  it("shows practice and qualifying when nothing else is live", () => {
    const q = bannerFor({ sessions: [live({ slug: "q", kind: "qualify", sessionName: "GTO/GTU Qualifying", status: null })] }, Date.now(), NY)!;
    expect(q.what).toBe("WRL Sebring · GTO/GTU Qualifying");
    expect(q.detail).toBeNull();
  });
  it("announces tomorrow's race the evening before, in the viewer's time", () => {
    const b = bannerFor({ sessions: [], upcoming: [race2] }, Date.parse("2026-10-17T22:00:00Z"), NY)!;
    expect(b).toMatchObject({ state: "upcoming", when: "Live tomorrow 8:00 AM EDT", what: "WRL Sebring · Race 2 · 7 Hour", to: "/live/next/wrl-2026-sebring-race-2", detail: null });
    expect(bannerFor({ sessions: [], upcoming: [race2] }, Date.parse("2026-10-18T11:18:00Z"), NY)!.when).toBe("Live in 42 min");
  });
  it("names the next race ahead of practice running now, and says the practice is live", () => {
    const b = bannerFor({ sessions: [live({ slug: "p", kind: "practice", sessionName: "Race Practice 4", status: null })], upcoming: [race2] }, Date.parse("2026-10-17T22:00:00Z"), NY)!;
    expect(b).toMatchObject({ state: "upcoming", when: "Live tomorrow 8:00 AM EDT", what: "WRL Sebring · Race 2 · 7 Hour", detail: "Race Practice 4 live now", to: "/live/next/wrl-2026-sebring-race-2" });
  });
  it("shows a live race rather than the next one", () => {
    expect(bannerFor({ sessions: [live()], upcoming: [race2] }, Date.parse("2026-10-17T22:00:00Z"), NY)!.state).toBe("live");
  });
  it("points to a session that just finished", () => {
    const b = bannerFor({ sessions: [], recent: [live({ endedAt: "2026-10-17T21:10:00Z" })] }, Date.now(), NY)!;
    expect(b).toMatchObject({ state: "finished", action: "See how it ended", key: "finished:sebring-international-raceway-2026-saturday-8-hour" });
  });
  it("is empty when nothing is on", () => {
    expect(bannerFor({ sessions: [], upcoming: [], recent: [] }, Date.now())).toBeNull();
  });
});

describe("helpers", () => {
  it("shortens the event to the track's name", () => {
    expect(shortEvent("Sebring International Raceway 2026", "Sebring International Raceway")).toBe("Sebring");
    expect(shortEvent("Barber Motorsports Park 2026", "")).toBe("Barber");
  });
  it("says today, tomorrow or the weekday", () => {
    const now = Date.parse("2026-10-18T09:00:00Z");
    expect(whenText("2026-10-18T19:00:00Z", now, NY)).toBe("Today 3:00 PM EDT");
    expect(whenText("2026-10-20T12:00:00Z", now, NY)).toBe("Tue 8:00 AM EDT");
    expect(whenText("2026-10-18T08:59:00Z", now, NY)).toBe("Starting now");
    expect(goesLiveText("2026-10-18T09:42:00Z", now, NY)).toBe("Live in 42 min");
    expect(goesLiveText("2026-10-18T19:00:00Z", now, NY)).toBe("Live today 3:00 PM EDT");
  });
});

describe("the pre-race page", () => {
  it("counts down in hours and minutes", () => {
    expect(countdownText("2026-10-18T12:00:00Z", Date.parse("2026-10-18T02:48:00Z"))).toBe("9 h 12 min");
    expect(countdownText("2026-10-18T12:00:00Z", Date.parse("2026-10-18T11:18:00Z"))).toBe("42 min");
    expect(countdownText("2026-10-18T12:00:00Z", Date.parse("2026-10-18T12:01:00Z"))).toBe("Starting now");
  });
  it("finds the live race once the timing has it, not before", () => {
    expect(sessionFor(race2, { sessions: [live({ slug: "practice", kind: "practice" })], upcoming: [race2] })).toBeNull();
    const s = sessionFor(race2, { sessions: [live({ slug: "practice", kind: "practice" }), live({ slug: "sebring-international-raceway-2026-sunday-7-hour" })], upcoming: [] });
    expect(s?.slug).toBe("sebring-international-raceway-2026-sunday-7-hour");
  });
});

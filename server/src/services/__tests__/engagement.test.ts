import { describe, expect, it, vi } from "vitest";
vi.mock("../../models/prisma.js", () => ({ prisma: {} }));
import { auditPublishTimes, computeEngagement, type EngagementInput, type EngagementRace } from "../engagement.js";

const now = new Date("2026-10-23T12:00:00Z");
const t = (iso: string) => new Date(iso);

function race(id: string, date: string, extra: Partial<EngagementRace> = {}): EngagementRace {
  return {
    id, name: `Pilot Challenge — ${id}`, date: t(`${date}T00:00:00Z`), track: "Michelin Raceway Road Atlanta", series: "IMSA",
    subSeries: "Pilot Challenge", season: 2026, eventId: `ev-${date}`, createdAt: t(`${date}T20:00:00Z`),
    entries: [{ carNumber: "67", teamName: "Blackdog Racing", driverNames: "Jane Driver, Sam Other" }, { carNumber: "8", teamName: "X", driverNames: "Ann Fast" }],
    ...extra,
  };
}

function input(over: Partial<EngagementInput> = {}): EngagementInput {
  return {
    now, days: 30,
    users: [
      { id: "u1", createdAt: t("2026-10-10T00:00:00Z") },
      { id: "u2", createdAt: t("2026-10-12T00:00:00Z") },
      { id: "u3", createdAt: t("2026-05-01T00:00:00Z") },
    ],
    cars: [{ userId: "u1", number: "67", series: "imsa", teamName: null, season: null, createdAt: t("2026-10-10T00:00:00Z") }],
    drivers: [{ userId: "u3", name: "Ann Fast", createdAt: t("2026-06-01T00:00:00Z") }, { userId: "admin", name: "Ann Fast", createdAt: t("2026-06-01T00:00:00Z") }],
    emailsOn: ["u1", "admin"],
    races: [race("ra", "2026-10-03")],
    auditPublished: new Map([["ra", t("2026-10-05T14:00:00Z")]]),
    alertSends: [{ userId: "u1", raceId: "ra", sentAt: t("2026-10-05T14:01:00Z"), officialSentAt: null }],
    views: [
      { userId: "u1", raceId: "ra", viewedAt: t("2026-10-06T09:00:00Z") }, // 19 h after publication
      { userId: "u3", raceId: "ra", viewedAt: t("2026-10-09T09:00:00Z") }, // 91 h: too late
      { userId: "u1", raceId: "ra", viewedAt: t("2026-10-08T09:00:00Z") },
    ],
    ...over,
  };
}

describe("engagement measures", () => {
  it("counts a weekend's followers and those who came back within 72 hours of publication", () => {
    const e = computeEngagement(input());
    expect(e.comeBack).toMatchObject({ weekends: 1, weekendsWithFollowers: 1, weekendsWithComeBack: 1, followerWeekends: 2, followerWeekendsCameBack: 1 });
    expect(e.comeBack.recent[0]).toMatchObject({ followers: 2, cameBack: 1, publishedFrom: "audit", publishedAt: "2026-10-05T14:00:00.000Z" });
  });

  it("takes the first race email as the publish time when the audit log has none, else the race's creation", () => {
    expect(computeEngagement(input({ auditPublished: new Map() })).comeBack.recent[0]).toMatchObject({ publishedFrom: "email", publishedAt: "2026-10-05T14:01:00.000Z" });
    expect(computeEngagement(input({ auditPublished: new Map(), alertSends: [] })).comeBack.recent[0]).toMatchObject({ publishedFrom: "created" });
  });

  it("gives follows per new account, leaving admins out", () => {
    const e = computeEngagement(input());
    expect(e.people).toEqual({ accounts: 3, following: 2, carsFollowed: 1, driversFollowed: 1, emailsOn: 1 });
    expect(e.follows).toEqual({ newAccounts: 2, newAccountsFollowing: 1, followsPerNewAccount: 0.5 });
  });

  it("counts race emails that led to the race being opened within a week", () => {
    expect(computeEngagement(input()).emails).toEqual({ sent: 1, officialSent: 0, opened: 1, openDays: 7 });
    const late = input({ views: [{ userId: "u1", raceId: "ra", viewedAt: t("2026-10-20T09:00:00Z") }] });
    expect(computeEngagement(late).emails.opened).toBe(0);
  });

  it("counts people opening races, and those who came back on another day", () => {
    expect(computeEngagement(input()).activity).toEqual({ peopleOpeningRaces: 2, cameBackAnotherDay: 1, raceOpens: 3 });
  });

  it("leaves out races published before the period", () => {
    const e = computeEngagement(input({ days: 7 }));
    expect(e.comeBack.weekends).toBe(0);
    expect(e.emails.sent).toBe(0);
  });

  it("reads publish times from the audit log's three publishing actions", () => {
    const m = auditPublishTimes([
      { action: "PUBLISH_RACE", targetId: "a", details: null, createdAt: t("2026-10-05T10:00:00Z") },
      { action: "UPDATE_RACE", targetId: "b", details: { status: "PUBLISHED" }, createdAt: t("2026-10-06T10:00:00Z") },
      { action: "UPDATE_RACE", targetId: "c", details: { name: "x" }, createdAt: t("2026-10-06T10:00:00Z") },
      { action: "PUBLISH_EVENT_RACES", targetId: "ev", details: { races: ["a", "d"] }, createdAt: t("2026-10-04T10:00:00Z") },
    ]);
    expect([...m.entries()].map(([k, v]) => [k, v.toISOString().slice(0, 10)]).sort()).toEqual([
      ["a", "2026-10-04"], ["b", "2026-10-06"], ["d", "2026-10-04"],
    ]);
  });
});

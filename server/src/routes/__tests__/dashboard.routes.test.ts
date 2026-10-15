/**
 * Dashboard routes (G6): latest weekends with recaps, season view, gating.
 * Prisma and package storage are in-memory fakes; the real app runs.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { gzipSync } from "node:zlib";
import request from "supertest";

const fake = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { races: [] as Row[], packages: [] as Row[], subs: new Map<string, Row>(), views: [] as Row[], cars: [] as Row[] };
  const prisma: Row = {
    race: {
      findMany: async ({ where = {}, take, select }: Row) => {
        let rows = state.races.filter(
          (r) =>
            (!where.status || r.status === where.status) &&
            (!where.season || r.season === where.season) &&
            (!where.createdAt?.lte || r.createdAt <= where.createdAt.lte) &&
            (!where.entries?.some || (r.entries ?? []).some((e: Row) => where.entries.some.carNumber.in.includes(e.carNumber))) &&
            (!where.id?.in || where.id.in.includes(r.id))
        );
        rows = rows.sort((a, b) => b.date - a.date || a.name.localeCompare(b.name));
        if (take) rows = rows.slice(0, take);
        const pick = (r: Row) =>
          Object.fromEntries(
            Object.keys(select).map((k) => [
              k,
              k === "entries" && select.entries.where ? (r.entries ?? []).filter((e: Row) => select.entries.where.carNumber.in.includes(e.carNumber)) : r[k],
            ])
          );
        return rows.map((r) => (select ? pick(r) : r));
      },
      findUnique: async ({ where }: Row) => state.races.find((r) => r.id === where.id) ?? null,
    },
    userCar: {
      findMany: async ({ where }: Row) => state.cars.filter((c) => c.userId === where.userId),
    },
    userPreferences: { findUnique: async () => null },
    // Pit laps per race (the weekend's feature races are listed first); races may carry `pitLaps`.
    raceLap: {
      findMany: async ({ where }: Row) =>
        state.races
          .filter((r) => where.raceId.in.includes(r.id))
          .flatMap((r) => Array.from({ length: r.pitLaps ?? 0 }, () => ({ raceId: r.id }))),
    },
    raceAnalysisPackage: { findUnique: async ({ where }: Row) => state.packages.find((p) => p.id === where.id) ?? null },
    subscription: { findUnique: async ({ where }: Row) => state.subs.get(where.userId) ?? null },
    userRaceView: {
      findFirst: async ({ where }: Row) => state.views.find((v) => v.userId === where.userId && v.raceId === where.raceId) ?? null,
      findMany: async ({ where }: Row) =>
        state.views
          .filter((v) => v.userId === where.userId && (!where.raceId?.in || where.raceId.in.includes(v.raceId)))
          .map((v) => ({ raceId: v.raceId, race: state.races.find((r) => r.id === v.raceId) })),
    },
  };
  return { state, prisma };
});

vi.mock("../../models/prisma.js", () => ({ prisma: fake.prisma }));
vi.mock("../../lib/supabase.js", () => ({ supabase: null, STORAGE_BUCKET: "race-files" }));
vi.mock("../../middleware/rate-limit.js", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return Object.fromEntries(Object.keys(orig).map((k) => [k, pass]));
});
const PUBLISHABLE = JSON.parse(
  fs.readFileSync(new URL("../../packages/__tests__/fixtures/publishable-package.json", import.meta.url), "utf8")
);
vi.mock("../../packages/store.js", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, getServedGzip: async () => gzipSync(Buffer.from(JSON.stringify(PUBLISHABLE), "utf8")) };
});

import { createApp } from "../../app.js";
import { generateAccessToken } from "../../utils/tokens.js";

const app = createApp();
const users = {
  pro: { userId: "u_pro", email: "pro@example.com", role: "USER" as const },
  free: { userId: "u_free", email: "free@example.com", role: "USER" as const },
};
const bearer = (u: (typeof users)[keyof typeof users]) => `Bearer ${generateAccessToken(u)}`;
const old = new Date("2026-10-11T12:00:00Z");

function race(id: string, date: string, name: string, track: string, series: string, extra: Record<string, unknown> = {}) {
  return {
    id, name, date: new Date(`${date}T00:00:00Z`), track, series, subSeries: null, eventId: null, season: 2026,
    status: "PUBLISHED", premium: false, createdAt: old, maxLap: 34, totalCars: 34,
    currentPackageId: null, packagesDisabled: false, resultsStatus: null, ...extra,
  };
}

const savedEnv = process.env.RACETRACE_PACKAGES;
afterAll(() => {
  process.env.RACETRACE_PACKAGES = savedEnv;
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T18:00:00Z"));
  process.env.RACETRACE_PACKAGES = "on";
  const s = fake.state;
  s.races = [
    race("gt4r1", "2026-10-10", "Pirelli GT4 Race 1 — Indianapolis Motor Speedway", "Indianapolis Motor Speedway", "SRO", { currentPackageId: "pkg1" }),
    race("gt4r2", "2026-10-11", "Pirelli GT4 Race 2 — Indianapolis Motor Speedway", "Indianapolis Motor Speedway", "SRO"),
    race("vir", "2026-08-22", "Virgina is For Racing Lovers Grand Prix", "Virginia International Raceway", "IMSA"),
    race("wrlsat", "2026-07-24", "Saturday 8-Hour", "Road Atlanta", "WRL"),
    race("wrlsun", "2026-07-24", "Sunday 7-Hour", "Road Atlanta", "WRL"),
  ];
  s.packages = [{ id: "pkg1", raceId: "gt4r1", status: "PUBLISHED", sha256: "abc", storagePath: "packages/gt4r1/v1.json.gz" }];
  s.subs = new Map([["u_pro", { plan: "PRO" }]]);
  s.views = [];
  s.cars = [];
});

describe("GET /api/dashboard/latest", () => {
  it("needs a signed-in user", async () => {
    expect((await request(app).get("/api/dashboard/latest")).status).toBe(401);
  });

  it("groups races into weekends, labels the round and attaches the package recap", async () => {
    const res = await request(app).get("/api/dashboard/latest").set("Authorization", bearer(users.pro));
    expect(res.status).toBe(200);
    const ev = res.body.events;
    expect(ev.map((e: any) => e.races.map((r: any) => r.id))).toEqual([["gt4r1", "gt4r2"], ["vir"], ["wrlsat", "wrlsun"]]);
    expect(ev[0]).toMatchObject({ seriesLabel: "Pirelli GT4 America", round: { number: 7, of: 7, name: "Indianapolis" }, isNew: true });
    expect(ev[1].round).toMatchObject({ number: 8, of: 10 });
    const [r1, r2] = ev[0].races;
    expect(r1.recap.headline).toEqual(PUBLISHABLE.raceSummary.headline);
    expect(r1.recap.classWinners.length).toBeGreaterThan(0);
    expect(r2.recap).toBeNull();
    expect(r2.session).toBe("Pirelli GT4 Race 2");
  });

  it("lists a weekend's longest race first but keeps the weekend's dates in order", async () => {
    fake.state.races[1] = { ...fake.state.races[1], maxLap: 40 };
    const res = await request(app).get("/api/dashboard/latest").set("Authorization", bearer(users.pro));
    const ev = res.body.events[0];
    expect(ev.races.map((r: any) => r.id)).toEqual(["gt4r2", "gt4r1"]);
    expect([ev.startDate, ev.endDate]).toEqual(["2026-10-10", "2026-10-11"]);
  });

  it("serves no recap while packages are switched off", async () => {
    process.env.RACETRACE_PACKAGES = "off";
    const res = await request(app).get("/api/dashboard/latest").set("Authorization", bearer(users.pro));
    expect(res.body.events[0].races[0].recap).toBeNull();
  });

  it("while RaceTrace is free, nothing is locked for a free member", async () => {
    const res = await request(app).get("/api/dashboard/latest").set("Authorization", bearer(users.free));
    expect(res.body.events.flatMap((e: any) => e.races).every((r: any) => !r.locked)).toBe(true);
  });

  it("with plans on, marks races a free member cannot open as locked and sends no recap for them", async () => {
    process.env.RACETRACE_FREE = "off";
    const res = await request(app).get("/api/dashboard/latest").set("Authorization", bearer(users.free));
    delete process.env.RACETRACE_FREE;
    const all = res.body.events.flatMap((e: any) => e.races);
    // free members get the three newest races
    expect(all.filter((r: any) => !r.locked).map((r: any) => r.id)).toEqual(["gt4r1", "gt4r2", "vir"]);
    expect(all.find((r: any) => r.id === "wrlsat")).toMatchObject({ locked: true, recap: null });
  });
});

describe("GET /api/dashboard/season", () => {
  it("returns each series round by round and the next round", async () => {
    const res = await request(app).get("/api/dashboard/season").set("Authorization", bearer(users.pro));
    expect(res.status).toBe(200);
    expect(res.body.season).toBe(2026);
    const wrl = res.body.series.find((s: any) => s.id === "wrl");
    expect(wrl.rounds[5]).toMatchObject({ name: "Road Atlanta", status: "on_site" });
    expect(wrl.rounds[6]).toMatchObject({ name: "Watkins Glen", status: "missing" });
    expect(res.body.next).toMatchObject({ seriesId: "wrl", name: "Sebring", start: "2026-10-16" });
    const gt4 = res.body.series.find((s: any) => s.id === "sro-gt4");
    expect(gt4.rounds[6].races.map((r: any) => r.id)).toEqual(["gt4r1", "gt4r2"]);
  });
});

describe("GET /api/dashboard/my-car", () => {
  const lap = (l: number, p: number, cp: number, ltSec: number, pit = 0) => ({ l, p, cp, ltSec, pit, flag: "GF", lt: "" });
  beforeEach(() => {
    const s = fake.state;
    const chart = {
      maxLap: 3,
      classCarCounts: { Silver: 2 },
      cars: {
        "68": { num: 68, team: "RAFA Racing Team", cls: "Silver", finishPos: 1, finishPosClass: 1, laps: [lap(1, 1, 1, 100), lap(2, 1, 1, 99), lap(3, 1, 1, 99.5)] },
        "131": { num: 131, team: "Other", cls: "Silver", finishPos: 2, finishPosClass: 2, laps: [lap(1, 2, 2, 101), lap(2, 2, 2, 100), lap(3, 2, 2, 100)] },
      },
    };
    for (const r of s.races) {
      r.subSeries = r.series === "SRO" ? "GT4 America" : null;
      r.entries = r.id.startsWith("gt4") ? [{ carNumber: "68", teamName: "RAFA Racing Team" }, { carNumber: "131", teamName: "Other" }] : [{ carNumber: "68", teamName: "Someone" }];
      r.chartData = chart;
      r.annotationData = {};
    }
  });

  it("says when the user follows no car", async () => {
    const res = await request(app).get("/api/dashboard/my-car").set("Authorization", bearer(users.pro));
    expect(res.body).toMatchObject({ carCount: 0, race: null });
  });

  it("finds the newest race of a followed car in its series, with facts and the package story", async () => {
    fake.state.cars = [{ id: "c1", userId: "u_pro", number: "68", series: "sro", teamName: null, season: 2026, label: null, carClass: null }];
    const res = await request(app).get("/api/dashboard/my-car").set("Authorization", bearer(users.pro));
    expect(res.status).toBe(200);
    expect(res.body.race).toMatchObject({ id: "gt4r2", locked: false });
    expect(res.body.facts).toMatchObject({ number: "68", cls: "Silver", finishClass: 1, classSize: 2, bestLapClassRank: 1 });
    expect(res.body.viewed).toBe(false);
  });

  it("shows a chosen car's latest race (?car=), and lists the user's cars for the tabs", async () => {
    fake.state.cars = [
      { id: "c1", userId: "u_pro", number: "68", series: "sro", teamName: null, season: null, label: null, carClass: null },
      { id: "c2", userId: "u_pro", number: "68", series: "wrl", teamName: null, season: null, label: "Our WRL car", carClass: null },
    ];
    const all = await request(app).get("/api/dashboard/my-car").set("Authorization", bearer(users.pro));
    expect(all.body.race.id).toBe("gt4r2");
    expect(all.body.cars.map((c: any) => c.id)).toEqual(["c1", "c2"]);
    const wrl = await request(app).get("/api/dashboard/my-car?car=c2").set("Authorization", bearer(users.pro));
    expect(wrl.body.car.id).toBe("c2");
    expect(wrl.body.race.id).toBe("wrlsat");
    // Someone else's car id is ignored: the newest race of the user's own cars.
    expect((await request(app).get("/api/dashboard/my-car?car=nope").set("Authorization", bearer(users.pro))).body.race.id).toBe("gt4r2");
  });

  it("uses the package's car story when the race has one", async () => {
    fake.state.races = fake.state.races.filter((r) => r.id !== "gt4r2");
    fake.state.cars = [{ id: "c1", userId: "u_pro", number: "68", series: "sro", teamName: null, season: null, label: null, carClass: null }];
    const res = await request(app).get("/api/dashboard/my-car").set("Authorization", bearer(users.pro));
    expect(res.body.race.id).toBe("gt4r1");
    const story = PUBLISHABLE.carStories.find((c: any) => c.car === "68");
    if (story) expect(res.body.story.headline).toEqual(story.headline);
    else expect(res.body.story).toBeNull();
  });

  it("does not take another series' car with the same number", async () => {
    fake.state.cars = [{ id: "c1", userId: "u_pro", number: "68", series: "wrl", teamName: null, season: null, label: null, carClass: null }];
    const res = await request(app).get("/api/dashboard/my-car").set("Authorization", bearer(users.pro));
    expect(res.body.race.id).toBe("wrlsat");
    fake.state.cars = [{ id: "c1", userId: "u_pro", number: "68", series: "imsa", teamName: "Nobody", season: null, label: null, carClass: null }];
    const none = await request(app).get("/api/dashboard/my-car").set("Authorization", bearer(users.pro));
    expect(none.body).toMatchObject({ carCount: 1, race: null });
  });
});

describe("GET /api/dashboard/season-recap", () => {
  const lap = (l: number, p: number, cp: number) => ({ l, p, cp, ltSec: 100, pit: 0, flag: "GF", lt: "" });
  const chart = (cp: number) => ({
    maxLap: 2, classCarCounts: { GS: 2 },
    cars: {
      "67": { num: 67, team: "Blackdog Racing", cls: "GS", finishPos: cp, finishPosClass: cp, laps: [lap(1, cp, cp), lap(2, cp, cp)] },
      "8": { num: 8, team: "X", cls: "GS", finishPos: 3 - cp, finishPosClass: 3 - cp, laps: [lap(1, 3 - cp, 3 - cp), lap(2, 3 - cp, 3 - cp)] },
    },
  });
  const mpc = (id: string, date: string, track: string, cp: number) => ({
    ...race(id, date, `Pilot Challenge — ${track}`, track, "IMSA"),
    subSeries: "Pilot Challenge",
    entries: [{ carNumber: "67", teamName: "Blackdog Racing" }, { carNumber: "8", teamName: "X" }],
    chartData: chart(cp),
    annotationData: {},
  });
  beforeEach(() => {
    fake.state.races = [
      mpc("seb", "2026-03-20", "Sebring International Raceway", 2),
      mpc("ra", "2026-10-02", "Michelin Raceway Road Atlanta", 1),
      { ...race("wrl", "2026-09-26", "WRL Saturday 8 Hour", "Utah Motorsports Campus", "WRL"), entries: [{ carNumber: "67", teamName: "Y" }], chartData: chart(1), annotationData: {} },
    ];
  });

  it("gives the IMSA car its season once Pilot Challenge's finale is on the site, and the WRL car nothing yet", async () => {
    fake.state.cars = [
      { id: "c1", userId: "u_pro", number: "67", series: "imsa", teamName: null, season: null, label: null, carClass: null },
      { id: "c2", userId: "u_pro", number: "67", series: "wrl", teamName: null, season: null, label: null, carClass: null },
    ];
    const res = await request(app).get("/api/dashboard/season-recap").set("Authorization", bearer(users.pro));
    expect(res.status).toBe(200);
    expect(res.body.recaps).toHaveLength(1);
    expect(res.body.recaps[0]).toMatchObject({ seriesId: "imsa-mpc", number: "67", races: 2, classWins: 1, podiums: 2, best: { finishClass: 1, raceId: "ra" } });
  });

  it("is empty without followed cars", async () => {
    const res = await request(app).get("/api/dashboard/season-recap").set("Authorization", bearer(users.pro));
    expect(res.body).toEqual({ season: 2026, recaps: [] });
  });
});

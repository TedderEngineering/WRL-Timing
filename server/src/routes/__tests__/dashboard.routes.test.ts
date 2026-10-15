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
  const state = { races: [] as Row[], packages: [] as Row[], subs: new Map<string, Row>(), views: [] as Row[] };
  const prisma: Row = {
    race: {
      findMany: async ({ where = {}, take, select }: Row) => {
        let rows = state.races.filter(
          (r) =>
            (!where.status || r.status === where.status) &&
            (!where.season || r.season === where.season) &&
            (!where.createdAt?.lte || r.createdAt <= where.createdAt.lte)
        );
        rows = rows.sort((a, b) => b.date - a.date || a.name.localeCompare(b.name));
        if (take) rows = rows.slice(0, take);
        return rows.map((r) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : r));
      },
    },
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

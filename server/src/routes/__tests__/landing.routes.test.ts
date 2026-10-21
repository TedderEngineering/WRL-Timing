import { describe, expect, it, vi } from "vitest";
import request from "supertest";

const race = {
  name: "WRL Sunday 7 Hour — Sebring International Raceway",
  date: new Date("2026-10-18T12:00:00Z"),
  track: "Sebring International Raceway",
  series: "WRL",
  resultsStatus: "unofficial",
  currentPackageId: null,
  packagesDisabled: false,
};

vi.mock("../../models/prisma.js", () => ({
  prisma: {
    race: {
      findFirst: vi.fn(async (q: { where: { id?: string } }) => (q.where.id && q.where.id !== "r1" ? null : race)),
      // The calendar's query (season) gets none; the stats' query gets 12 WRL and 5 IMSA races.
      findMany: vi.fn(async (q: { where: { season?: number } }) =>
        q.where.season !== undefined ? [] : [...Array(12).fill({ series: "WRL" }), ...Array(5).fill({ series: "IMSA" })]
      ),
    },
  },
}));
vi.mock("../../lib/supabase.js", () => ({ supabase: null, STORAGE_BUCKET: "race-files" }));
vi.mock("../../middleware/rate-limit.js", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return Object.fromEntries(Object.keys(orig).map((k) => [k, pass]));
});

import { createApp } from "../../app.js";
import { carsNamed } from "../landing.js";

const app = createApp();

describe("signed out", () => {
  it("sees the landing page's latest race and next weekends, and nothing else", async () => {
    const res = await request(app).get("/api/landing");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.body.latest).toMatchObject({ name: race.name, date: "2026-10-18", track: race.track, series: "WRL", official: false, headline: null });
    expect(res.body).toHaveProperty("next");
    expect(Array.isArray(res.body.upcoming)).toBe(true);
    expect(res.body.stats).toEqual({ races: 17, series: ["WRL", "IMSA"] });

    for (const path of ["/api/races", "/api/races/r1", "/api/races/r1/chart-data", "/api/races/r1/stories", "/api/events", "/api/search/cars?q=7", "/api/qualifying"]) {
      const r = await request(app).get(path);
      expect(r.status, path).toBe(401);
      expect(r.body.code, path).toBe("AUTH_REQUIRED");
    }
  });

  it("can see a published race's name (the log-in page names the race a link leads to)", async () => {
    const res = await request(app).get("/api/landing/race/r1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: race.name, track: race.track, date: "2026-10-18", series: "WRL" });
    expect((await request(app).get("/api/landing/race/nope")).status).toBe(404);
  });

  it("gets only the cars the headline names", () => {
    expect(carsNamed({ text: "{car:120} beat {car:119}; {driver:120:1} drove last, {class:GTO} {0}", refs: [] })).toEqual(["120", "119"]);
  });
});

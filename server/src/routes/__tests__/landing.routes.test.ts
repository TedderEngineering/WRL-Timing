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
    race: { findFirst: vi.fn(async () => race), findMany: vi.fn(async () => []) },
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

    for (const path of ["/api/races", "/api/races/r1", "/api/races/r1/chart-data", "/api/races/r1/stories", "/api/events", "/api/search/cars?q=7", "/api/qualifying"]) {
      const r = await request(app).get(path);
      expect(r.status, path).toBe(401);
      expect(r.body.code, path).toBe("AUTH_REQUIRED");
    }
  });

  it("gets only the cars the headline names", () => {
    expect(carsNamed({ text: "{car:120} beat {car:119}; {driver:120:1} drove last, {class:GTO} {0}", refs: [] })).toEqual(["120", "119"]);
  });
});

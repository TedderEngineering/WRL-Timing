/**
 * GET /api/races/:id/driver-card: one driver's share card for the race page's Drivers list.
 * Prisma is an in-memory fake; the real app runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const fake = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { races: [] as Row[], entries: [] as Row[] };
  const prisma: Row = {
    race: { findUnique: async ({ where }: Row) => state.races.find((r) => r.id === where.id) ?? null },
    raceEntry: { findMany: async ({ where }: Row) => state.entries.filter((e) => e.raceId === where.raceId) },
    raceAnalysisPackage: { findUnique: async () => null },
    subscription: { findUnique: async () => null },
    userPreferences: { findUnique: async () => null },
    userRaceView: { create: async () => ({}) },
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

import { createApp } from "../../app.js";

const app = createApp();

/** 20 laps of 100 s; a stop on lap 10 hands the car from Alex Rivera to Jamie Cole. */
function chart() {
  const laps = Array.from({ length: 20 }, (_, i) => ({ l: i + 1, p: 1, cp: 1, ltSec: i + 1 === 10 ? 160 : 100, pit: i + 1 === 10 ? 1 : 0, flag: "GF" }));
  return {
    maxLap: 20,
    totalCars: 1,
    fcy: [],
    cars: { "7": { num: 7, label: "007", team: "Rivera Racing", cls: "GS", finishPos: 1, laps } },
  };
}

beforeEach(() => {
  fake.state.races = [
    {
      id: "r1", name: "Sebring 8 Hour", date: new Date("2026-10-11T12:00:00Z"), track: "Sebring", series: "WRL",
      premium: false, createdAt: new Date("2026-10-11T22:00:00Z"), status: "PUBLISHED", resultsStatus: "official",
      chartData: chart(), annotationData: { "7": { pits: [{ l: 10, inDriver: "Alex Rivera", outDriver: "Jamie Cole" }] } },
      currentPackageId: null, packagesDisabled: false,
    },
  ];
  fake.state.entries = [
    { raceId: "r1", carNumber: "007", teamName: "Rivera Racing (USA)", carClass: "GS", driverNames: "Alex Rivera; Jamie Cole" },
  ];
});

describe("GET /api/races/:id/driver-card", () => {
  it("gives the race, the car and the driver's drive", async () => {
    const res = await request(app).get("/api/races/r1/driver-card?car=007&driver=Jamie%20Cole");
    expect(res.status).toBe(200);
    expect(res.body.race).toMatchObject({ id: "r1", name: "Sebring 8 Hour", date: "2026-10-11", locked: false });
    expect(res.body.car).toEqual({ number: "007", team: "Rivera Racing", cls: "GS", coDrivers: ["Alex Rivera"] });
    expect(res.body.facts).not.toBeNull();
    expect(res.body.driverFacts.known).toBe(true);
    expect(res.body.driverFacts.myStints).toBe(1);
    expect(res.body.driverFacts.stints.find((s: any) => s.mine)).toMatchObject({ start: 11, end: 20, avgLapS: 100 });
  });

  it("finds the car by the number it reduces to and the driver however spelled", async () => {
    const res = await request(app).get("/api/races/r1/driver-card?car=7&driver=jamie%20cole");
    expect(res.status).toBe(200);
    expect(res.body.car.number).toBe("007");
  });

  it("refuses a driver not in the car, a draft race and a missing car", async () => {
    expect((await request(app).get("/api/races/r1/driver-card?car=007&driver=Sam%20Hill")).status).toBe(404);
    expect((await request(app).get("/api/races/r1/driver-card?driver=Jamie%20Cole")).status).toBe(400);
    fake.state.races[0].status = "DRAFT";
    expect((await request(app).get("/api/races/r1/driver-card?car=007&driver=Jamie%20Cole")).status).toBe(404);
  });
});

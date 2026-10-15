/**
 * My cars (engagement plan B): /api/me/cars with an in-memory Prisma; the real app runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const fake = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { races: [] as Row[], cars: [] as Row[], seq: 0 };
  const pick = (r: Row, select?: Row) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : r);
  const prisma: any = {
    race: {
      findUnique: async ({ where, select }: Row) => {
        const r = state.races.find((x) => x.id === where.id);
        return r ? pick(r, select) : null;
      },
    },
    userCar: {
      findMany: async ({ where, select }: Row) => state.cars.filter((c) => c.userId === where.userId).map((c) => pick(c, select)),
      findUnique: async ({ where, select }: Row) => {
        const c = state.cars.find((x) => x.id === where.id);
        return c ? pick(c, select) : null;
      },
      count: async ({ where }: Row) => state.cars.filter((c) => c.userId === where.userId).length,
      create: async ({ data, select }: Row) => {
        const c = { id: `car${++state.seq}`, createdAt: new Date(Date.UTC(2026, 9, 15, 0, state.seq)), label: null, teamName: null, carClass: null, season: null, ...data };
        state.cars.push(c);
        return pick(c, select);
      },
      update: async ({ where, data, select }: Row) => {
        const c = state.cars.find((x) => x.id === where.id);
        Object.assign(c, data);
        return pick(c, select);
      },
      delete: async ({ where }: Row) => {
        state.cars = state.cars.filter((x) => x.id !== where.id);
      },
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

import { createApp } from "../../app.js";
import { generateAccessToken } from "../../utils/tokens.js";
import { carMatchesEntry, teamsMatch } from "../../services/my-cars.js";

const app = createApp();
const auth = (userId: string) => `Bearer ${generateAccessToken({ userId, email: `${userId}@example.com`, role: "USER" })}`;
const A = auth("u_a");
const B = auth("u_b");

beforeEach(() => {
  fake.state.cars = [];
  fake.state.seq = 0;
  fake.state.races = [
    {
      id: "vir26", series: "IMSA", subSeries: "Pilot Challenge", season: 2026, status: "PUBLISHED",
      entries: [
        { carNumber: "67", teamName: "Blackdog Racing", carClass: "GS" },
        { carNumber: "007", teamName: "Bond Motorsport", carClass: "TCR" },
      ],
    },
    { id: "draft", series: "IMSA", subSeries: null, season: 2026, status: "DRAFT", entries: [{ carNumber: "67", teamName: "X", carClass: "GS" }] },
    { id: "wrl25", series: "WRL", subSeries: null, season: 2025, status: "PUBLISHED", entries: [{ carNumber: "67", teamName: "Someone Else", carClass: "GP1" }] },
  ];
});

describe("matching a car to a race entry", () => {
  const race = { series: "IMSA", subSeries: "Pilot Challenge", season: 2026 };
  it("needs the series family and number; the team and season only when set", () => {
    expect(carMatchesEntry({ number: "67", series: "imsa" }, race, { carNumber: "67", teamName: "Blackdog Racing" })).toBe(true);
    expect(carMatchesEntry({ number: "7", series: "imsa" }, race, { carNumber: "007" })).toBe(true);
    expect(carMatchesEntry({ number: "67", series: "wrl" }, race, { carNumber: "67" })).toBe(false);
    expect(carMatchesEntry({ number: "67", series: "imsa", teamName: "Blackdog" }, race, { carNumber: "67", teamName: "Blackdog Racing" })).toBe(true);
    expect(carMatchesEntry({ number: "67", series: "imsa", teamName: "Other Team" }, race, { carNumber: "67", teamName: "Blackdog Racing" })).toBe(false);
    expect(carMatchesEntry({ number: "67", series: "imsa", season: 2025 }, race, { carNumber: "67" })).toBe(false);
  });
  it("compares team names without case or punctuation", () => {
    expect(teamsMatch("BLACKDOG RACING.", "Blackdog Racing")).toBe(true);
    expect(teamsMatch(null, "anything")).toBe(true);
    expect(teamsMatch("Blackdog", "")).toBe(false);
  });
});

describe("/api/me/cars", () => {
  it("needs an account", async () => {
    expect((await request(app).get("/api/me/cars")).status).toBe(401);
    expect((await request(app).post("/api/me/cars/follow").send({ raceId: "vir26", carNumber: "67" })).status).toBe(401);
  });

  it("follows a car from a race page with the race's series, team, class and season, once", async () => {
    const r1 = await request(app).post("/api/me/cars/follow").set("Authorization", A).send({ raceId: "vir26", carNumber: "67" });
    expect(r1.status).toBe(201);
    expect(r1.body.car).toMatchObject({ number: "67", series: "imsa", teamName: "Blackdog Racing", carClass: "GS", season: 2026 });
    const r2 = await request(app).post("/api/me/cars/follow").set("Authorization", A).send({ raceId: "vir26", carNumber: "67" });
    expect(r2.status).toBe(200);
    expect(r2.body.created).toBe(false);
    expect((await request(app).get("/api/me/cars").set("Authorization", A)).body.cars).toHaveLength(1);
  });

  it("says which of a race's cars the user follows; another series' #67 is not it", async () => {
    await request(app).post("/api/me/cars/follow").set("Authorization", A).send({ raceId: "vir26", carNumber: "7" });
    const vir = await request(app).get("/api/me/cars/in-race/vir26").set("Authorization", A);
    expect(vir.body.followed).toEqual([{ carNumber: "007", carId: "car1" }]);
    expect((await request(app).get("/api/me/cars/in-race/wrl25").set("Authorization", A)).body.followed).toEqual([]);
  });

  it("refuses a car not in the race, or a race that is not published", async () => {
    expect((await request(app).post("/api/me/cars/follow").set("Authorization", A).send({ raceId: "vir26", carNumber: "99" })).body.code).toBe("CAR_NOT_FOUND");
    expect((await request(app).post("/api/me/cars/follow").set("Authorization", A).send({ raceId: "draft", carNumber: "67" })).status).toBe(404);
  });

  it("adds, edits and removes cars by hand; validates the fields", async () => {
    const c = await request(app).post("/api/me/cars").set("Authorization", A).send({ number: "67", series: "wrl", label: "  " });
    expect(c.status).toBe(201);
    expect(c.body.car).toMatchObject({ number: "67", series: "wrl", label: null, season: null });
    const e = await request(app).patch(`/api/me/cars/${c.body.car.id}`).set("Authorization", A).send({ number: "68", season: 2027 });
    expect(e.body.car).toMatchObject({ number: "68", season: 2027 });
    expect((await request(app).post("/api/me/cars").set("Authorization", A).send({ number: "#67!", series: "wrl" })).status).toBe(400);
    expect((await request(app).post("/api/me/cars").set("Authorization", A).send({ number: "67", series: "nascar" })).status).toBe(400);
    expect((await request(app).delete(`/api/me/cars/${c.body.car.id}`).set("Authorization", A)).status).toBe(204);
    expect((await request(app).get("/api/me/cars").set("Authorization", A)).body.cars).toEqual([]);
  });

  it("never shows, edits or removes another user's car", async () => {
    const c = await request(app).post("/api/me/cars").set("Authorization", A).send({ number: "67", series: "wrl" });
    expect((await request(app).get("/api/me/cars").set("Authorization", B)).body.cars).toEqual([]);
    expect((await request(app).patch(`/api/me/cars/${c.body.car.id}`).set("Authorization", B).send({ number: "1" })).status).toBe(404);
    expect((await request(app).delete(`/api/me/cars/${c.body.car.id}`).set("Authorization", B)).status).toBe(404);
  });

  it("caps the list at 20 cars", async () => {
    for (let i = 1; i <= 20; i++) await request(app).post("/api/me/cars").set("Authorization", A).send({ number: String(i), series: "sro" });
    const r = await request(app).post("/api/me/cars").set("Authorization", A).send({ number: "21", series: "sro" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("TOO_MANY_CARS");
  });
});

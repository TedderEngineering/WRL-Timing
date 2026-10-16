/**
 * Chart defaults (Settings → Preferences): /api/me/chart-defaults with an in-memory Prisma.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const fake = vi.hoisted(() => {
  const prefs = new Map<string, Record<string, unknown>>();
  const prisma: any = {
    userPreferences: {
      findUnique: async ({ where }: any) => prefs.get(where.userId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        prefs.set(where.userId, { ...(prefs.get(where.userId) ?? create), ...update });
      },
    },
  };
  return { prefs, prisma };
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
import { normaliseChartDefaults } from "../../services/chart-defaults.js";

const app = createApp();
const auth = (userId: string) => `Bearer ${generateAccessToken({ userId, email: `${userId}@example.com`, role: "USER" })}`;
const DEFAULTS = { openOn: "my_car", classView: "all", axis: "laps", tab: "position" };

beforeEach(() => fake.prefs.clear());

describe("/api/me/chart-defaults", () => {
  it("starts at the defaults, saves a change per user, and returns every field", async () => {
    expect((await request(app).get("/api/me/chart-defaults").set("Authorization", auth("a"))).body).toEqual(DEFAULTS);
    const put = await request(app).put("/api/me/chart-defaults").set("Authorization", auth("a")).send({ classView: "focus_class", tab: "pitanalysis" });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ ...DEFAULTS, classView: "focus_class", tab: "pitanalysis" });
    // A later change keeps the earlier one.
    await request(app).put("/api/me/chart-defaults").set("Authorization", auth("a")).send({ axis: "both" });
    expect((await request(app).get("/api/me/chart-defaults").set("Authorization", auth("a"))).body).toEqual({ ...DEFAULTS, classView: "focus_class", tab: "pitanalysis", axis: "both" });
    expect((await request(app).get("/api/me/chart-defaults").set("Authorization", auth("b"))).body).toEqual(DEFAULTS);
  });

  it("refuses unknown fields and values, and needs a sign-in", async () => {
    expect((await request(app).put("/api/me/chart-defaults").set("Authorization", auth("a")).send({ tab: "nope" })).status).toBe(400);
    expect((await request(app).put("/api/me/chart-defaults").set("Authorization", auth("a")).send({ zoom: 3 })).status).toBe(400);
    expect((await request(app).get("/api/me/chart-defaults")).status).toBe(401);
  });

  it("reads an old or odd stored value as the defaults, field by field", () => {
    expect(normaliseChartDefaults(null)).toEqual(DEFAULTS);
    expect(normaliseChartDefaults({ showPits: true, axis: "hours", tab: 7 })).toEqual({ ...DEFAULTS, axis: "hours" });
  });
});

/**
 * Admin › Races, "Publish all drafts in this event": GET /api/admin/events/drafts and
 * POST /api/admin/events/:eventId/publish, with an in-memory Prisma; the real app runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const fake = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { races: [] as Row[], events: [] as Row[], audit: [] as Row[] };
  const pick = (r: Row, select?: Row) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : r);
  const matches = (r: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in v) return v.in.includes(r[k]);
      if (v && typeof v === "object" && "not" in v) return r[k] !== v.not;
      return r[k] === v;
    });
  const prisma: any = {
    race: {
      findMany: async ({ where, select }: Row) =>
        state.races
          .filter((r) => matches(r, where))
          .sort((a, b) => a.date - b.date || a.name.localeCompare(b.name))
          .map((r) => pick(r, select)),
      findUnique: async ({ where }: Row) => {
        const r = state.races.find((x) => x.id === where.id);
        return r ? { ...r } : null;
      },
      update: async ({ where, data }: Row) => Object.assign(state.races.find((r) => r.id === where.id)!, data),
    },
    event: {
      findMany: async ({ where, select }: Row) => state.events.filter((e) => matches(e, where)).map((e) => pick(e, select)),
      findUnique: async ({ where, select }: Row) => {
        const e = state.events.find((x) => x.id === where.id);
        return e ? pick(e, select) : null;
      },
      update: async ({ where, data }: Row) => Object.assign(state.events.find((e) => e.id === where.id)!, data),
    },
    auditLog: { create: async ({ data }: Row) => (state.audit.push(data), data) },
  };
  return { state, prisma, alerts: [] as string[] };
});

vi.mock("../../models/prisma.js", () => ({ prisma: fake.prisma }));
vi.mock("../../lib/supabase.js", () => ({ supabase: null, STORAGE_BUCKET: "race-files" }));
vi.mock("../../services/race-alerts.js", () => ({ queueRaceAlerts: (id: string) => void fake.alerts.push(id) }));
vi.mock("../../middleware/rate-limit.js", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return Object.fromEntries(Object.keys(orig).map((k) => [k, pass]));
});

import { createApp } from "../../app.js";
import { generateAccessToken } from "../../utils/tokens.js";

const app = createApp();
const admin = `Bearer ${generateAccessToken({ userId: "u_admin", email: "a@example.com", role: "ADMIN" })}`;
const user = `Bearer ${generateAccessToken({ userId: "u", email: "u@example.com", role: "USER" })}`;
const d = (s: string) => new Date(`${s}T00:00:00Z`);

beforeEach(() => {
  fake.alerts.length = 0;
  fake.state.audit = [];
  fake.state.events = [
    { id: "ra", name: "Road Atlanta", series: "IMSA", track: "Road Atlanta", status: "PUBLISHED" },
    { id: "indy", name: "Indianapolis", series: "SRO", track: "Indianapolis Motor Speedway", status: "DRAFT" },
  ];
  fake.state.races = [
    { id: "r1", name: "MX-5 Cup Race 1", date: d("2026-10-01"), eventId: "ra", status: "DRAFT" },
    { id: "r2", name: "WeatherTech", date: d("2026-10-03"), eventId: "ra", status: "DRAFT" },
    { id: "r3", name: "Pilot Challenge", date: d("2026-10-02"), eventId: "ra", status: "PUBLISHED" },
    { id: "g1", name: "GT4 Race 1", date: d("2026-10-10"), eventId: "indy", status: "DRAFT" },
    { id: "lone", name: "Uploaded by hand", date: d("2026-10-11"), eventId: null, status: "DRAFT" },
  ];
});

describe("drafts by event", () => {
  it("lists events with drafts, newest first, with their dates and how many are already out", async () => {
    const res = await request(app).get("/api/admin/events/drafts").set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body.events.map((e: any) => e.eventId)).toEqual(["indy", "ra"]);
    expect(res.body.events[1]).toMatchObject({
      name: "Road Atlanta",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      publishedCount: 1,
      drafts: [{ id: "r1" }, { id: "r2" }],
    });
  });

  it("publishes every draft of one event, sends each its race emails, and logs it", async () => {
    const res = await request(app).post("/api/admin/events/ra/publish").set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body.published.map((r: any) => r.id)).toEqual(["r1", "r2"]);
    expect(fake.state.races.filter((r) => r.eventId === "ra").every((r) => r.status === "PUBLISHED")).toBe(true);
    expect(fake.state.races.find((r) => r.id === "g1")!.status).toBe("DRAFT");
    expect(fake.alerts).toEqual(["r1", "r2"]);
    expect(fake.state.audit[0]).toMatchObject({ action: "PUBLISH_EVENT_RACES", targetId: "ra", details: { count: 2 } });
  });

  it("publishes a draft event along with its races", async () => {
    await request(app).post("/api/admin/events/indy/publish").set("Authorization", admin);
    expect(fake.state.events.find((e) => e.id === "indy")!.status).toBe("PUBLISHED");
  });

  it("is admin-only, and 404s an unknown event", async () => {
    expect((await request(app).post("/api/admin/events/ra/publish").set("Authorization", user)).status).toBe(403);
    expect((await request(app).post("/api/admin/events/nope/publish").set("Authorization", admin)).status).toBe(404);
  });
});

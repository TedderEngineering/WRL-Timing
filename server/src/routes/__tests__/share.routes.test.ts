import { describe, expect, it, vi } from "vitest";
import request from "supertest";

const fake = vi.hoisted(() => {
  const lap = (l: number, p: number, cp: number) => ({ l, p, cp, ltSec: 100, pit: 0, flag: "GF", lt: "" });
  const races: Record<string, any> = {
    pub: {
      id: "pub", name: "Pilot Challenge — Michelin GT Challenge at VIR", date: new Date(Date.UTC(2026, 7, 22)), track: "VIRginia International Raceway",
      status: "PUBLISHED", resultsStatus: "official",
      chartData: { maxLap: 2, classCarCounts: { GS: 1 }, cars: { "67": { num: 67, team: "Blackdog <Racing>", cls: "GS", finishPos: 1, finishPosClass: 1, laps: [lap(1, 1, 1), lap(2, 1, 1)] } } },
      annotationData: {},
    },
    draft: { id: "draft", name: "Secret", date: new Date(), track: "X", status: "DRAFT" },
  };
  return { prisma: { race: { findUnique: async ({ where }: any) => races[where.id] ?? null } } };
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

describe("shared race links", () => {
  it("give chat apps the race's own title and description, then open the race", async () => {
    const r = await request(app).get("/api/share/r/pub");
    expect(r.status).toBe(200);
    expect(r.text).toContain('<meta property="og:title" content="Pilot Challenge — Michelin GT Challenge at VIR · RaceTrace" />');
    expect(r.text).toContain("racetrace-og.png");
    expect(r.text).toMatch(/http-equiv="refresh" content="0; url=[^"]*\/chart\?race=pub&amp;from=share"/);
  });

  it("state a named car's finish, escaping what teams typed", async () => {
    const r = await request(app).get("/api/share/r/pub?car=67");
    expect(r.text).toContain("#67 Blackdog &lt;Racing&gt;: P1 in GS · Pilot Challenge");
    expect(r.text).toContain("race=pub&amp;car=67&amp;from=share");
    expect(r.text).not.toContain("<Racing>");
  });

  it("never show a draft, and ignore a malformed car", async () => {
    const d = await request(app).get("/api/share/r/draft");
    expect(d.status).toBe(302);
    expect(d.text).not.toContain("Secret");
    const bad = await request(app).get('/api/share/r/pub?car="><script>');
    expect(bad.text).not.toContain("<script>");
    expect(bad.text).toContain("race=pub&amp;from=share");
  });
});

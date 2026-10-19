/**
 * Request body limits (app.ts): 1 MB by default and for anonymous requests; larger only for
 * signed-in requests to the routes that upload whole files as JSON.
 */
import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));
vi.mock("../../lib/supabase.js", () => ({ supabase: null, STORAGE_BUCKET: "race-files" }));
vi.mock("../../middleware/rate-limit.js", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return Object.fromEntries(Object.keys(orig).map((k) => [k, pass]));
});

import { createApp } from "../../app.js";

const app = createApp();
const body = (bytes: number) => JSON.stringify({ text: "x".repeat(bytes) });

describe("request body limits", () => {
  it("refuses a body over 1 MB on an ordinary route", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send(body(1_200_000));
    expect(res.status).toBe(413);
  });

  it("refuses a large body to an admin route without a token, before auth", async () => {
    const res = await request(app).post("/api/admin/races").set("Content-Type", "application/json").send(body(2_000_000));
    expect(res.status).toBe(413);
  });

  it("reads a large body to an admin route with a token (then auth decides)", async () => {
    const res = await request(app)
      .post("/api/admin/races")
      .set("Authorization", "Bearer not-a-real-token")
      .set("Content-Type", "application/json")
      .send(body(2_000_000));
    expect(res.status).toBe(401);
  });

  it("reads a small body as before", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send({ email: "a@b.c", password: "x" });
    expect(res.status).not.toBe(413);
  });
});

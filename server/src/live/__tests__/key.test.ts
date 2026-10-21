import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));

import { LIVE_KEY_PERIOD_MS, currentLiveKey, liveKeyFor, liveKeyValid } from "../key.js";
import { liveRouter } from "../../routes/live.js";
import { generateAccessToken } from "../../utils/tokens.js";
import { errorHandler } from "../../middleware/error-handler.js";

describe("the live key", () => {
  const t = Date.UTC(2026, 9, 18, 14, 30);

  it("changes every hour and accepts this hour's and the last hour's", () => {
    const now = currentLiveKey(t);
    expect(now.k).toHaveLength(22);
    expect(now.renewAt).toBe("2026-10-18T15:00:00.000Z");
    expect(liveKeyValid(now.k, t)).toBe(true);
    expect(liveKeyValid(now.k, t + LIVE_KEY_PERIOD_MS)).toBe(true); // the next hour still takes it
    expect(liveKeyValid(now.k, t + 2 * LIVE_KEY_PERIOD_MS)).toBe(false);
    expect(liveKeyValid(liveKeyFor(Math.floor(t / LIVE_KEY_PERIOD_MS) + 1), t)).toBe(false); // not a future key
    expect(liveKeyValid("x".repeat(22), t)).toBe(false);
    expect(liveKeyValid(undefined, t)).toBe(false);
  });

  it("is given to signed-in viewers only, and the race URLs refuse anyone without it", async () => {
    const app = express();
    app.use("/api/live", liveRouter);
    app.use(errorHandler);
    expect((await request(app).get("/api/live/key")).status).toBe(401);
    const token = generateAccessToken({ userId: "u1", email: "a@b.c", role: "USER" } as any);
    const key = await request(app).get("/api/live/key").set("Authorization", `Bearer ${token}`);
    expect(key.status).toBe(200);
    expect(key.headers["cache-control"]).toBe("private, no-store");
    expect(liveKeyValid(key.body.k)).toBe(true);

    for (const path of ["/some-race/head", "/some-race/pos", "/some-race/track", "/some-race/entries", "/some-race/full/1/2", "/some-race/d/1/2", "/next/x"]) {
      const res = await request(app).get(`/api/live${path}`);
      expect(res.status, path).toBe(401);
      expect(res.body.code).toBe("LIVE_KEY_REQUIRED");
      expect(res.headers["cdn-cache-control"]).toBe("no-store");
    }
    expect((await request(app).get("/api/live/some-race")).status).toBe(401);
  });
});

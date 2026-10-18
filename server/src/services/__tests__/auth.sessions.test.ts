import { beforeEach, describe, it, expect, vi } from "vitest";

// ─── In-memory refresh_tokens / users (only what the session code uses) ──────
const db = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { tokens: [] as Row[], users: new Map<string, Row>(), seq: 0 };
  const cmp = (v: any, c: any): boolean => {
    if (c === null) return v === null || v === undefined;
    if (c instanceof Date) return v instanceof Date && v.getTime() === c.getTime();
    if (typeof c === "object") {
      if ("not" in c) return c.not === null ? v !== null && v !== undefined : !cmp(v, c.not);
      if ("in" in c) return c.in.includes(v);
      if ("gt" in c || "gte" in c || "lt" in c || "lte" in c) {
        const t = v instanceof Date ? v.getTime() : v;
        if (t === null || t === undefined) return false;
        if ("gt" in c && !(t > c.gt.getTime())) return false;
        if ("gte" in c && !(t >= c.gte.getTime())) return false;
        if ("lt" in c && !(t < c.lt.getTime())) return false;
        if ("lte" in c && !(t <= c.lte.getTime())) return false;
        return true;
      }
    }
    return v === c;
  };
  const match = (r: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, c]) => (k === "OR" ? (c as Row[]).some((w) => match(r, w)) : cmp(r[k], c)));
  const order = (rows: Row[], orderBy?: Row) => {
    if (!orderBy) return rows;
    const [k, dir] = Object.entries(orderBy)[0];
    return [...rows].sort((a, b) => ((a[k]?.getTime?.() ?? 0) - (b[k]?.getTime?.() ?? 0)) * (dir === "desc" ? -1 : 1));
  };
  const prisma = {
    refreshToken: {
      findMany: async ({ where, orderBy }: Row) => order(state.tokens.filter((r) => match(r, where)), orderBy),
      findFirst: async ({ where, orderBy }: Row) => order(state.tokens.filter((r) => match(r, where)), orderBy)[0] ?? null,
      create: async ({ data }: Row) => {
        const row = { id: `t${++state.seq}`, createdAt: new Date(), revokedAt: null, rotatedAt: null, ...data };
        state.tokens.push(row);
        return row;
      },
      updateMany: async ({ where, data }: Row) => {
        const rows = state.tokens.filter((r) => match(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      deleteMany: async ({ where }: Row) => {
        const before = state.tokens.length;
        state.tokens = state.tokens.filter((r) => !match(r, where));
        return { count: before - state.tokens.length };
      },
    },
    user: {
      findUnique: async ({ where }: Row) => state.users.get(where.id) ?? null,
      update: async ({ where, data }: Row) => Object.assign(state.users.get(where.id)!, data),
    },
  };
  return { state, prisma };
});

vi.mock("../../models/prisma.js", () => ({ prisma: db.prisma }));
vi.mock("../../config/env.js", () => ({
  env: { NODE_ENV: "test", JWT_ACCESS_SECRET: "x".repeat(32), JWT_REFRESH_SECRET: "y".repeat(32) },
}));

import {
  isReplayAfterGrace,
  LOST_REPLY_WINDOW_MS,
  pruneTokens,
  refresh,
  ROTATION_GRACE_MS,
  startSession,
} from "../auth.js";
import { deviceClassOf, sessionsToDisplace } from "../../config/sessionLimits.js";
import { getRefreshTokenExpiry, hashToken } from "../../utils/tokens.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const LAPTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";

const user = (id: string, role: "USER" | "ADMIN" = "USER") => ({
  id,
  email: `${id}@example.com`,
  displayName: id,
  avatarUrl: null,
  role,
  emailVerified: true,
  onboardingDone: true,
  createdAt: new Date("2026-01-01"),
  subscription: null,
  suspendedAt: null,
});

beforeEach(() => {
  db.state.tokens = [];
  db.state.users = new Map();
  db.state.seq = 0;
});

const signIn = async (id: string, ua: string, role: "USER" | "ADMIN" = "USER") => {
  if (!db.state.users.has(id)) db.state.users.set(id, user(id, role));
  return startSession(db.state.users.get(id) as any, { userAgent: ua, ipAddress: "1.2.3.4" });
};
const live = (id: string) => db.state.tokens.filter((t) => t.userId === id && !t.revokedAt && !t.rotatedAt);
const rowOf = (token: string) => db.state.tokens.find((t) => t.tokenHash === hashToken(token))!;

describe("device kinds", () => {
  it("phones are phones; tablets, iPads and computers are the other kind", () => {
    expect(deviceClassOf(IPHONE)).toBe("phone");
    expect(deviceClassOf(ANDROID_PHONE)).toBe("phone");
    expect(deviceClassOf(ANDROID_TABLET)).toBe("computer");
    expect(deviceClassOf(IPAD)).toBe("computer");
    expect(deviceClassOf(LAPTOP)).toBe("computer");
    expect(deviceClassOf(null)).toBe("unknown");
  });

  it("a new sign-in displaces the same kind, then unknown or oldest sessions over two", () => {
    const at = (s: number) => new Date(2026, 0, 1, 0, 0, s);
    const rows = [
      { id: "a", userAgent: LAPTOP, createdAt: at(1) },
      { id: "b", userAgent: null, createdAt: at(2) },
      { id: "c", userAgent: IPHONE, createdAt: at(3) },
    ];
    expect(sessionsToDisplace(rows, "phone").sort()).toEqual(["b", "c"]);
    expect(sessionsToDisplace(rows, "computer").sort()).toEqual(["a", "b"]);
    expect(sessionsToDisplace(rows, "unknown").sort()).toEqual(["a", "b"]);
  });
});

describe("device limit: one phone and one tablet or computer", () => {
  it("keeps a phone and a laptop signed in together", async () => {
    await signIn("u1", IPHONE);
    await signIn("u1", LAPTOP);
    expect(live("u1").map((t) => deviceClassOf(t.userAgent)).sort()).toEqual(["computer", "phone"]);
  });

  it("a second phone signs out the first phone only", async () => {
    const first = await signIn("u1", IPHONE);
    await signIn("u1", LAPTOP);
    await signIn("u1", ANDROID_PHONE);
    expect(rowOf(first.refreshToken).revokedAt).toBeInstanceOf(Date);
    expect(live("u1").map((t) => t.userAgent).sort()).toEqual([ANDROID_PHONE, LAPTOP].sort());
  });

  it("an iPad replaces the laptop, not the phone", async () => {
    await signIn("u1", IPHONE);
    await signIn("u1", LAPTOP);
    await signIn("u1", IPAD);
    expect(live("u1").map((t) => t.userAgent).sort()).toEqual([IPAD, IPHONE].sort());
  });

  it("the displaced browser is told which kind of device signed in", async () => {
    const first = await signIn("u1", IPHONE);
    await signIn("u1", ANDROID_PHONE);
    await expect(refresh(first.refreshToken, new Date(), { userAgent: IPHONE })).rejects.toMatchObject({
      code: "SESSION_DISPLACED",
      message: expect.stringContaining("another phone"),
    });
  });

  it("admin accounts have no limit", async () => {
    await signIn("boss", IPHONE, "ADMIN");
    await signIn("boss", ANDROID_PHONE, "ADMIN");
    await signIn("boss", LAPTOP, "ADMIN");
    await signIn("boss", IPAD, "ADMIN");
    expect(live("boss")).toHaveLength(4);
  });
});

describe("sessions last 90 days and keep their device", () => {
  it("expires 90 days after the last renewal", () => {
    const days = (getRefreshTokenExpiry().getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(90);
  });

  it("a renewed session keeps the device it was signed in on", async () => {
    const s = await signIn("u1", IPHONE);
    const r = await refresh(s.refreshToken, new Date(), { userAgent: IPHONE });
    expect(r.refreshToken).toBeTruthy();
    expect(rowOf(r.refreshToken!).userAgent).toBe(IPHONE);
  });
});

describe("refresh token rotation grace", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("treats a token that was never rotated as fresh", () => {
    expect(isReplayAfterGrace({ rotatedAt: null }, now)).toBe(false);
  });

  it("honours a just-rotated token (a concurrent refresh from another tab or site)", () => {
    expect(isReplayAfterGrace({ rotatedAt: ago(1_000) }, now)).toBe(false);
    expect(isReplayAfterGrace({ rotatedAt: ago(ROTATION_GRACE_MS) }, now)).toBe(false);
  });

  it("flags reuse after the window for the lost-reply check", () => {
    expect(isReplayAfterGrace({ rotatedAt: ago(ROTATION_GRACE_MS + 1) }, now)).toBe(true);
  });
});

describe("a renewal whose reply was lost (dropped signal)", () => {
  it("is recovered when the replacement was never used: no sign-out anywhere", async () => {
    const phone = await signIn("u1", IPHONE);
    const laptop = await signIn("u1", LAPTOP);
    const t0 = new Date();
    // The phone renews, but the reply carrying the new token never arrives.
    const lost = await refresh(phone.refreshToken, t0, { userAgent: IPHONE });
    expect(lost.refreshToken).toBeTruthy();
    // Ten minutes later the phone tries again with the old token.
    const later = new Date(t0.getTime() + 10 * 60_000);
    const again = await refresh(phone.refreshToken, later, { userAgent: IPHONE });
    expect(again.refreshToken).toBeTruthy();
    expect(db.state.tokens.find((t) => t.tokenHash === hashToken(lost.refreshToken!))).toBeUndefined();
    // The laptop is still signed in.
    expect(rowOf(laptop.refreshToken).revokedAt).toBeNull();
    const l = await refresh(laptop.refreshToken, later, { userAgent: LAPTOP });
    expect(l.refreshToken).toBeTruthy();
  });

  it("is treated as a copied token when the replacement was already used", async () => {
    const phone = await signIn("u1", IPHONE);
    await signIn("u1", LAPTOP);
    const t0 = new Date();
    const next = await refresh(phone.refreshToken, t0, { userAgent: IPHONE });
    await refresh(next.refreshToken!, new Date(t0.getTime() + 60_000), { userAgent: IPHONE });
    await expect(
      refresh(phone.refreshToken, new Date(t0.getTime() + 10 * 60_000), { userAgent: IPHONE })
    ).rejects.toMatchObject({ code: "TOKEN_REVOKED" });
    expect(db.state.tokens.filter((t) => t.userId === "u1")).toHaveLength(0);
  });

  it("is refused from a different browser, or after the recovery window", async () => {
    const a = await signIn("u1", IPHONE);
    const t0 = new Date();
    await refresh(a.refreshToken, t0, { userAgent: IPHONE });
    await expect(
      refresh(a.refreshToken, new Date(t0.getTime() + 10 * 60_000), { userAgent: LAPTOP })
    ).rejects.toMatchObject({ code: "TOKEN_REVOKED" });

    const b = await signIn("u2", IPHONE);
    await refresh(b.refreshToken, t0, { userAgent: IPHONE });
    await expect(
      refresh(b.refreshToken, new Date(t0.getTime() + LOST_REPLY_WINDOW_MS + 60_000), { userAgent: IPHONE })
    ).rejects.toMatchObject({ code: "TOKEN_REVOKED" });
  });
});

describe("pruning used-up tokens", () => {
  it("keeps the newest used-up tokens per browser for the recovery window, drops the rest", async () => {
    const now = new Date();
    const mins = (m: number) => new Date(now.getTime() - m * 60_000);
    const add = (id: string, ua: string, rotatedAt: Date | null) =>
      db.state.tokens.push({ id, userId: "u1", tokenHash: id, userAgent: ua, createdAt: mins(10_000), rotatedAt, revokedAt: null, expiresAt: getRefreshTokenExpiry() });
    add("p1", IPHONE, mins(10));
    add("p2", IPHONE, mins(20));
    add("p3", IPHONE, mins(30));
    add("l1", LAPTOP, mins(10));
    add("old", LAPTOP, new Date(now.getTime() - LOST_REPLY_WINDOW_MS - 60_000));
    add("live", IPHONE, null);
    await pruneTokens("u1", now);
    expect(db.state.tokens.map((t) => t.id).sort()).toEqual(["l1", "live", "p1", "p2"]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  apiToken: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("../../models/prisma.js", () => ({ prisma: db }));
vi.mock("../../config/env.js", () => ({
  env: { NODE_ENV: "test", JWT_ACCESS_SECRET: "x".repeat(32), JWT_REFRESH_SECRET: "y".repeat(32) },
}));

import {
  evaluateApiToken,
  generateApiToken,
  hashApiToken,
  hasScope,
  tokenMatchesHash,
  toPublicToken,
  type ApiTokenRecord,
} from "../api-tokens.js";
import { requireAdmin, requireAuth, rejectApiToken } from "../../middleware/auth.js";
import { generateAccessToken } from "../../utils/tokens.js";

const now = new Date("2026-10-13T12:00:00Z");
const admin = { id: "u1", email: "owner@example.com", role: "ADMIN", suspendedAt: null };
function rec(over: Partial<ApiTokenRecord> = {}): ApiTokenRecord {
  return {
    id: "t1",
    name: "Laptop intake",
    tokenHash: "h",
    prefix: "rt_abcdefgh",
    scopes: ["intake"],
    createdById: "u1",
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdBy: admin,
    ...over,
  };
}

describe("token generation and hashing", () => {
  it("makes rt_ tokens with 256 bits of randomness, a display prefix and a sha256 hash", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.token).toMatch(/^rt_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.prefix).toBe(a.token.slice(0, 11));
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).toBe(hashApiToken(a.token));
    expect(a.tokenHash).not.toContain(a.token.slice(3));
    expect(tokenMatchesHash(a.token, a.tokenHash)).toBe(true);
    expect(tokenMatchesHash(b.token, a.tokenHash)).toBe(false);
  });

  it("the public view never contains the hash", () => {
    const pub = toPublicToken({ ...rec(), createdAt: now, createdBy: { email: "owner@example.com" } });
    expect(JSON.stringify(pub)).not.toContain('"tokenHash"');
    expect(pub).toMatchObject({ prefix: "rt_abcdefgh", createdBy: "owner@example.com", scopes: ["intake"] });
  });
});

describe("evaluateApiToken", () => {
  it.each([
    [null, "TOKEN_UNKNOWN"],
    [rec({ revokedAt: new Date("2026-10-12T00:00:00Z") }), "TOKEN_REVOKED"],
    [rec({ expiresAt: new Date("2026-10-13T11:59:59Z") }), "TOKEN_EXPIRED"],
    [rec({ createdBy: { ...admin, role: "USER" } }), "TOKEN_OWNER_NOT_ADMIN"],
    [rec({ createdBy: { ...admin, suspendedAt: new Date() } }), "TOKEN_OWNER_SUSPENDED"],
  ])("refuses %#: %s", (r, code) => {
    const c = evaluateApiToken(r as ApiTokenRecord | null, now);
    expect(c.ok).toBe(false);
    expect(!c.ok && c.code).toBe(code);
  });

  it("accepts a live token of an admin; scope is checked separately", () => {
    expect(evaluateApiToken(rec({ expiresAt: new Date("2027-01-01T00:00:00Z") }), now)).toEqual({ ok: true });
    expect(hasScope(["intake"], "intake")).toBe(true);
    expect(hasScope([], "intake")).toBe(false);
    expect(hasScope(null, "intake")).toBe(false);
  });
});

function run(mw: (req: any, res: any, next: any) => void, req: any): Promise<any> {
  return new Promise((resolve) => mw(req, {}, (err?: any) => resolve(err ?? null)));
}

describe("auth middleware with API tokens", () => {
  beforeEach(() => {
    db.apiToken.findUnique.mockReset();
    db.apiToken.update.mockReset().mockResolvedValue({});
  });

  it("requireAuth looks the token up by its hash and acts as the creating admin", async () => {
    const { token, tokenHash } = generateApiToken();
    db.apiToken.findUnique.mockResolvedValue(rec({ tokenHash }));
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    expect(await run(requireAuth, req)).toBeNull();
    expect(db.apiToken.findUnique.mock.calls[0][0].where).toEqual({ tokenHash });
    expect(req.user).toEqual({ userId: "u1", email: "owner@example.com", role: "ADMIN" });
    expect(req.apiToken).toMatchObject({ id: "t1", scopes: ["intake"] });
    expect(await run(requireAdmin, req)).toBeNull();
    expect(db.apiToken.update).toHaveBeenCalledTimes(1); // lastUsedAt
  });

  it("does not write lastUsedAt more than once a minute", async () => {
    const { token } = generateApiToken();
    db.apiToken.findUnique.mockResolvedValue(rec({ lastUsedAt: new Date(Date.now() - 5_000) }));
    await run(requireAuth, { headers: { authorization: `Bearer ${token}` } });
    expect(db.apiToken.update).not.toHaveBeenCalled();
  });

  it("a revoked token is a 401", async () => {
    db.apiToken.findUnique.mockResolvedValue(rec({ revokedAt: new Date() }));
    const err = await run(requireAuth, { headers: { authorization: `Bearer ${generateApiToken().token}` } });
    expect(err).toMatchObject({ statusCode: 401, code: "TOKEN_REVOKED" });
  });

  it("an unknown token is a 401", async () => {
    db.apiToken.findUnique.mockResolvedValue(null);
    const err = await run(requireAuth, { headers: { authorization: "Bearer rt_nottherealtoken" } });
    expect(err).toMatchObject({ statusCode: 401, code: "TOKEN_UNKNOWN" });
  });

  it("requireAdmin refuses a token without the intake scope", async () => {
    db.apiToken.findUnique.mockResolvedValue(rec({ scopes: [] }));
    const req: any = { headers: { authorization: `Bearer ${generateApiToken().token}` } };
    expect(await run(requireAuth, req)).toBeNull();
    expect(await run(requireAdmin, req)).toMatchObject({ statusCode: 403, code: "TOKEN_SCOPE_REQUIRED" });
  });

  it("tokens cannot manage tokens; a signed-in admin can", async () => {
    expect(await run(rejectApiToken, { apiToken: { id: "t1" } })).toMatchObject({ statusCode: 403, code: "SESSION_REQUIRED" });
    const jwt = generateAccessToken({ userId: "u1", email: "owner@example.com", role: "ADMIN" });
    const req: any = { headers: { authorization: `Bearer ${jwt}` } };
    expect(await run(requireAuth, req)).toBeNull();
    expect(req.apiToken).toBeUndefined();
    expect(await run(requireAdmin, req)).toBeNull();
    expect(await run(rejectApiToken, req)).toBeNull();
    expect(db.apiToken.findUnique).not.toHaveBeenCalled();
  });
});

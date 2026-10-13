/**
 * Machine API tokens (RaceTrace 2.0, G4 intake).
 *
 * - A token is "rt_" + 43 base64url characters (32 random bytes).
 * - Only its sha256 is stored. Tokens are high-entropy random strings, so a
 *   fast hash is the right choice: it allows an indexed lookup, and there is
 *   nothing to brute-force. The token is shown once, at creation.
 * - `prefix` (the first 11 characters) identifies a token in the admin UI.
 * - A token acts as the admin who created it, only while that user is still
 *   an admin and not suspended, and only until it expires or is revoked.
 * - Scopes limit what it can do: `intake` lets requireAdmin accept it.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../models/prisma.js";

export const API_TOKEN_PREFIX = "rt_";
export const API_TOKEN_SCOPES = ["intake"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/** lastUsedAt is written at most this often per token. */
export const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export function isApiTokenString(s: string | undefined | null): boolean {
  return typeof s === "string" && s.startsWith(API_TOKEN_PREFIX);
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateApiToken(): { token: string; tokenHash: string; prefix: string } {
  const token = API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, tokenHash: hashApiToken(token), prefix: token.slice(0, 11) };
}

/** Constant-time comparison of a presented token with a stored hash. */
export function tokenMatchesHash(token: string, tokenHash: string): boolean {
  const a = Buffer.from(hashApiToken(token), "hex");
  const b = Buffer.from(tokenHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ApiTokenRecord {
  id: string;
  name: string;
  tokenHash: string;
  prefix: string;
  scopes: string[];
  createdById: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdBy: { id: string; email: string; role: string; suspendedAt: Date | null } | null;
}

export type ApiTokenCheck =
  | { ok: true }
  | { ok: false; code: "TOKEN_UNKNOWN" | "TOKEN_REVOKED" | "TOKEN_EXPIRED" | "TOKEN_OWNER_NOT_ADMIN" | "TOKEN_OWNER_SUSPENDED"; message: string };

/** Pure validity check of a looked-up token (no scope check; see hasScope). */
export function evaluateApiToken(rec: ApiTokenRecord | null, now: Date = new Date()): ApiTokenCheck {
  if (!rec) return { ok: false, code: "TOKEN_UNKNOWN", message: "Invalid API token" };
  if (rec.revokedAt) return { ok: false, code: "TOKEN_REVOKED", message: "This API token has been revoked" };
  if (rec.expiresAt && rec.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, code: "TOKEN_EXPIRED", message: "This API token has expired" };
  }
  if (!rec.createdBy || rec.createdBy.role !== "ADMIN") {
    return { ok: false, code: "TOKEN_OWNER_NOT_ADMIN", message: "The account that created this API token is no longer an admin" };
  }
  if (rec.createdBy.suspendedAt) {
    return { ok: false, code: "TOKEN_OWNER_SUSPENDED", message: "The account that created this API token is suspended" };
  }
  return { ok: true };
}

export function hasScope(scopes: readonly string[] | null | undefined, scope: ApiTokenScope): boolean {
  return Array.isArray(scopes) && scopes.includes(scope);
}

export interface AuthenticatedApiToken {
  user: { userId: string; email: string; role: "ADMIN" };
  token: { id: string; name: string; prefix: string; scopes: string[] };
}

/**
 * Look up a presented token. Returns the identity it acts as, or the reason
 * it is refused. Updates lastUsedAt (throttled; never blocks the request).
 */
export async function authenticateApiToken(
  presented: string,
  now: Date = new Date()
): Promise<{ ok: true; auth: AuthenticatedApiToken } | Extract<ApiTokenCheck, { ok: false }>> {
  const rec = (await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(presented) },
    include: { createdBy: { select: { id: true, email: true, role: true, suspendedAt: true } } },
  })) as ApiTokenRecord | null;
  const check = evaluateApiToken(rec, now);
  if (!check.ok) return check;
  const r = rec!;
  if (!r.lastUsedAt || now.getTime() - r.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    prisma.apiToken.update({ where: { id: r.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  }
  return {
    ok: true,
    auth: {
      user: { userId: r.createdBy!.id, email: r.createdBy!.email, role: "ADMIN" },
      token: { id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes ?? [] },
    },
  };
}

/** Public view of a token (never the hash). */
export function toPublicToken(r: Omit<ApiTokenRecord, "createdBy"> & { createdAt: Date; createdBy?: { email: string } | null }) {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes,
    createdAt: r.createdAt,
    createdBy: r.createdBy?.email ?? null,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
  };
}

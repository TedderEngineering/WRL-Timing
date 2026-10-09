import jwt from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env.js";

export interface AccessTokenPayload {
  userId: string;
  email: string;
  role: "USER" | "ADMIN";
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
}

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
const EMAIL_VERIFY_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export function generateAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function generateRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}

/**
 * Generate a cryptographically random token for email verification or password reset.
 * Returns both the raw token (to send in the link) and its hash (to store in DB).
 */
export function generateSecureToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getEmailVerifyExpiry(): Date {
  return new Date(Date.now() + EMAIL_VERIFY_EXPIRY_MS);
}

export function getPasswordResetExpiry(): Date {
  return new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);
}

export function getRefreshTokenExpiry(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
}

// ─── Refresh cookie ──────────────────────────────────────────────────────────
//
// Two modes:
//  - COOKIE_DOMAIN unset (original): cookie "refresh_token" on whichever host
//    answered. In production that host is not under tedderengineering.com, so
//    it is SameSite=None, i.e. a third-party cookie to the sites.
//  - COOKIE_DOMAIN set (e.g. ".tedderengineering.com"): cookie "te_session" on
//    that parent domain, SameSite=Lax. First-party on every subdomain, so one
//    login covers RaceTrace, Finding Grip and Setup Sheet, and browsers that
//    block third-party cookies keep it.
// A different name in domain mode means the old host-only cookie can never be
// mistaken for the new one. It is still read once, so nobody is signed out by
// the switch, and cleared whenever the new one is set.

type SameSite = "none" | "lax";

export const LEGACY_REFRESH_COOKIE = "refresh_token";
const DOMAIN_REFRESH_COOKIE = "te_session";
const REFRESH_COOKIE_PATH = "/api/auth";
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

/** COOKIE_DOMAIN as a cookie Domain attribute, or null when unset or unusable. */
export function cookieDomain(raw: string | undefined = env.COOKIE_DOMAIN): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  const bare = value.replace(/^\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare)) return null;
  return `.${bare}`;
}

export function refreshCookieName(): string {
  return cookieDomain() ? DOMAIN_REFRESH_COOKIE : LEGACY_REFRESH_COOKIE;
}

function baseCookieOptions() {
  const domain = cookieDomain();
  const production = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: production || !!domain,
    sameSite: (domain ? "lax" : production ? "none" : "lax") as SameSite,
    path: REFRESH_COOKIE_PATH,
    ...(domain ? { domain } : {}),
  };
}

/** Cookie options for the refresh token */
export function refreshCookieOptions() {
  return { ...baseCookieOptions(), maxAge: REFRESH_COOKIE_MAX_AGE };
}

interface CookieRequest {
  cookies?: Record<string, string | undefined>;
}
interface CookieResponse {
  cookie(name: string, value: string, options: object): unknown;
  clearCookie(name: string, options: object): unknown;
}

/** The refresh token the browser sent, from the current cookie or the legacy one. */
export function readRefreshCookie(req: CookieRequest): string | undefined {
  return req.cookies?.[refreshCookieName()] ?? req.cookies?.[LEGACY_REFRESH_COOKIE];
}

export function setRefreshCookie(res: CookieResponse, token: string): void {
  if (cookieDomain()) clearLegacyCookie(res);
  res.cookie(refreshCookieName(), token, refreshCookieOptions());
}

/** Clear the refresh cookie with the same attributes it was set with (and the legacy one). */
export function clearRefreshCookie(res: CookieResponse): void {
  res.clearCookie(refreshCookieName(), baseCookieOptions());
  if (cookieDomain()) clearLegacyCookie(res);
}

function clearLegacyCookie(res: CookieResponse): void {
  const production = env.NODE_ENV === "production";
  res.clearCookie(LEGACY_REFRESH_COOKIE, {
    httpOnly: true,
    secure: production,
    sameSite: production ? "none" : "lax",
    path: REFRESH_COOKIE_PATH,
  });
}

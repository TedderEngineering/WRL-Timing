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

/** Cookie options for the refresh token */
export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

import bcrypt from "bcrypt";
import { prisma } from "../models/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../middleware/error-handler.js";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateSecureToken,
  hashToken,
  getEmailVerifyExpiry,
  getPasswordResetExpiry,
  getRefreshTokenExpiry,
} from "../utils/tokens.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "./email.js";
import type { Site } from "./site.js";
import { deviceClassOf, deviceWord, sessionLimitApplies, sessionsToDisplace } from "../config/sessionLimits.js";

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: "USER" | "ADMIN";
    emailVerified: boolean;
    onboardingDone: boolean;
    createdAt: Date;
    subscription: {
      plan: string;
      status: string;
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
    };
  };
}

function formatSubscription(
  sub: {
    plan: string;
    status: string;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  } | null
) {
  return sub
    ? {
        plan: sub.plan,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      }
    : {
        plan: "FREE" as const,
        status: "ACTIVE" as const,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      };
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(
  email: string,
  password: string,
  displayName?: string,
  meta: SessionMeta = {},
  site?: Site
): Promise<AuthResult> {
  // Check if email already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(409, "An account with this email already exists", "EMAIL_TAKEN");
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  // Create user + subscription in a transaction
  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email,
        passwordHash,
        displayName: displayName || null,
      },
    });

    // Create free subscription record
    await tx.subscription.create({
      data: {
        userId: newUser.id,
        plan: "FREE",
        status: "ACTIVE",
      },
    });

    return newUser;
  });

  // Generate email verification token
  const { token: verifyToken, hash: verifyHash } = generateSecureToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: verifyHash,
      expiresAt: getEmailVerifyExpiry(),
    },
  });

  // Send verification email (async, don't block registration)
  sendVerificationEmail(user.email, verifyToken, site).catch((err) =>
    console.error("Failed to send verification email:", err)
  );

  // Generate tokens
  const { accessToken, refreshToken } = await createTokenPair(
    user.id,
    user.email,
    user.role,
    meta
  );

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      emailVerified: user.emailVerified,
      onboardingDone: user.onboardingDone,
      createdAt: user.createdAt,
      subscription: formatSubscription(null), // Just created — always FREE
    },
  };
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(
  email: string,
  password: string,
  meta: SessionMeta = {}
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { subscription: true },
  });
  if (!user) {
    throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }

  if (user.suspendedAt) {
    throw new AppError(403, "Your account has been suspended", "ACCOUNT_SUSPENDED");
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }

  return startSession(user, meta);
}

/**
 * Sign a user in: last-login time, the device limit (oldest sessions revoked), and a new token
 * pair. Shared by password login and sign-in with another account (services/oauth.ts).
 */
export async function startSession(
  user: {
    id: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: "USER" | "ADMIN";
    emailVerified: boolean;
    onboardingDone: boolean;
    createdAt: Date;
    subscription: { plan: string; status: string; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean } | null;
  },
  meta: SessionMeta = {}
): Promise<AuthResult> {
  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // Device limit (config/sessionLimits.ts): one phone and one tablet or computer; a new sign-in
  // displaces the earlier session of the same kind. Admin accounts have no limit.
  if (sessionLimitApplies(user.role)) {
    const activeSessions = await prisma.refreshToken.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
        rotatedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "asc" },
    });
    const toRevoke = sessionsToDisplace(activeSessions, deviceClassOf(meta.userAgent));
    if (toRevoke.length) {
      await prisma.refreshToken.updateMany({
        where: { id: { in: toRevoke } },
        data: { revokedAt: new Date() },
      });
    }
  }

  const { accessToken, refreshToken } = await createTokenPair(
    user.id,
    user.email,
    user.role,
    meta
  );

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      emailVerified: user.emailVerified,
      onboardingDone: user.onboardingDone,
      createdAt: user.createdAt,
      subscription: formatSubscription(user.subscription),
    },
  };
}

// ─── Refresh Token ────────────────────────────────────────────────────────────

/**
 * How long a just-rotated refresh token is still honoured. Two tabs (or two
 * sites sharing the login cookie) can refresh at the same moment with the same
 * token; the one that loses the race gets a fresh access token instead of
 * being treated as a stolen token, which would sign the user out everywhere.
 */
export const ROTATION_GRACE_MS = 30 * 1000;

export async function refresh(
  oldRefreshToken: string,
  now: Date = new Date(),
  meta: SessionMeta = {}
): Promise<Omit<AuthResult, "refreshToken"> & { refreshToken: string | null }> {
  let payload;
  try {
    payload = verifyRefreshToken(oldRefreshToken);
  } catch {
    throw new AppError(401, "Invalid or expired refresh token", "INVALID_REFRESH_TOKEN");
  }

  // Find the stored token
  const storedToken = await prisma.refreshToken.findFirst({
    where: {
      userId: payload.userId,
      tokenHash: hashToken(oldRefreshToken),
    },
  });

  if (!storedToken) {
    // A token we never issued or already removed: treat as stolen and sign out everywhere.
    await prisma.refreshToken.deleteMany({ where: { userId: payload.userId } });
    throw new AppError(401, "Refresh token has been revoked", "TOKEN_REVOKED");
  }

  // Check if this session was displaced by a newer login
  if (storedToken.revokedAt) {
    // Keep the revoked row until it expires (background cleanup removes it):
    // deleting it here would make a second, concurrent request from the same
    // displaced browser find no row and take the token-theft path, which signs
    // out every device, including the one that just signed in.
    throw displacedError(storedToken.userAgent);
  }

  // Rotation: mark the old token used rather than deleting it, so a request
  // that raced this one can still be answered during the grace window. The
  // conditional update means only one concurrent request rotates it.
  let rotated = false;
  if (storedToken.rotatedAt === null) {
    rotated =
      (
        await prisma.refreshToken.updateMany({
          where: { id: storedToken.id, rotatedAt: null },
          data: { rotatedAt: now },
        })
      ).count === 1;
  } else if (isReplayAfterGrace(storedToken, now)) {
    const r = await recoverLostReply(storedToken, now, meta);
    if (r === "theft") {
      // Its replacement was already used somewhere: a copied token. Sign out everywhere.
      await prisma.refreshToken.deleteMany({ where: { userId: payload.userId } });
      throw new AppError(401, "Refresh token has been revoked", "TOKEN_REVOKED");
    }
    if (r === "displaced") throw displacedError(storedToken.userAgent);
    rotated = r === "recovered";
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { subscription: true },
  });
  if (!user || user.suspendedAt) {
    throw new AppError(401, "Account not found or suspended", "INVALID_ACCOUNT");
  }

  // Lost the race: the winner has already set the new cookie in this browser.
  // Hand back an access token only and leave the cookie alone.
  // The new session keeps the device it was signed in on (the device limit reads it).
  const { accessToken, refreshToken } = rotated
    ? await createTokenPair(user.id, user.email, user.role, {
        ipAddress: meta.ipAddress ?? storedToken.ipAddress ?? null,
        userAgent: storedToken.userAgent ?? meta.userAgent ?? null,
      })
    : {
        accessToken: generateAccessToken({
          userId: user.id,
          email: user.email,
          role: user.role,
        }),
        refreshToken: null,
      };

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      emailVerified: user.emailVerified,
      onboardingDone: user.onboardingDone,
      createdAt: user.createdAt,
      subscription: formatSubscription(user.subscription),
    },
  };
}

function displacedError(userAgent: string | null): AppError {
  const word = deviceWord(deviceClassOf(userAgent));
  return new AppError(
    401,
    `You were signed out here because your account signed in on another ${word}. If this wasn't you, change your password.`,
    "SESSION_DISPLACED"
  );
}

/**
 * How long after a rotation a lost reply can still be recovered. A phone that lost signal just as
 * its session renewed keeps the old token; it comes back at the next renewal, or when the app is
 * opened again days later.
 */
export const LOST_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Where the replacement row is looked for, around the old token's rotation time. */
const SUCCESSOR_BEFORE_MS = 5_000;
const SUCCESSOR_AFTER_MS = 60_000;

/**
 * A rotated token presented after the grace window. If its replacement was never used, the browser
 * never received the reply that carried it (a dropped connection): the replacement is dropped and
 * the browser gets a new session ("recovered"). If the replacement was used, the old token is a
 * copy ("theft"). If another request recovered it a moment ago, answer like the grace window
 * ("raced"). Too old, or from another browser: "theft".
 */
export async function recoverLostReply(
  stored: { id: string; userId: string; rotatedAt: Date | null; userAgent: string | null },
  now: Date,
  meta: SessionMeta
): Promise<"recovered" | "raced" | "theft" | "displaced"> {
  if (!stored.rotatedAt) return "theft";
  if (now.getTime() - stored.rotatedAt.getTime() > LOST_REPLY_WINDOW_MS) return "theft";
  if (stored.userAgent && meta.userAgent && stored.userAgent !== meta.userAgent) return "theft";

  const successor = await prisma.refreshToken.findFirst({
    where: {
      userId: stored.userId,
      id: { not: stored.id },
      ...(stored.userAgent ? { userAgent: stored.userAgent } : {}),
      createdAt: {
        gte: new Date(stored.rotatedAt.getTime() - SUCCESSOR_BEFORE_MS),
        lte: new Date(stored.rotatedAt.getTime() + SUCCESSOR_AFTER_MS),
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!successor) return "theft";
  if (successor.revokedAt) return "displaced";
  if (successor.rotatedAt) return "theft";

  // Claim the old token for this request only; a request that raced this one finds it claimed.
  const claimed =
    (
      await prisma.refreshToken.updateMany({
        where: { id: stored.id, rotatedAt: stored.rotatedAt },
        data: { rotatedAt: now },
      })
    ).count === 1;
  if (!claimed) return "raced";
  await prisma.refreshToken.deleteMany({ where: { id: successor.id, rotatedAt: null } });
  return "recovered";
}

/** A token that was already rotated, presented again after the grace window. */
export function isReplayAfterGrace(
  token: { rotatedAt: Date | null },
  now: Date = new Date()
): boolean {
  return !!token.rotatedAt && now.getTime() - token.rotatedAt.getTime() > ROTATION_GRACE_MS;
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(refreshTokenValue: string): Promise<void> {
  const tokenHash = hashToken(refreshTokenValue);
  await prisma.refreshToken.deleteMany({ where: { tokenHash } });
  // Also drop this user's just-rotated tokens, so a token replaced in the last
  // few seconds can't keep getting access tokens through the grace window.
  try {
    const { userId } = verifyRefreshToken(refreshTokenValue);
    await prisma.refreshToken.deleteMany({ where: { userId, rotatedAt: { not: null } } });
  } catch {
    // Expired or malformed: nothing more to clean up.
  }
}

export async function logoutAll(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}

// ─── Forgot Password ─────────────────────────────────────────────────────────

export async function forgotPassword(email: string, site?: Site): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Always succeed to prevent email enumeration
  if (!user) return;

  // Invalidate existing reset tokens
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const { token, hash } = generateSecureToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hash,
      expiresAt: getPasswordResetExpiry(),
    },
  });

  await sendPasswordResetEmail(user.email, token, site);
}

// ─── Reset Password ──────────────────────────────────────────────────────────

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(token);

  const resetToken = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!resetToken) {
    throw new AppError(400, "Invalid or expired reset link", "INVALID_RESET_TOKEN");
  }

  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    // Update password
    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });

    // Mark token as used
    await tx.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    // Invalidate all refresh tokens (force re-login)
    await tx.refreshToken.deleteMany({ where: { userId: resetToken.userId } });
  });
}

// ─── Email Verification ──────────────────────────────────────────────────────

export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = hashToken(token);

  const verifyToken = await prisma.emailVerificationToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!verifyToken) {
    throw new AppError(
      400,
      "Invalid or expired verification link",
      "INVALID_VERIFY_TOKEN"
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: verifyToken.userId },
      data: { emailVerified: true },
    });

    await tx.emailVerificationToken.update({
      where: { id: verifyToken.id },
      data: { usedAt: new Date() },
    });
  });
}

// ─── Resend Verification ─────────────────────────────────────────────────────

export async function resendVerification(userId: string, site?: Site): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError(404, "User not found", "USER_NOT_FOUND");
  }

  if (user.emailVerified) {
    throw new AppError(400, "Email is already verified", "ALREADY_VERIFIED");
  }

  // Check rate limit: last token created within 1 minute
  const recentToken = await prisma.emailVerificationToken.findFirst({
    where: {
      userId,
      createdAt: { gt: new Date(Date.now() - 60 * 1000) },
    },
  });

  if (recentToken) {
    throw new AppError(
      429,
      "Please wait before requesting another email",
      "RATE_LIMITED"
    );
  }

  const { token, hash } = generateSecureToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hash,
      expiresAt: getEmailVerifyExpiry(),
    },
  });

  await sendVerificationEmail(user.email, token, site);
}

// ─── Get Current User ────────────────────────────────────────────────────────

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });

  if (!user) {
    throw new AppError(404, "User not found", "USER_NOT_FOUND");
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    emailVerified: user.emailVerified,
    onboardingDone: user.onboardingDone,
    createdAt: user.createdAt,
    subscription: formatSubscription(user.subscription),
  };
}

// ─── Complete Onboarding ──────────────────────────────────────────────────────

export async function completeOnboarding(userId: string, theme?: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { onboardingDone: true },
    });

    const validTheme = ["light", "dark", "system"].includes(theme ?? "")
      ? theme!
      : "system";

    await tx.userPreferences.upsert({
      where: { userId },
      create: { userId, theme: validTheme },
      update: { theme: validTheme },
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export interface SessionMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

async function createTokenPair(
  userId: string,
  email: string,
  role: "USER" | "ADMIN",
  meta: SessionMeta = {}
) {
  const accessToken = generateAccessToken({ userId, email, role });

  // Create refresh token record
  const tokenId = crypto.randomUUID();
  const refreshToken = generateRefreshToken({ userId, tokenId });
  const refreshHash = hashToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: refreshHash,
      expiresAt: getRefreshTokenExpiry(),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

  // Clean up expired and used-up refresh tokens for this user (background).
  // Displaced (revoked) sessions are kept until they expire: the displaced
  // browser must find its row to be told SESSION_DISPLACED. If the row were
  // gone, its next refresh would look like token theft and sign the user out
  // of every device, including the one that just signed in.
  // The newest used-up tokens per browser are kept for LOST_REPLY_WINDOW_MS, so a
  // renewal whose reply was lost can be recovered (recoverLostReply).
  pruneTokens(userId).catch(() => {});

  return { accessToken, refreshToken };
}

/** Used-up tokens kept per browser for lost-reply recovery. */
const KEEP_ROTATED_PER_BROWSER = 2;

export async function pruneTokens(userId: string, now: Date = new Date()): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: now } } });
  const used = await prisma.refreshToken.findMany({
    where: { userId, rotatedAt: { not: null } },
    orderBy: { rotatedAt: "desc" },
    select: { id: true, rotatedAt: true, userAgent: true },
  });
  const kept = new Map<string, number>();
  const drop: string[] = [];
  for (const t of used) {
    const age = now.getTime() - (t.rotatedAt as Date).getTime();
    if (age <= ROTATION_GRACE_MS) continue;
    const key = t.userAgent ?? "";
    const n = kept.get(key) ?? 0;
    if (age <= LOST_REPLY_WINDOW_MS && n < KEEP_ROTATED_PER_BROWSER) {
      kept.set(key, n + 1);
      continue;
    }
    drop.push(t.id);
  }
  if (drop.length) await prisma.refreshToken.deleteMany({ where: { id: { in: drop } } });
}

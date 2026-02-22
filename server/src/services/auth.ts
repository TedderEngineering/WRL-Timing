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
  };
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(
  email: string,
  password: string,
  displayName?: string
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
  sendVerificationEmail(user.email, verifyToken).catch((err) =>
    console.error("Failed to send verification email:", err)
  );

  // Generate tokens
  const { accessToken, refreshToken } = await createTokenPair(user.id, user.email, user.role);

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
    },
  };
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email } });
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

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const { accessToken, refreshToken } = await createTokenPair(user.id, user.email, user.role);

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
    },
  };
}

// ─── Refresh Token ────────────────────────────────────────────────────────────

export async function refresh(oldRefreshToken: string): Promise<AuthResult> {
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
    // Possible token reuse — invalidate all tokens for this user
    await prisma.refreshToken.deleteMany({ where: { userId: payload.userId } });
    throw new AppError(401, "Refresh token has been revoked", "TOKEN_REVOKED");
  }

  // Delete old token (rotation)
  await prisma.refreshToken.delete({ where: { id: storedToken.id } });

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.suspendedAt) {
    throw new AppError(401, "Account not found or suspended", "INVALID_ACCOUNT");
  }

  const { accessToken, refreshToken } = await createTokenPair(user.id, user.email, user.role);

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
    },
  };
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(refreshTokenValue: string): Promise<void> {
  const tokenHash = hashToken(refreshTokenValue);
  await prisma.refreshToken.deleteMany({ where: { tokenHash } });
}

export async function logoutAll(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}

// ─── Forgot Password ─────────────────────────────────────────────────────────

export async function forgotPassword(email: string): Promise<void> {
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

  await sendPasswordResetEmail(user.email, token);
}

// ─── Reset Password ──────────────────────────────────────────────────────────

export async function resetPassword(
  token: string,
  newPassword: string
): Promise<void> {
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
    throw new AppError(400, "Invalid or expired verification link", "INVALID_VERIFY_TOKEN");
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

export async function resendVerification(userId: string): Promise<void> {
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
    throw new AppError(429, "Please wait before requesting another email", "RATE_LIMITED");
  }

  const { token, hash } = generateSecureToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hash,
      expiresAt: getEmailVerifyExpiry(),
    },
  });

  await sendVerificationEmail(user.email, token);
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
    subscription: user.subscription
      ? {
          plan: user.subscription.plan,
          status: user.subscription.status,
          currentPeriodEnd: user.subscription.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
        }
      : { plan: "FREE" as const, status: "ACTIVE" as const, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  };
}

// ─── Complete Onboarding ──────────────────────────────────────────────────────

export async function completeOnboarding(
  userId: string,
  theme?: string
): Promise<void> {
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

async function createTokenPair(userId: string, email: string, role: "USER" | "ADMIN") {
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
    },
  });

  // Clean up expired refresh tokens for this user (background)
  prisma.refreshToken
    .deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    })
    .catch(() => {});

  return { accessToken, refreshToken };
}

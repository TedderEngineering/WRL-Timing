import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth.js";
import { loginLimiter, registerLimiter, passwordResetLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../models/prisma.js";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "../utils/validators.js";
import * as authService from "../services/auth.js";
import { REFRESH_COOKIE_OPTIONS } from "../utils/tokens.js";

export const authRouter = Router();

// ─── POST /api/auth/register ──────────────────────────────────────────────────

authRouter.post(
  "/register",
  registerLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, displayName } = registerSchema.parse(req.body);
      const result = await authService.register(email, password, displayName);

      // Set refresh token as httpOnly cookie
      res.cookie("refresh_token", result.refreshToken, REFRESH_COOKIE_OPTIONS);

      res.status(201).json({
        accessToken: result.accessToken,
        user: result.user,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

authRouter.post(
  "/login",
  loginLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const result = await authService.login(email, password);

      res.cookie("refresh_token", result.refreshToken, REFRESH_COOKIE_OPTIONS);

      res.json({
        accessToken: result.accessToken,
        user: result.user,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────

authRouter.post(
  "/refresh",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const oldToken = req.cookies?.refresh_token;
      if (!oldToken) {
        res.status(401).json({ error: "No refresh token", code: "NO_REFRESH_TOKEN" });
        return;
      }

      const result = await authService.refresh(oldToken);

      res.cookie("refresh_token", result.refreshToken, REFRESH_COOKIE_OPTIONS);

      res.json({
        accessToken: result.accessToken,
        user: result.user,
      });
    } catch (err) {
      // Clear invalid cookie
      res.clearCookie("refresh_token", { path: "/api/auth" });
      next(err);
    }
  }
);

// ─── POST /api/auth/logout ───────────────────────────────────────────────────

authRouter.post(
  "/logout",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = req.cookies?.refresh_token;
      if (refreshToken) {
        await authService.logout(refreshToken);
      }

      res.clearCookie("refresh_token", { path: "/api/auth" });
      res.status(204).send();
    } catch (err) {
      // Still clear cookie even on error
      res.clearCookie("refresh_token", { path: "/api/auth" });
      next(err);
    }
  }
);

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

authRouter.post(
  "/forgot-password",
  passwordResetLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      await authService.forgotPassword(email);

      // Always return 200 to prevent email enumeration
      res.json({ message: "If an account with that email exists, we sent a reset link." });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

authRouter.post(
  "/reset-password",
  passwordResetLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, password } = resetPasswordSchema.parse(req.body);
      await authService.resetPassword(token, password);

      res.json({ message: "Password has been reset. Please log in with your new password." });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/verify-email ─────────────────────────────────────────────

authRouter.post(
  "/verify-email",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = verifyEmailSchema.parse(req.body);
      await authService.verifyEmail(token);

      res.json({ message: "Email verified successfully." });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/resend-verification ──────────────────────────────────────

authRouter.post(
  "/resend-verification",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.resendVerification(req.user!.userId);
      res.json({ message: "Verification email sent." });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

authRouter.get(
  "/me",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await authService.getCurrentUser(req.user!.userId);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PUT /api/auth/onboarding-complete ───────────────────────────────────────

authRouter.put(
  "/onboarding-complete",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.completeOnboarding(req.user!.userId, req.body.theme);
      res.json({ message: "Onboarding complete." });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PUT /api/auth/profile ──────────────────────────────────────────────────

authRouter.put(
  "/profile",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { displayName } = req.body;
      if (!displayName || typeof displayName !== "string") {
        res.status(400).json({ error: "displayName is required" });
        return;
      }
      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { displayName: displayName.trim().slice(0, 100) },
      });
      res.json({ message: "Profile updated." });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PUT /api/auth/password ─────────────────────────────────────────────────

authRouter.put(
  "/password",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: "currentPassword and newPassword are required" });
        return;
      }
      if (newPassword.length < 8) {
        res.status(400).json({ error: "New password must be at least 8 characters" });
        return;
      }
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const bcrypt = await import("bcrypt");
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        res.status(400).json({ error: "Current password is incorrect" });
        return;
      }
      const newHash = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { passwordHash: newHash },
      });
      res.json({ message: "Password changed successfully." });
    } catch (err) {
      next(err);
    }
  }
);

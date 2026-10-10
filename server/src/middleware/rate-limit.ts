import rateLimit from "express-rate-limit";

/**
 * Login: 10 failed attempts per 15 minutes per IP. Successful logins don't
 * count, so a crew signing in together on one track Wi-Fi or hotspot isn't
 * locked out; guessing passwords still is.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts. Please try again in 15 minutes.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Register: 10 attempts per hour per IP (a crew may sign up together on one network)
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many registration attempts. Please try again later.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Password reset: 3 per hour per IP
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: "Too many password reset requests. Please try again later.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API: 100 requests per minute per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: "Too many requests. Please slow down.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

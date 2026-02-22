import rateLimit from "express-rate-limit";

/**
 * Login: 5 attempts per 15 minutes per IP
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many login attempts. Please try again in 15 minutes.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Register: 3 attempts per hour per IP
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
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

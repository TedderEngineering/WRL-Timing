import { z } from "zod";

export const registerSchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .max(255)
    .transform((v) => v.toLowerCase().trim()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  displayName: z
    .string()
    .max(100)
    .trim()
    .optional(),
});

export const loginSchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .transform((v) => v.toLowerCase().trim()),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),

  // Stripe
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  STRIPE_PRO_PRICE_ID: z.string().startsWith("price_"),
  STRIPE_TEAM_PRICE_ID: z.string().startsWith("price_"),
  STRIPE_PRICE_PRO_ANNUAL: z.string().optional(),
  STRIPE_PRICE_TEAM_ANNUAL: z.string().optional(),

  // Supabase
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Email
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default("noreply@tedderengineering.com"),

  // URLs
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  BACKEND_URL: z.string().url().default("http://localhost:3000"),

  // Monitoring
  SENTRY_DSN: z.string().optional(),

  // General
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().default(3000),
});

// In development and under test, be lenient about missing optional services.
//
// "test" is included deliberately: vitest sets NODE_ENV=test, which previously
// fell through to strict validation and made the whole suite refuse to load
// unless real STRIPE_* credentials were present in .env. Unit tests should not
// require live payment keys — and requiring them meant the suite only ran on a
// machine configured against production.
const parseEnv = () => {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "development" || nodeEnv === "test" || !nodeEnv) {
    // For dev and test, provide sensible defaults for optional external services
    return envSchema
      .extend({
        STRIPE_SECRET_KEY: z.string().default("sk_test_placeholder"),
        STRIPE_PUBLISHABLE_KEY: z.string().default("pk_test_placeholder"),
        STRIPE_WEBHOOK_SECRET: z.string().default("whsec_placeholder"),
        STRIPE_PRO_PRICE_ID: z.string().default("price_pro_placeholder"),
        STRIPE_TEAM_PRICE_ID: z.string().default("price_team_placeholder"),
        STRIPE_PRICE_PRO_ANNUAL: z.string().default("price_pro_placeholder"),
        STRIPE_PRICE_TEAM_ANNUAL: z.string().default("price_team_placeholder"),
      })
      .parse(process.env);
  }
  return envSchema.parse(process.env);
};

export const env = parseEnv();

export type Env = z.infer<typeof envSchema>;

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

  // Finding Grip
  // Who can use Finding Grip: "off" (nobody), "admin" (admins only),
  // "testers" (admins + GRIP_TESTER_EMAILS) or "public" (every account).
  GRIP_ACCESS: z.enum(["off", "admin", "testers", "public"]).default("admin"),
  GRIP_TESTER_EMAILS: z.string().optional(),
  // Finding Grip's own address, e.g. https://findinggrip.tedderengineering.com.
  // When set: /grip on the RaceTrace site forwards there, and sign-ups made
  // there get Finding Grip emails and links. Leave unset until the domain works.
  // Read leniently in services/site.ts: a mistyped value is ignored (and shown
  // on the Finding Grip admin page) instead of stopping the server.
  GRIP_PUBLIC_URL: z.string().optional(),
  // "free" (default): every account gets every tool with no limits.
  // "paid": Free and Pro plans, with checkout through Stripe.
  GRIP_PRICING: z.enum(["free", "paid"]).default("free"),
  // Stripe price id(s) for Finding Grip Pro, comma-separated. The first is
  // sold at checkout; all of them are recognised in webhooks. Checkout is
  // unavailable until set.
  STRIPE_GRIP_PRO_PRICE_ID: z
    .string()
    .regex(
      /^price_\w+(\s*,\s*price_\w+)*$/,
      "Expected one or more price_… ids, comma-separated"
    )
    .optional(),
  // The proprietary calculation model, as JSON or as base64 of that JSON.
  // Read in services/grip/calc.ts.
  // Never commit a real value anywhere in this repository.
  GRIP_CALC_MODEL: z.string().optional(),

  // Setup Sheet
  // Who can use Setup Sheet: "off", "admin", "testers" (admins +
  // SETUP_TESTER_EMAILS) or "public". Same rules as GRIP_ACCESS.
  SETUP_ACCESS: z.enum(["off", "admin", "testers", "public"]).default("admin"),
  SETUP_TESTER_EMAILS: z.string().optional(),
  // Setup Sheet's address, e.g. https://setup.tedderengineering.com. Allowed
  // to call the API, and sign-ups made there get Setup Sheet emails and links.
  // Read leniently in services/site.ts, like GRIP_PUBLIC_URL.
  SETUP_PUBLIC_URL: z.string().optional(),

  // Shared login
  // Parent domain for the login cookie, e.g. ".tedderengineering.com". Set it
  // only once the API answers on a host under that domain (for example
  // api.tedderengineering.com) and every site calls the API there: the cookie
  // is then first-party on all sites and one login covers them all. Unset, the
  // cookie stays on whichever host answered (the original behaviour).
  COOKIE_DOMAIN: z.string().optional(),
  // Extra browser origins allowed to call the API, comma-separated, e.g.
  // http://localhost:3000 for local work on Setup Sheet. Ignored in production.
  EXTRA_CORS_ORIGINS: z.string().optional(),

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
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
});

// In development, be lenient about missing optional services
const parseEnv = () => {
  if (process.env.NODE_ENV === "development" || !process.env.NODE_ENV) {
    // For dev, provide sensible defaults for optional external services
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

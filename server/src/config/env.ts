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

  // Sign in with another account (services/oauth.ts). A provider's button shows only when its
  // settings are present. Redirect URI to register at each provider, per site:
  //   https://<site host>/api/auth/oauth/<provider>/callback
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // Apple: the Services ID, the team id, and a Sign in with Apple key (id + .p8 contents; "\n" for line breaks).
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),

  // Supabase
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // RaceTrace 2.0: Race Analysis Packages (G5). Read at request time through
  // src/packages/flags.ts so they can be flipped without a code change.
  // "off" (default) serves the legacy chartData to everyone but admins.
  RACETRACE_PACKAGES: z.enum(["on", "off"]).default("off"),
  // The chart's pit analysis from the race's published package (packages/pit-facts.ts):
  // "on" (default) whenever a race has one; "off" keeps the import's own pit analysis.
  RACETRACE_PIT_FACTS: z.enum(["on", "off"]).default("on"),
  // Rule Flags release stage: R0 admins only, R1 + Team, R2 + every signed-in user.
  RACETRACE_RULE_FLAGS: z.enum(["R0", "R1", "R2"]).default("R0"),
  // Folder with race-analysis-package*.schema.json; default <repo>/shared/race-analysis-package.
  RACETRACE_SCHEMA_DIR: z.string().optional(),
  // RaceTrace is free (October 2026): "on" (default) opens every race and feature to
  // everyone and hides the plans; "off" restores the Free / Pro / Team limits. Stripe
  // subscriptions are untouched either way. Read at request time (lib/free-mode.ts).
  RACETRACE_FREE: z.enum(["on", "off"]).default("on"),
  // Optional support ("Buy me a coffee"). One coffee in cents; checkout runs through the
  // Stripe account above. SUPPORT_PAYMENT_LINK_URL (a Stripe Payment Link) is used instead
  // when SUPPORT_CHECKOUT is "off".
  SUPPORT_CHECKOUT: z.enum(["on", "off"]).default("on"),
  SUPPORT_COFFEE_CENTS: z.coerce.number().int().min(100).max(10000).default(500),
  SUPPORT_PAYMENT_LINK_URL: z.string().url().optional(),

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

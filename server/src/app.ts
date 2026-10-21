import { oauthRouter } from "./routes/oauth.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { apiLimiter } from "./middleware/rate-limit.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { racesRouter } from "./routes/races.js";
import { liveRouter } from "./routes/live.js";
import { meRouter } from "./routes/me.js";
import { alertsRouter } from "./routes/alerts.js";
import { shareRouter } from "./routes/share.js";
import { adminRouter } from "./routes/admin.js";
import { intakeRouter, apiTokensRouter } from "./routes/intake.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { siteConfigRouter, supportRouter } from "./routes/site-config.js";
import { billingRouter } from "./routes/billing.js";
import { eventsRouter } from "./routes/events.js";
import { searchRouter } from "./routes/search.js";
import { qualifyingRouter } from "./routes/qualifying.js";
import { landingRouter } from "./routes/landing.js";
import { requireAuth } from "./middleware/auth.js";
import { gripRouter } from "./routes/grip.js";
import { setupRouter } from "./routes/setup.js";
import { allowedOrigins } from "./services/site.js";

const PACKAGE_UPLOAD_PATH = /^\/api\/admin\/races\/[^/]+\/packages\/?$/;

export function createApp() {
  const app = express();

  // Trust proxy (Railway / Vercel reverse proxy)
  app.set("trust proxy", 1);

  // ─── Security ───────────────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://js.stripe.com"],
          frameSrc: ["'self'", "https://js.stripe.com"],
          connectSrc: ["'self'", "https://api.stripe.com"],
        },
      },
    })
  );

  app.use(
    cors({
      origin: allowedOrigins(),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "If-None-Match"],
      exposedHeaders: [
        "ETag",
        "X-RaceTrace-Package-Version",
        "X-RaceTrace-Package-Status",
        "X-RaceTrace-Published-At",
        "X-RaceTrace-Rule-Flags",
      ],
    })
  );

  // ─── Body Parsing ──────────────────────────────────────────────────────────
  // 1 MB for everything (forms, settings, follows, Setup Sheet edits). Larger bodies only where a
  // signed-in request sends whole files as JSON, and only with an Authorization header, so an
  // anonymous request can't make the server read 50 MB before auth and the rate limits run:
  //   - an intake push carries a race's raw timing files; a 24-hour race's lap analysis alone is
  //     over 50 MB (intake token required);
  //   - the admin pages upload race and qualifying files as text (admin only);
  //   - Finding Grip's admin imports and Setup Sheet's workbook import.
  const INTAKE_PUSH_PATH = /^\/api\/admin\/intake\/races\/?$/;
  const INTAKE_BODY_LIMIT = "160mb";
  const FILE_BODY_PATHS = [/^\/api\/admin\//, /^\/api\/grip\/admin\//, /^\/api\/setup\/teams\/[^/]+\/import\/?$/];
  const FILE_BODY_LIMIT = "50mb";
  const DEFAULT_BODY_LIMIT = "1mb";
  const jsonParsers = new Map(
    [INTAKE_BODY_LIMIT, FILE_BODY_LIMIT, DEFAULT_BODY_LIMIT].map((limit) => [limit, express.json({ limit })])
  );
  // Stripe webhook needs raw body — skip JSON parsing for that route.
  // Race Analysis Package uploads read the raw bytes too (plain or gzip JSON,
  // hashed exactly as sent; see routes/packages.ts).
  app.use((req, res, next) => {
    if (req.path === "/api/billing/webhook") return next();
    if (req.method === "POST" && PACKAGE_UPLOAD_PATH.test(req.path)) return next();
    const auth = req.headers.authorization;
    const signedIn = typeof auth === "string" && auth.startsWith("Bearer ");
    const limit = !signedIn
      ? DEFAULT_BODY_LIMIT
      : req.method === "POST" && INTAKE_PUSH_PATH.test(req.path)
        ? INTAKE_BODY_LIMIT
        : FILE_BODY_PATHS.some((re) => re.test(req.path))
          ? FILE_BODY_LIMIT
          : DEFAULT_BODY_LIMIT;
    jsonParsers.get(limit)!(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));
  app.use(cookieParser());

  // ─── Setup Sheet ─────────────────────────────────────────────────────────
  // Mounted before the shared per-IP limit: a team on one paddock Wi-Fi shares
  // an address and open pages poll for changes, so Setup Sheet limits per
  // person instead (see routes/setup.ts).
  app.use("/api/setup", setupRouter);
  // RaceTrace Live: same reason (a paddock full of phones polling one race). It only serves
  // the cached chart; the timing feed is read by one paced poller per session (live/poller.ts).
  app.use("/api/live", liveRouter);

  // ─── Rate Limiting ───────────────────────────────────────────────────────
  app.use("/api", apiLimiter);

  // ─── Routes ─────────────────────────────────────────────────────────────────
  app.use("/api/health", healthRouter);
  app.use("/api/auth/oauth", oauthRouter);
  app.use("/api/auth", authRouter);
  // Races, events, search and qualifying are for signed-in users only; signed out, the site shows
  // its landing page (GET /api/landing), link previews (/api/share) and the live listing.
  app.use("/api/races", requireAuth, racesRouter);
  app.use("/api/me", meRouter);
  app.use("/api/alerts", alertsRouter);
  app.use("/api/share", shareRouter);
  app.use("/api/events", requireAuth, eventsRouter);
  app.use("/api/landing", landingRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/site-config", siteConfigRouter);
  app.use("/api/support", supportRouter);
  app.use("/api/search", requireAuth, searchRouter);
  // Machine intake and API tokens (G4). Mounted before the general admin
  // router so its auth runs once; both routers require an admin.
  app.use("/api/admin/intake", intakeRouter);
  app.use("/api/admin/api-tokens", apiTokensRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/qualifying", requireAuth, qualifyingRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/grip", gripRouter);

  // ─── Error Handling ─────────────────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}

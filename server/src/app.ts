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
  const INTAKE_PUSH_PATH = /^\/api\/admin\/intake\/races\/?$/;
  const INTAKE_BODY_LIMIT = "160mb";
  // Stripe webhook needs raw body — skip JSON parsing for that route.
  // Race Analysis Package uploads read the raw bytes too (plain or gzip JSON,
  // hashed exactly as sent; see routes/packages.ts).
  app.use((req, res, next) => {
    if (req.path === "/api/billing/webhook") return next();
    if (req.method === "POST" && PACKAGE_UPLOAD_PATH.test(req.path)) return next();
    // An intake push carries a race's raw timing files; a 24-hour race's lap analysis alone
    // is over 50 MB. Only that route (intake token required) accepts more.
    const limit = req.method === "POST" && INTAKE_PUSH_PATH.test(req.path) ? INTAKE_BODY_LIMIT : "50mb";
    express.json({ limit })(req, res, next);
  });
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // ─── Setup Sheet ─────────────────────────────────────────────────────────
  // Mounted before the shared per-IP limit: a team on one paddock Wi-Fi shares
  // an address and open pages poll for changes, so Setup Sheet limits per
  // person instead (see routes/setup.ts).
  app.use("/api/setup", setupRouter);

  // ─── Rate Limiting ───────────────────────────────────────────────────────
  app.use("/api", apiLimiter);

  // ─── Routes ─────────────────────────────────────────────────────────────────
  app.use("/api/health", healthRouter);
  app.use("/api/auth/oauth", oauthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/races", racesRouter);
  app.use("/api/me", meRouter);
  app.use("/api/alerts", alertsRouter);
  app.use("/api/share", shareRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/site-config", siteConfigRouter);
  app.use("/api/support", supportRouter);
  app.use("/api/search", searchRouter);
  // Machine intake and API tokens (G4). Mounted before the general admin
  // router so its auth runs once; both routers require an admin.
  app.use("/api/admin/intake", intakeRouter);
  app.use("/api/admin/api-tokens", apiTokensRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/qualifying", qualifyingRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/grip", gripRouter);

  // ─── Error Handling ─────────────────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}

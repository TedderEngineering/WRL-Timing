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
import { adminRouter } from "./routes/admin.js";
import { billingRouter } from "./routes/billing.js";

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
      origin: env.FRONTEND_URL,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // ─── Body Parsing ──────────────────────────────────────────────────────────
  // Stripe webhook needs raw body — skip JSON parsing for that route
  app.use((req, res, next) => {
    if (req.path === "/api/billing/webhook") return next();
    express.json({ limit: "50mb" })(req, res, next);
  });
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // ─── Rate Limiting ───────────────────────────────────────────────────────
  app.use("/api", apiLimiter);

  // ─── Routes ─────────────────────────────────────────────────────────────────
  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/races", racesRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/billing", billingRouter);

  // ─── Error Handling ─────────────────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}

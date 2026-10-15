/**
 * Machine intake (RaceTrace 2.0, G4) and API-token management.
 *
 *   GET    /api/admin/intake/whoami          who the caller is (token or session) — skill preflight
 *   GET    /api/admin/intake/races?site=     races with a source key, for `intake discover`
 *   GET    /api/admin/intake/races?unkeyed=1&series=&season=[&cars=1]   races without one (attach candidates; cars=1 adds car numbers)
 *   POST   /api/admin/intake/races           idempotent upsert by source key (services/intake.ts)
 *   POST   /api/admin/intake/races/:id/identity   name, date and season from the race's session (intake `names`)
 *
 *   GET    /api/admin/api-tokens             list tokens (never the token or its hash)
 *   POST   /api/admin/api-tokens             create; the token is in this response only
 *   DELETE /api/admin/api-tokens/:id         revoke
 *
 * Intake routes accept a signed-in admin or an API token with the `intake`
 * scope (requireAdmin). Token management requires a signed-in admin: a token
 * can never create or revoke tokens.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, rejectApiToken } from "../middleware/auth.js";
import { AppError } from "../middleware/error-handler.js";
import { prisma } from "../models/prisma.js";
import { getParser } from "../utils/parsers/index.js";
import { archiveRaceFiles } from "../lib/race-archive.js";
import { supabase, supabaseKeyKind, STORAGE_BUCKET } from "../lib/supabase.js";
import { env } from "../config/env.js";
import { intakeRace, listIntakeRaces, listUnkeyedRaces, setRaceIdentity } from "../services/intake.js";
import { API_TOKEN_SCOPES, generateApiToken, toPublicToken } from "../services/api-tokens.js";

// ─── Intake ──────────────────────────────────────────────────────────────────

export const intakeRouter = Router();
intakeRouter.use(requireAuth, requireAdmin);

intakeRouter.get("/whoami", (req: Request, res: Response) => {
  res.json({
    userId: req.user!.userId,
    email: req.user!.email,
    role: req.user!.role,
    via: req.apiToken ? "api-token" : "session",
    token: req.apiToken ? { id: req.apiToken.id, name: req.apiToken.name, prefix: req.apiToken.prefix, scopes: req.apiToken.scopes } : null,
  });
});

intakeRouter.get("/races", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.query.unkeyed === "1" || req.query.unkeyed === "true") {
      const series = typeof req.query.series === "string" && /^[A-Za-z0-9_ -]{1,100}$/.test(req.query.series) ? req.query.series : undefined;
      const season = typeof req.query.season === "string" && /^\d{4}$/.test(req.query.season) ? Number(req.query.season) : undefined;
      const withCars = req.query.cars === "1" || req.query.cars === "true";
      res.json({ races: await listUnkeyedRaces({ series, season, withCars }) });
      return;
    }
    const site = typeof req.query.site === "string" && /^(imsa|sro|speedhive|redmist)$/.test(req.query.site) ? req.query.site : undefined;
    res.json({ races: await listIntakeRaces(site) });
  } catch (err) {
    next(err);
  }
});

intakeRouter.post("/races", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await intakeRace(
      req.body,
      { userId: req.user!.userId, ...(req.apiToken ? { apiTokenId: req.apiToken.id } : {}) },
      {
        getParser,
        archive: (files) =>
          archiveRaceFiles(files, {
            bucket: supabase ? supabase.storage.from(STORAGE_BUCKET) : null,
            nodeEnv: env.NODE_ENV,
            keyRole: supabaseKeyKind,
          }),
      }
    );
    res.status(result.action === "created" ? 201 : 200).json({
      ...result,
      url: `/races/${result.raceId}`,
      adminUrl: `/admin/races`,
    });
  } catch (err) {
    next(err);
  }
});

intakeRouter.post("/races/:id/identity", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await setRaceIdentity(String(req.params.id), req.body, { userId: req.user!.userId, ...(req.apiToken ? { apiTokenId: req.apiToken.id } : {}) });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── API tokens ──────────────────────────────────────────────────────────────

export const apiTokensRouter = Router();
apiTokensRouter.use(requireAuth, requireAdmin, rejectApiToken);

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1).default(["intake"]),
  /** Days until expiry; null or absent = no expiry. */
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

apiTokensRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.apiToken.findMany({
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { email: true } } },
    });
    res.json({ tokens: rows.map((r: any) => toPublicToken(r)) });
  } catch (err) {
    next(err);
  }
});

apiTokensRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createTokenSchema.parse(req.body ?? {});
    const { token, tokenHash, prefix } = generateApiToken();
    const expiresAt = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86400000) : null;
    const row = await prisma.apiToken.create({
      data: { name: body.name, tokenHash, prefix, scopes: body.scopes, createdById: req.user!.userId, expiresAt },
      include: { createdBy: { select: { email: true } } },
    });
    await prisma.auditLog.create({
      data: {
        adminUserId: req.user!.userId,
        action: "CREATE_API_TOKEN",
        targetType: "api_token",
        targetId: row.id,
        details: { name: body.name, prefix, scopes: body.scopes, expiresAt },
      },
    });
    res.status(201).json({
      token,
      apiToken: toPublicToken(row as any),
      note: "Copy this token now. It is not stored and cannot be shown again.",
    });
  } catch (err) {
    next(err);
  }
});

apiTokensRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const row = await prisma.apiToken.findUnique({ where: { id } });
    if (!row) throw new AppError(404, "API token not found", "TOKEN_NOT_FOUND");
    const updated = row.revokedAt
      ? row
      : await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    if (!row.revokedAt) {
      await prisma.auditLog.create({
        data: {
          adminUserId: req.user!.userId,
          action: "REVOKE_API_TOKEN",
          targetType: "api_token",
          targetId: id,
          details: { name: row.name, prefix: row.prefix },
        },
      });
    }
    res.json({ message: "API token revoked", id, revokedAt: updated.revokedAt });
  } catch (err) {
    next(err);
  }
});

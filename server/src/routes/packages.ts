/**
 * Race Analysis Package endpoints (RaceTrace 2.0, G5).
 *
 * Admin (mounted at /api/admin/races/:id/packages; requireAuth + requireAdmin):
 *   POST   /                      upload a package (JSON or gzip, ≤ 25 MB) → draft, or 422 + report
 *   GET    /                      version list
 *   PUT    /override              { disabled: boolean } per-race fallback to legacy chartData
 *   POST   /:version/publish      publish a draft; the previous published version becomes superseded
 *   POST   /:version/rollback     make a superseded version current again
 *   POST   /:version/reject       { reason? } reject a draft or superseded version
 *
 * Read (mounted in routes/races.ts):
 *   GET /api/races/:id/package[?version=N]   gzip + ETag; ?version is admin-only
 */
import express, { Router, Request, Response, NextFunction } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { AppError } from "../middleware/error-handler.js";
import { prisma } from "../models/prisma.js";
import { assertRaceAccess, resolveViewer } from "../services/race-access.js";
import * as svc from "../packages/service.js";
import { canSeeRuleFlags, packagesEnabledFor, packagesFlagOn } from "../packages/flags.js";
import { MAX_UPLOAD_BYTES, getServedGzip, gunzip, type PackageVariant } from "../packages/store.js";

// ─── Admin ───────────────────────────────────────────────────────────────────

export const adminPackagesRouter = Router({ mergeParams: true });
adminPackagesRouter.use(requireAuth, requireAdmin);

const rawParser = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });

/** Raw body for uploads. app.ts skips the global JSON parser for this path. */
function rawBody(req: Request, res: Response, next: NextFunction) {
  rawParser(req, res, (err?: unknown) => {
    if (!err) return next();
    const e = err as { type?: string; message?: string };
    if (e.type === "entity.too.large") {
      return next(new AppError(413, `Package upload exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`, "PACKAGE_TOO_LARGE"));
    }
    next(new AppError(400, `Could not read the request body: ${e.message ?? "unknown error"}`, "INVALID_BODY"));
  });
}

function bodyBuffer(req: Request): Buffer {
  if (Buffer.isBuffer(req.body)) return req.body;
  // Mounted somewhere the JSON parser already ran: re-serialise (sha256 then covers this form).
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    return Buffer.from(JSON.stringify(req.body), "utf8");
  }
  return Buffer.alloc(0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Json column input, as in admin.ts
async function audit(req: Request, action: string, details: Record<string, any>) {
  await prisma.auditLog.create({
    data: {
      adminUserId: req.user!.userId,
      action,
      targetType: "race",
      targetId: req.params.id as string,
      details,
    },
  });
}

adminPackagesRouter.post("/", rawBody, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raceId = req.params.id as string;
    const notes = typeof req.query.notes === "string" ? req.query.notes.slice(0, 2000) : null;
    const result = await svc.uploadPackage({ raceId, body: bodyBuffer(req), userId: req.user!.userId, notes });

    if (!result.ok) {
      await audit(req, "UPLOAD_RACE_PACKAGE_REJECTED", {
        schemaVersion: result.report.schemaVersion,
        errorCount: result.report.errorCount,
        firstErrors: result.report.errors.slice(0, 5),
      });
      res.status(422).json({
        error: `Package failed validation (${result.report.errorCount} error(s)); nothing was stored.`,
        code: "PACKAGE_INVALID",
        report: result.report,
      });
      return;
    }

    await audit(req, "UPLOAD_RACE_PACKAGE", {
      version: result.row.version,
      sha256: result.row.sha256,
      sizeBytes: result.row.sizeBytes,
      schemaVersion: result.row.schemaVersion,
      engineVersion: result.row.engineVersion,
      warnings: result.report.warnings.length,
    });
    res.status(201).json({
      package: svc.toSummary(result.row, result.currentPackageId),
      report: result.report,
    });
  } catch (err) {
    next(err);
  }
});

adminPackagesRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { race, packages } = await svc.listPackages(req.params.id as string);
    const current = packages.find((p) => p.isCurrent) ?? null;
    res.json({
      raceId: race.id,
      currentPackageId: race.currentPackageId,
      currentVersion: current?.version ?? null,
      flags: {
        global: packagesFlagOn() ? "on" : "off",
        raceDisabled: race.packagesDisabled,
        servedToUsers: packagesEnabledFor(race) && current !== null,
      },
      packages,
    });
  } catch (err) {
    next(err);
  }
});

adminPackagesRouter.put("/override", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const disabled = req.body?.disabled;
    if (typeof disabled !== "boolean") {
      throw new AppError(400, 'Body must be { "disabled": true | false }', "INVALID_BODY");
    }
    await svc.setPackagesDisabled(req.params.id as string, disabled);
    await audit(req, "SET_RACE_PACKAGES_OVERRIDE", { disabled });
    res.json({ raceId: req.params.id, packagesDisabled: disabled });
  } catch (err) {
    next(err);
  }
});

adminPackagesRouter.post("/:version/publish", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raceId = req.params.id as string;
    const version = svc.parseVersion(req.params.version);
    const result = await svc.publishPackage(raceId, version, req.user!.userId);
    if (!result.ok) {
      res.status(422).json({
        error: `v${version} cannot be published: it fails the publish gate (${result.report.errorCount} error(s)).`,
        code: "PACKAGE_NOT_PUBLISHABLE",
        report: result.report,
      });
      return;
    }
    await audit(req, "PUBLISH_RACE_PACKAGE", {
      version,
      sha256: result.row.sha256,
      previousVersion: result.previousVersion,
    });
    res.json({ package: svc.toSummary(result.row, result.row.id), previousVersion: result.previousVersion });
  } catch (err) {
    next(err);
  }
});

adminPackagesRouter.post("/:version/rollback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raceId = req.params.id as string;
    const version = svc.parseVersion(req.params.version);
    const result = await svc.rollbackPackage(raceId, version, req.user!.userId);
    await audit(req, "ROLLBACK_RACE_PACKAGE", { version, previousVersion: result.previousVersion });
    res.json({ package: svc.toSummary(result.row, result.row.id), previousVersion: result.previousVersion });
  } catch (err) {
    next(err);
  }
});

adminPackagesRouter.post("/:version/reject", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raceId = req.params.id as string;
    const version = svc.parseVersion(req.params.version);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 2000) : null;
    const row = await svc.rejectPackage(raceId, version, reason);
    await audit(req, "REJECT_RACE_PACKAGE", { version, reason });
    res.json({ package: svc.toSummary(row, null) });
  } catch (err) {
    next(err);
  }
});

// ─── Read ────────────────────────────────────────────────────────────────────

/** True when an If-None-Match header lists this ETag (weak or strong) or "*". */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === "*" || t === etag);
}

export async function getRacePackage(req: Request, res: Response, next: NextFunction) {
  try {
    const raceId = req.params.id as string;
    const isAdmin = req.user?.role === "ADMIN";

    const race = (await prisma.race.findUnique({
      where: { id: raceId },
      select: {
        id: true,
        premium: true,
        createdAt: true,
        status: true,
        currentPackageId: true,
        packagesDisabled: true,
      },
    })) as {
      id: string;
      premium: boolean;
      createdAt: Date;
      status: string;
      currentPackageId: string | null;
      packagesDisabled: boolean;
    } | null;
    if (!race || (race.status === "DRAFT" && !isAdmin)) {
      throw new AppError(404, "Race not found", "RACE_NOT_FOUND");
    }
    // Admins keep access so packages can be reviewed before the switch is turned on.
    if (!isAdmin && !packagesEnabledFor(race)) {
      throw new AppError(404, "Analysis packages are switched off; use /chart-data", "PACKAGES_DISABLED");
    }

    const viewer = await resolveViewer(req.user);
    await assertRaceAccess(viewer, race);

    let row: svc.PackageRow | null;
    if (req.query.version !== undefined) {
      const version = svc.parseVersion(req.query.version);
      row = (await prisma.raceAnalysisPackage.findUnique({
        where: { raceId_version: { raceId, version } },
      })) as svc.PackageRow | null;
      // Drafts and old versions are admin-only; users may only name the current one.
      if (!row || (!isAdmin && row.id !== race.currentPackageId)) {
        throw new AppError(404, `Package v${version} not found`, "PACKAGE_NOT_FOUND");
      }
    } else {
      if (!race.currentPackageId) {
        throw new AppError(404, "This race has no published analysis package", "NO_PACKAGE");
      }
      row = (await prisma.raceAnalysisPackage.findUnique({
        where: { id: race.currentPackageId },
      })) as svc.PackageRow | null;
      if (!row) throw new AppError(404, "This race has no published analysis package", "NO_PACKAGE");
    }

    const variant: PackageVariant = canSeeRuleFlags(viewer) ? "full" : "norules";
    const etag = `"${row.sha256}${variant === "full" ? "" : "-norules"}"`;
    const isCurrent = row.id === race.currentPackageId && row.status === "PUBLISHED";

    res.set("ETag", etag);
    res.set("Vary", "Authorization, Accept-Encoding");
    res.set(
      "Cache-Control",
      !isCurrent ? "private, no-cache" : req.user ? "private, max-age=60" : "public, max-age=60"
    );
    res.set("X-RaceTrace-Package-Version", String(row.version));
    res.set("X-RaceTrace-Package-Status", row.status.toLowerCase());
    if (row.publishedAt) res.set("X-RaceTrace-Published-At", row.publishedAt.toISOString());
    res.set("X-RaceTrace-Rule-Flags", variant === "full" ? "included" : "hidden");

    if (etagMatches(req.headers["if-none-match"], etag)) {
      res.status(304).end();
      return;
    }

    const gz = await getServedGzip(row, variant);
    res.type("application/json; charset=utf-8");
    if (req.headers["accept-encoding"] && req.acceptsEncodings("gzip") === "gzip") {
      res.set("Content-Encoding", "gzip");
      res.end(gz);
    } else {
      res.end(gunzip(gz));
    }
  } catch (err) {
    next(err);
  }
}

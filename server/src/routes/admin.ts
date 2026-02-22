import { Router, Request, Response, NextFunction } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { raceMetadataSchema, raceListQuerySchema } from "../utils/race-validators.js";
import * as raceIngest from "../services/race-ingest.js";
import * as raceSvc from "../services/races.js";
import { prisma } from "../models/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import { getParser, getAllParsers } from "../utils/parsers/index.js";

export const adminRouter = Router();

// All admin routes require auth + admin role
adminRouter.use(requireAuth, requireAdmin);

// ─── GET /api/admin/formats — List available data format parsers ─────────────

adminRouter.get(
  "/formats",
  async (_req: Request, res: Response, _next: NextFunction) => {
    res.json({ formats: getAllParsers() });
  }
);

// ─── POST /api/admin/races/import — Upload race from any supported format ────

adminRouter.post(
  "/races/import",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { metadata, format, files } = req.body;

      if (!metadata || !format || !files) {
        throw new AppError(
          400,
          'Request body must include "metadata", "format" (string), and "files" (object with CSV strings)',
          "MISSING_FIELDS"
        );
      }

      const parser = getParser(format);
      if (!parser) {
        throw new AppError(400, `Unknown format: "${format}"`, "UNKNOWN_FORMAT");
      }

      // Check required files are present
      for (const slot of parser.fileSlots) {
        if (slot.required && (!files[slot.key] || typeof files[slot.key] !== "string")) {
          throw new AppError(
            400,
            `Missing required file: "${slot.label}" (key: ${slot.key})`,
            "MISSING_FILE"
          );
        }
      }

      const parsedMeta = raceMetadataSchema.parse(metadata);

      // Parse through format-specific parser
      const { data, annotations, warnings: parseWarnings } = parser.parse(files);

      // Ingest through existing pipeline
      const result = await raceIngest.ingestRaceData(
        parsedMeta,
        data,
        annotations,
        req.user!.userId
      );

      // Audit log
      await prisma.auditLog.create({
        data: {
          adminUserId: req.user!.userId,
          action: "CREATE_RACE",
          targetType: "race",
          targetId: result.raceId,
          details: {
            name: parsedMeta.name,
            source: format,
            parser: parser.name,
            entries: result.entriesCreated,
            laps: result.lapsCreated,
            warnings: [...parseWarnings, ...result.warnings],
          },
        },
      });

      res.status(201).json({
        message: `Race imported via ${parser.name}`,
        raceId: result.raceId,
        entriesCreated: result.entriesCreated,
        lapsCreated: result.lapsCreated,
        warnings: [...parseWarnings, ...result.warnings],
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/admin/races/import/validate — Validate without inserting ──────

adminRouter.post(
  "/races/import/validate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { metadata, format, files } = req.body;
      const errors: string[] = [];
      const warnings: string[] = [];

      // Validate metadata
      if (metadata) {
        const metaResult = raceMetadataSchema.safeParse(metadata);
        if (!metaResult.success) {
          metaResult.error.issues.forEach((i) =>
            errors.push(`metadata.${i.path.join(".")}: ${i.message}`)
          );
        }
      } else {
        errors.push("Missing metadata");
      }

      // Validate format
      if (!format) {
        errors.push("Missing format");
      } else {
        const parser = getParser(format);
        if (!parser) {
          errors.push(`Unknown format: "${format}"`);
        } else {
          // Check required files
          for (const slot of parser.fileSlots) {
            if (slot.required && (!files?.[slot.key] || typeof files[slot.key] !== "string")) {
              errors.push(`Missing required file: "${slot.label}"`);
            }
          }

          // Try parsing if we have the files
          if (files && errors.length === 0) {
            try {
              const { data, warnings: parseWarnings } = parser.parse(files);
              warnings.push(...parseWarnings);

              const carNums = Object.keys(data.cars);
              const totalLaps = carNums.reduce(
                (sum, n) => sum + data.cars[n].laps.length,
                0
              );

              const stats = {
                totalCars: carNums.length,
                maxLap: data.maxLap,
                totalLapRecords: totalLaps,
                classes: Object.keys(data.classGroups),
                classCarCounts: data.classCarCounts,
                fcyPeriods: data.fcy.length,
                greenPaceCutoff: Math.round(data.greenPaceCutoff * 10) / 10,
              };

              res.json({ valid: errors.length === 0, errors, warnings, stats });
              return;
            } catch (parseErr: any) {
              errors.push(`Parse error: ${parseErr.message}`);
            }
          }
        }
      }

      res.json({ valid: errors.length === 0, errors, warnings, stats: null });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/admin/races — Upload new race data (JSON) ─────────────────────

adminRouter.post(
  "/races",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { metadata, data, annotations } = req.body;

      if (!metadata || !data) {
        throw new AppError(
          400,
          'Request body must include "metadata" and "data" objects',
          "MISSING_FIELDS"
        );
      }

      const parsedMeta = raceMetadataSchema.parse(metadata);

      const result = await raceIngest.ingestRaceData(
        parsedMeta,
        data,
        annotations || {},
        req.user!.userId
      );

      // Audit log
      await prisma.auditLog.create({
        data: {
          adminUserId: req.user!.userId,
          action: "CREATE_RACE",
          targetType: "race",
          targetId: result.raceId,
          details: {
            name: parsedMeta.name,
            entries: result.entriesCreated,
            laps: result.lapsCreated,
            warnings: result.warnings,
          },
        },
      });

      res.status(201).json({
        message: "Race data imported successfully",
        raceId: result.raceId,
        entriesCreated: result.entriesCreated,
        lapsCreated: result.lapsCreated,
        warnings: result.warnings,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/admin/races/validate — Validate without inserting ─────────────

adminRouter.post(
  "/races/validate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { metadata, data, annotations } = req.body;

      if (!metadata || !data) {
        throw new AppError(400, 'Missing "metadata" or "data"', "MISSING_FIELDS");
      }

      const errors: string[] = [];
      const warnings: string[] = [];

      // Validate metadata
      const metaResult = raceMetadataSchema.safeParse(metadata);
      if (!metaResult.success) {
        metaResult.error.issues.forEach((i) =>
          errors.push(`metadata.${i.path.join(".")}: ${i.message}`)
        );
      }

      // Validate data
      const { raceDataJsonSchema, annotationJsonSchema } = await import(
        "../utils/race-validators.js"
      );
      const dataResult = raceDataJsonSchema.safeParse(data);
      if (!dataResult.success) {
        dataResult.error.issues.forEach((i) =>
          errors.push(`data.${i.path.join(".")}: ${i.message}`)
        );
      }

      // Validate annotations
      if (annotations && Object.keys(annotations).length > 0) {
        const annResult = annotationJsonSchema.safeParse(annotations);
        if (!annResult.success) {
          annResult.error.issues.forEach((i) =>
            warnings.push(`annotations.${i.path.join(".")}: ${i.message}`)
          );
        }
      }

      // Cross-validation
      if (dataResult.success) {
        const d = dataResult.data;
        const carNums = Object.keys(d.cars);
        if (carNums.length !== d.totalCars) {
          warnings.push(
            `totalCars=${d.totalCars} but found ${carNums.length} cars`
          );
        }

        // Check class groups
        for (const [cls, nums] of Object.entries(d.classGroups)) {
          for (const num of nums) {
            if (!d.cars[String(num)]) {
              warnings.push(`classGroup "${cls}" references car #${num} not in data`);
            }
          }
        }
      }

      const valid = errors.length === 0;

      // Summary stats
      let stats = null;
      if (dataResult.success) {
        const d = dataResult.data;
        const carNums = Object.keys(d.cars);
        const totalLaps = carNums.reduce(
          (sum, n) => sum + d.cars[n].laps.length,
          0
        );
        stats = {
          totalCars: carNums.length,
          maxLap: d.maxLap,
          totalLapRecords: totalLaps,
          classes: Object.keys(d.classGroups),
          classCarCounts: d.classCarCounts,
        };
      }

      res.json({ valid, errors, warnings, stats });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/admin/races — List all races (including drafts) ────────────────

adminRouter.get(
  "/races",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = raceListQuerySchema.parse(req.query);
      const result = await raceSvc.listRacesAdmin(params);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// ─── PUT /api/admin/races/:id — Update race metadata ────────────────────────

adminRouter.put(
  "/races/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updateData: Record<string, any> = {};
      const allowed = ["name", "date", "track", "series", "season", "status", "premium"];

      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          if (key === "date") updateData[key] = new Date(req.body[key]);
          else updateData[key] = req.body[key];
        }
      }

      const race = await raceSvc.updateRace(req.params.id, updateData);

      await prisma.auditLog.create({
        data: {
          adminUserId: req.user!.userId,
          action: "UPDATE_RACE",
          targetType: "race",
          targetId: req.params.id,
          details: updateData,
        },
      });

      res.json(race);
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /api/admin/races/:id — Delete a race ─────────────────────────────

adminRouter.delete(
  "/races/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const race = await raceSvc.deleteRace(req.params.id);

      await prisma.auditLog.create({
        data: {
          adminUserId: req.user!.userId,
          action: "DELETE_RACE",
          targetType: "race",
          targetId: req.params.id,
          details: { name: race.name, track: race.track },
        },
      });

      res.json({ message: "Race deleted", id: req.params.id });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/admin/races/:id/reprocess — Re-parse from stored JSON ────────

adminRouter.post(
  "/races/:id/reprocess",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await raceIngest.reprocessRace(req.params.id);

      await prisma.auditLog.create({
        data: {
          adminUserId: req.user!.userId,
          action: "REPROCESS_RACE",
          targetType: "race",
          targetId: req.params.id,
          details: {
            entries: result.entriesCreated,
            laps: result.lapsCreated,
          },
        },
      });

      res.json({
        message: "Race reprocessed",
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PUT /api/admin/races/:id/status — Quick publish/unpublish toggle ───────

adminRouter.put(
  "/races/:id/status",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body;
      if (!["DRAFT", "PUBLISHED"].includes(status)) {
        throw new AppError(400, 'Status must be "DRAFT" or "PUBLISHED"', "INVALID_STATUS");
      }

      await raceSvc.updateRace(req.params.id, { status });

      await prisma.auditLog.create({
        data: {
          adminUserId: req.user!.userId,
          action: status === "PUBLISHED" ? "PUBLISH_RACE" : "UNPUBLISH_RACE",
          targetType: "race",
          targetId: req.params.id,
        },
      });

      res.json({ message: `Race ${status.toLowerCase()}`, status });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/admin/stats — Dashboard statistics ─────────────────────────────

adminRouter.get(
  "/stats",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [userCount, subCounts, raceCounts] = await prisma.$transaction([
        prisma.user.count(),
        prisma.subscription.groupBy({
          by: ["plan"],
          _count: { plan: true },
        }),
        prisma.race.groupBy({
          by: ["status"],
          _count: { status: true },
        }),
      ]);

      res.json({
        totalUsers: userCount,
        subscriptions: Object.fromEntries(
          subCounts.map((s) => [s.plan, s._count.plan])
        ),
        races: Object.fromEntries(
          raceCounts.map((r) => [r.status, r._count.status])
        ),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/admin/audit-log — Recent admin actions ─────────────────────────

adminRouter.get(
  "/audit-log",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 100);

      const [logs, total] = await prisma.$transaction([
        prisma.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            admin: { select: { email: true, displayName: true } },
          },
        }),
        prisma.auditLog.count(),
      ]);

      res.json({
        logs: logs.map((l) => ({
          id: l.id,
          action: l.action,
          targetType: l.targetType,
          targetId: l.targetId,
          details: l.details,
          adminEmail: l.admin.email,
          adminName: l.admin.displayName,
          createdAt: l.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/admin/users — List users ───────────────────────────────────────

adminRouter.get(
  "/users",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 100);
      const search = (req.query.search as string) || "";
      const role = req.query.role as string | undefined;
      const plan = req.query.plan as string | undefined;

      const where: any = {};
      if (search) {
        where.OR = [
          { email: { contains: search, mode: "insensitive" } },
          { displayName: { contains: search, mode: "insensitive" } },
        ];
      }
      if (role) where.role = role;
      if (plan) where.subscription = { plan };

      const [users, total] = await prisma.$transaction([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            displayName: true,
            role: true,
            emailVerified: true,
            suspendedAt: true,
            lastLoginAt: true,
            createdAt: true,
            subscription: { select: { plan: true, status: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.user.count({ where }),
      ]);

      res.json({
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          role: u.role,
          emailVerified: u.emailVerified,
          suspended: !!u.suspendedAt,
          suspendedAt: u.suspendedAt?.toISOString() || null,
          lastLoginAt: u.lastLoginAt?.toISOString() || null,
          createdAt: u.createdAt.toISOString(),
          plan: u.subscription?.plan || "FREE",
          subscriptionStatus: u.subscription?.status || "ACTIVE",
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PUT /api/admin/users/:id/suspend — Toggle suspend ──────────────────────

adminRouter.put(
  "/users/:id/suspend",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!target) throw new AppError(404, "User not found", "USER_NOT_FOUND");
      if (target.id === req.user!.userId) {
        throw new AppError(400, "Cannot suspend yourself", "SELF_SUSPEND");
      }

      const isSuspended = !!target.suspendedAt;
      await prisma.user.update({
        where: { id: req.params.id },
        data: { suspendedAt: isSuspended ? null : new Date() },
      });

      await prisma.auditLog.create({
        data: {
          adminUserId: req.user!.userId,
          action: isSuspended ? "UNSUSPEND_USER" : "SUSPEND_USER",
          targetType: "user",
          targetId: req.params.id,
          details: { email: target.email },
        },
      });

      res.json({
        message: isSuspended ? "User unsuspended" : "User suspended",
        suspended: !isSuspended,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PUT /api/admin/users/:id/role — Change user role ───────────────────────

adminRouter.put(
  "/users/:id/role",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { role } = req.body;
      if (!["USER", "ADMIN"].includes(role)) {
        throw new AppError(400, 'Role must be "USER" or "ADMIN"', "INVALID_ROLE");
      }

      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!target) throw new AppError(404, "User not found", "USER_NOT_FOUND");
      if (target.id === req.user!.userId && role !== "ADMIN") {
        throw new AppError(400, "Cannot demote yourself", "SELF_DEMOTE");
      }

      await prisma.user.update({
        where: { id: req.params.id },
        data: { role },
      });

      await prisma.auditLog.create({
        data: {
          adminUserId: req.user!.userId,
          action: role === "ADMIN" ? "PROMOTE_ADMIN" : "DEMOTE_USER",
          targetType: "user",
          targetId: req.params.id,
          details: { email: target.email, newRole: role },
        },
      });

      res.json({ message: `User role changed to ${role}`, role });
    } catch (err) {
      next(err);
    }
  }
);

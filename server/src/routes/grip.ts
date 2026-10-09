/**
 * Finding Grip API — mounted at /api/grip.
 *
 * Rules enforced here, never only in the client:
 *  - every query is scoped to the signed-in user
 *  - the free allowance and the Pro-only damper tool
 *  - a reference session needs all four hot pressures before it can be used
 *  - pressures are PSI and temperatures °F on the wire and in the database
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { GripCalculation, GripReferenceSession, GripTrack } from "@prisma/client";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { AppError } from "../middleware/error-handler.js";
import { prisma } from "../models/prisma.js";
import { env } from "../config/env.js";
import {
  getOrCreateGripAccount,
  gripIsFree,
  hasGripPro,
  serializeGripAccount,
  FREE_CALCULATION_LIMIT,
} from "../services/grip/account.js";
import {
  calculateColdPressures,
  getDeployedModel,
  CalcModelError,
} from "../services/grip/calc.js";
import {
  damperQuerySchema,
  damperRowSchema,
  validateDamperTable,
  replaceDamperTable,
  lookupDamperScenario,
  DAMPER_SCENARIO_COUNT,
} from "../services/grip/damper.js";
import {
  createGripCheckoutSession,
  createGripPortalSession,
} from "../services/grip/billing.js";

export const gripRouter = Router();

type Handler = (req: Request, res: Response) => Promise<void>;
const idParam = (req: Request) => String(req.params.id);
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

// ─── Access gate ─────────────────────────────────────────────────────────────

function testerEmails(): Set<string> {
  return new Set(
    (env.GRIP_TESTER_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function canUseGrip(user: { email: string; role: "USER" | "ADMIN" }): boolean {
  switch (env.GRIP_ACCESS) {
    case "public":
      return true;
    case "testers":
      return user.role === "ADMIN" || testerEmails().has(user.email.toLowerCase());
    case "admin":
      return user.role === "ADMIN";
    default:
      return false;
  }
}

async function isEmailVerified(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true },
  });
  return !!user?.emailVerified;
}

function requireGripAccess(req: Request, _res: Response, next: NextFunction) {
  if (!req.user)
    return next(new AppError(401, "Authentication required", "AUTH_REQUIRED"));
  const user = req.user;
  if (!canUseGrip(user)) {
    return next(
      new AppError(403, "Finding Grip is in private testing", "GRIP_NOT_AVAILABLE")
    );
  }
  // The tester list names email addresses, so only a verified address counts;
  // otherwise anyone could register a listed address that has no account yet.
  if (env.GRIP_ACCESS === "testers" && user.role !== "ADMIN") {
    isEmailVerified(user.userId)
      .then((verified) =>
        verified
          ? next()
          : next(
              new AppError(
                403,
                "Verify your email to use Finding Grip",
                "EMAIL_NOT_VERIFIED"
              )
            )
      )
      .catch(next);
    return;
  }
  next();
}

/** Per-user limit on the two endpoints that expose proprietary results. */
const resultLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? "anonymous",
  message: { error: "Too many requests. Please slow down.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Public: lets the client decide whether to show the marketing pages to signed-out visitors. */
gripRouter.get("/status", (_req, res) => {
  res.json({ open: env.GRIP_ACCESS === "public", free: gripIsFree() });
});

gripRouter.use(requireAuth, requireGripAccess);

// ─── Validation ──────────────────────────────────────────────────────────────

const PSI_MIN = 5;
const PSI_MAX = 60;
const psi = z
  .number()
  .finite()
  .min(PSI_MIN, "Pressure looks too low for PSI")
  .max(PSI_MAX, "Pressure looks too high for PSI");
const degF = z
  .number()
  .finite()
  .min(-40, "Temperature looks too low for °F")
  .max(250, "Temperature looks too high for °F");
const minutes = z.number().int().min(1).max(600);
const corners = <T extends z.ZodTypeAny>(v: T) =>
  z.object({ lf: v, rf: v, lr: v, rr: v });
const weather = z.enum(["DRY", "WET"]);
const name = z.string().trim().min(1, "Name is required").max(100);
const notes = z.string().trim().max(2000).nullable().optional();

const sessionSchema = z.object({
  name,
  trackId: z.string().min(1, "Track is required"),
  weather: weather.default("DRY"),
  trackTemp: degF,
  ambientTemp: degF,
  durationMin: minutes,
  cold: corners(psi),
  hot: corners(psi.nullable()).optional(),
  wheel: corners(degF),
  notes,
});

const calculationSchema = z.object({
  referenceSessionId: z.string().min(1),
  name,
  weather,
  trackTemp: degF,
  ambientTemp: degF,
  durationMin: minutes,
  wheel: corners(degF),
  target: corners(psi),
});

const convertSchema = z.object({
  name,
  hot: corners(psi),
  notes,
});

const trackSchema = z.object({
  name: z.string().trim().min(2).max(120),
  shortName: z
    .string()
    .trim()
    .min(1)
    .max(8)
    .transform((v) => v.toUpperCase()),
  country: z.string().trim().max(60).nullable().optional(),
  logoUrl: z.string().trim().url().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

// ─── Serializers ─────────────────────────────────────────────────────────────

const trackOut = (t: GripTrack) => ({
  id: t.id,
  name: t.name,
  shortName: t.shortName,
  country: t.country,
  logoUrl: t.logoUrl,
  isActive: t.isActive,
});

function sessionOut(s: GripReferenceSession & { track: GripTrack }) {
  const hot = { lf: s.hotLf, rf: s.hotRf, lr: s.hotLr, rr: s.hotRr };
  return {
    id: s.id,
    name: s.name,
    track: trackOut(s.track),
    sessionDate: s.sessionDate,
    weather: s.weather,
    trackTemp: s.trackTemp,
    ambientTemp: s.ambientTemp,
    durationMin: s.durationMin,
    cold: { lf: s.coldLf, rf: s.coldRf, lr: s.coldLr, rr: s.coldRr },
    hot,
    wheel: { lf: s.wheelLf, rf: s.wheelRf, lr: s.wheelLr, rr: s.wheelRr },
    notes: s.notes,
    useCount: s.useCount,
    /** True when it can be used as the basis for a calculation. */
    ready: Object.values(hot).every((v) => v !== null),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function calculationOut(c: GripCalculation & { track: GripTrack }) {
  return {
    id: c.id,
    name: c.name,
    referenceSessionId: c.referenceSessionId,
    referenceName: c.referenceName,
    track: trackOut(c.track),
    sessionDate: c.sessionDate,
    weather: c.weather,
    trackTemp: c.trackTemp,
    ambientTemp: c.ambientTemp,
    durationMin: c.durationMin,
    wheel: { lf: c.wheelLf, rf: c.wheelRf, lr: c.wheelLr, rr: c.wheelRr },
    target: { lf: c.targetLf, rf: c.targetRf, lr: c.targetLr, rr: c.targetRr },
    result: { lf: c.resultLf, rf: c.resultRf, lr: c.resultLr, rr: c.resultRr },
    referenceCold: { lf: c.refColdLf, rf: c.refColdRf, lr: c.refColdLr, rr: c.refColdRr },
    convertedToRef: c.convertedToRef,
    createdAt: c.createdAt,
  };
}

function sessionData(input: z.infer<typeof sessionSchema>) {
  return {
    name: input.name,
    trackId: input.trackId,
    weather: input.weather,
    trackTemp: input.trackTemp,
    ambientTemp: input.ambientTemp,
    durationMin: input.durationMin,
    coldLf: input.cold.lf,
    coldRf: input.cold.rf,
    coldLr: input.cold.lr,
    coldRr: input.cold.rr,
    hotLf: input.hot?.lf ?? null,
    hotRf: input.hot?.rf ?? null,
    hotLr: input.hot?.lr ?? null,
    hotRr: input.hot?.rr ?? null,
    wheelLf: input.wheel.lf,
    wheelRf: input.wheel.rf,
    wheelLr: input.wheel.lr,
    wheelRr: input.wheel.rr,
    notes: input.notes || null,
  };
}

async function assertActiveTrack(trackId: string) {
  const track = await prisma.gripTrack.findUnique({ where: { id: trackId } });
  if (!track || !track.isActive)
    throw new AppError(400, "Choose a track from the list", "INVALID_TRACK");
}

async function ownSession(userId: string, id: string) {
  const session = await prisma.gripReferenceSession.findFirst({
    where: { id, userId },
    include: { track: true },
  });
  if (!session) throw new AppError(404, "Reference session not found", "NOT_FOUND");
  return session;
}

async function ownCalculation(userId: string, id: string) {
  const calc = await prisma.gripCalculation.findFirst({
    where: { id, userId },
    include: { track: true },
  });
  if (!calc) throw new AppError(404, "Calculation not found", "NOT_FOUND");
  return calc;
}

// ─── Account ─────────────────────────────────────────────────────────────────

gripRouter.get(
  "/me",
  wrap(async (req, res) => {
    const account = await getOrCreateGripAccount(req.user!.userId);
    res.json({
      account: serializeGripAccount(account, req.user!.role),
      checkoutAvailable: !!env.STRIPE_GRIP_PRO_PRICE_ID,
      calculatorAvailable: !!getDeployedModel().model,
    });
  })
);

gripRouter.put(
  "/me",
  wrap(async (req, res) => {
    const { units } = z.object({ units: z.enum(["STANDARD", "METRIC"]) }).parse(req.body);
    const account = await prisma.gripAccount.upsert({
      where: { userId: req.user!.userId },
      create: { userId: req.user!.userId, units },
      update: { units },
    });
    res.json({ account: serializeGripAccount(account, req.user!.role) });
  })
);

// ─── Tracks ──────────────────────────────────────────────────────────────────

gripRouter.get(
  "/tracks",
  wrap(async (_req, res) => {
    const tracks = await prisma.gripTrack.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    res.json({ tracks: tracks.map(trackOut) });
  })
);

// ─── Reference sessions ──────────────────────────────────────────────────────

gripRouter.get(
  "/sessions",
  wrap(async (req, res) => {
    const sessions = await prisma.gripReferenceSession.findMany({
      where: { userId: req.user!.userId },
      include: { track: true },
      orderBy: { sessionDate: "desc" },
      take: 500,
    });
    res.json({ sessions: sessions.map(sessionOut) });
  })
);

gripRouter.post(
  "/sessions",
  wrap(async (req, res) => {
    const input = sessionSchema.parse(req.body);
    await assertActiveTrack(input.trackId);
    const created = await prisma.gripReferenceSession.create({
      data: { userId: req.user!.userId, ...sessionData(input) },
      include: { track: true },
    });
    res.status(201).json({ session: sessionOut(created) });
  })
);

gripRouter.get(
  "/sessions/:id",
  wrap(async (req, res) => {
    res.json({ session: sessionOut(await ownSession(req.user!.userId, idParam(req))) });
  })
);

gripRouter.put(
  "/sessions/:id",
  wrap(async (req, res) => {
    const existing = await ownSession(req.user!.userId, idParam(req));
    const input = sessionSchema.parse(req.body);
    if (input.trackId !== existing.trackId) await assertActiveTrack(input.trackId);
    const updated = await prisma.gripReferenceSession.update({
      where: { id: existing.id },
      data: sessionData(input),
      include: { track: true },
    });
    res.json({ session: sessionOut(updated) });
  })
);

gripRouter.delete(
  "/sessions/:id",
  wrap(async (req, res) => {
    const existing = await ownSession(req.user!.userId, idParam(req));
    // Calculations made from it stay in the user's history (reference set to null).
    await prisma.gripReferenceSession.delete({ where: { id: existing.id } });
    res.status(204).end();
  })
);

// ─── Calculations ────────────────────────────────────────────────────────────

gripRouter.get(
  "/calculations",
  wrap(async (req, res) => {
    const calculations = await prisma.gripCalculation.findMany({
      where: { userId: req.user!.userId },
      include: { track: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ calculations: calculations.map(calculationOut) });
  })
);

gripRouter.get(
  "/calculations/:id",
  wrap(async (req, res) => {
    res.json({
      calculation: calculationOut(await ownCalculation(req.user!.userId, idParam(req))),
    });
  })
);

gripRouter.post(
  "/calculations",
  resultLimiter,
  wrap(async (req, res) => {
    const userId = req.user!.userId;
    const input = calculationSchema.parse(req.body);
    const ref = await ownSession(userId, input.referenceSessionId);

    if (
      ref.hotLf === null ||
      ref.hotRf === null ||
      ref.hotLr === null ||
      ref.hotRr === null
    ) {
      throw new AppError(
        422,
        "Add all four hot pressures to this reference session before calculating from it",
        "REFERENCE_INCOMPLETE"
      );
    }

    const { model, error } = getDeployedModel();
    if (!model) {
      console.error(`Finding Grip calculation unavailable: ${error}`);
      throw new AppError(
        503,
        "The calculator is not available yet",
        "CALCULATOR_UNAVAILABLE"
      );
    }

    const account = await getOrCreateGripAccount(userId);
    const isPro = hasGripPro(account, req.user!.role);

    // The free allowance is per account, so it is only worth something if
    // accounts are tied to a real address.
    if (req.user!.role !== "ADMIN" && !(await isEmailVerified(userId))) {
      throw new AppError(
        403,
        "Verify your email address to run calculations",
        "EMAIL_NOT_VERIFIED"
      );
    }

    let result;
    try {
      result = calculateColdPressures(model, {
        wet: input.weather === "WET",
        trackTemp: input.trackTemp,
        ambientTemp: input.ambientTemp,
        duration: input.durationMin,
        wheel: {
          Lf: input.wheel.lf,
          Rf: input.wheel.rf,
          Lr: input.wheel.lr,
          Rr: input.wheel.rr,
        },
        target: {
          Lf: input.target.lf,
          Rf: input.target.rf,
          Lr: input.target.lr,
          Rr: input.target.rr,
        },
        reference: {
          trackTemp: ref.trackTemp,
          ambientTemp: ref.ambientTemp,
          duration: ref.durationMin,
          cold: { Lf: ref.coldLf, Rf: ref.coldRf, Lr: ref.coldLr, Rr: ref.coldRr },
          hot: { Lf: ref.hotLf, Rf: ref.hotRf, Lr: ref.hotLr, Rr: ref.hotRr },
          wheel: { Lf: ref.wheelLf, Rf: ref.wheelRf, Lr: ref.wheelLr, Rr: ref.wheelRr },
        },
      });
    } catch (err) {
      if (err instanceof CalcModelError) {
        console.error(`Finding Grip calculation failed: ${err.message}`);
        throw new AppError(
          503,
          "The calculator is not available yet",
          "CALCULATOR_UNAVAILABLE"
        );
      }
      throw err;
    }

    // A result outside the range a session can hold means the inputs do not
    // describe a real run. Say so instead of saving it or using up a free
    // calculation.
    if (Object.values(result).some((v) => v < PSI_MIN || v > PSI_MAX)) {
      throw new AppError(
        422,
        "Those inputs give a pressure outside the usable range. Check the temperatures, duration and targets.",
        "RESULT_OUT_OF_RANGE"
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      if (isPro) {
        await tx.gripAccount.update({
          where: { userId },
          data: { calcCount: { increment: 1 } },
        });
      } else {
        // Conditional increment so two simultaneous requests cannot both take the last free one.
        const claimed = await tx.gripAccount.updateMany({
          where: { userId, calcCount: { lt: FREE_CALCULATION_LIMIT } },
          data: { calcCount: { increment: 1 } },
        });
        if (claimed.count === 0) return null;
      }

      await tx.gripReferenceSession.update({
        where: { id: ref.id },
        data: { useCount: { increment: 1 } },
      });

      return tx.gripCalculation.create({
        data: {
          userId,
          referenceSessionId: ref.id,
          referenceName: ref.name,
          trackId: ref.trackId,
          name: input.name,
          weather: input.weather,
          trackTemp: input.trackTemp,
          ambientTemp: input.ambientTemp,
          durationMin: input.durationMin,
          wheelLf: input.wheel.lf,
          wheelRf: input.wheel.rf,
          wheelLr: input.wheel.lr,
          wheelRr: input.wheel.rr,
          targetLf: input.target.lf,
          targetRf: input.target.rf,
          targetLr: input.target.lr,
          targetRr: input.target.rr,
          resultLf: result.Lf,
          resultRf: result.Rf,
          resultLr: result.Lr,
          resultRr: result.Rr,
          refColdLf: ref.coldLf,
          refColdRf: ref.coldRf,
          refColdLr: ref.coldLr,
          refColdRr: ref.coldRr,
        },
        include: { track: true },
      });
    });

    if (!created) {
      res.status(403).json({
        error: `You've used your ${FREE_CALCULATION_LIMIT} free calculations. Upgrade to Pro for unlimited calculations.`,
        code: "UPGRADE_REQUIRED",
        upgrade_required: true,
      });
      return;
    }

    const updatedAccount = await getOrCreateGripAccount(userId);
    res.status(201).json({
      calculation: calculationOut(created),
      account: serializeGripAccount(updatedAccount, req.user!.role),
    });
  })
);

gripRouter.delete(
  "/calculations/:id",
  wrap(async (req, res) => {
    const existing = await ownCalculation(req.user!.userId, idParam(req));
    await prisma.gripCalculation.delete({ where: { id: existing.id } });
    res.status(204).end();
  })
);

gripRouter.post(
  "/calculations/:id/convert",
  wrap(async (req, res) => {
    const userId = req.user!.userId;
    const calc = await ownCalculation(userId, idParam(req));
    if (calc.convertedToRef) {
      throw new AppError(
        409,
        "This calculation has already been converted",
        "ALREADY_CONVERTED"
      );
    }
    const input = convertSchema.parse(req.body);

    const session = await prisma.$transaction(async (tx) => {
      // Claim it first so a double submit cannot create two reference sessions.
      const claimed = await tx.gripCalculation.updateMany({
        where: { id: calc.id, userId, convertedToRef: false },
        data: { convertedToRef: true },
      });
      if (claimed.count === 0) {
        throw new AppError(
          409,
          "This calculation has already been converted",
          "ALREADY_CONVERTED"
        );
      }
      return tx.gripReferenceSession.create({
        data: {
          userId,
          name: input.name,
          trackId: calc.trackId,
          sessionDate: calc.sessionDate,
          weather: calc.weather,
          trackTemp: calc.trackTemp,
          ambientTemp: calc.ambientTemp,
          durationMin: calc.durationMin,
          // The cold pressures that were set for the run are the calculated ones.
          coldLf: calc.resultLf,
          coldRf: calc.resultRf,
          coldLr: calc.resultLr,
          coldRr: calc.resultRr,
          hotLf: input.hot.lf,
          hotRf: input.hot.rf,
          hotLr: input.hot.lr,
          hotRr: input.hot.rr,
          wheelLf: calc.wheelLf,
          wheelRf: calc.wheelRf,
          wheelLr: calc.wheelLr,
          wheelRr: calc.wheelRr,
          notes: input.notes || null,
        },
        include: { track: true },
      });
    });

    res.status(201).json({ session: sessionOut(session) });
  })
);

// ─── Damper tuning (Pro) ─────────────────────────────────────────────────────

gripRouter.get(
  "/damper",
  resultLimiter,
  wrap(async (req, res) => {
    const account = await getOrCreateGripAccount(req.user!.userId);
    if (!hasGripPro(account, req.user!.role)) {
      res.status(403).json({
        error: "The Damper Tuning Tool is available with Finding Grip Pro",
        code: "UPGRADE_REQUIRED",
        upgrade_required: true,
      });
      return;
    }
    const query = damperQuerySchema.parse(req.query);
    const found = await lookupDamperScenario(query);
    if (!found)
      throw new AppError(
        503,
        "The damper tool is not available yet",
        "DAMPER_UNAVAILABLE"
      );
    res.json({ ...found, scenarioCount: DAMPER_SCENARIO_COUNT });
  })
);

// ─── Export ──────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formulas in user-entered text.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

gripRouter.get(
  "/export",
  wrap(async (req, res) => {
    const userId = req.user!.userId;
    const [sessions, calcs] = await Promise.all([
      prisma.gripReferenceSession.findMany({
        where: { userId },
        include: { track: true },
        orderBy: { sessionDate: "asc" },
      }),
      prisma.gripCalculation.findMany({
        where: { userId },
        include: { track: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const header = [
      "type",
      "name",
      "date",
      "track",
      "weather",
      "track_temp_f",
      "ambient_temp_f",
      "duration_min",
      "wheel_temp_lf_f",
      "wheel_temp_rf_f",
      "wheel_temp_lr_f",
      "wheel_temp_rr_f",
      "cold_lf_psi",
      "cold_rf_psi",
      "cold_lr_psi",
      "cold_rr_psi",
      "hot_lf_psi",
      "hot_rf_psi",
      "hot_lr_psi",
      "hot_rr_psi",
      "target_hot_lf_psi",
      "target_hot_rf_psi",
      "target_hot_lr_psi",
      "target_hot_rr_psi",
      "reference",
      "notes",
    ];
    const rows: unknown[][] = [header];
    for (const s of sessions) {
      rows.push([
        "reference_session",
        s.name,
        s.sessionDate,
        s.track.name,
        s.weather,
        s.trackTemp,
        s.ambientTemp,
        s.durationMin,
        s.wheelLf,
        s.wheelRf,
        s.wheelLr,
        s.wheelRr,
        s.coldLf,
        s.coldRf,
        s.coldLr,
        s.coldRr,
        s.hotLf,
        s.hotRf,
        s.hotLr,
        s.hotRr,
        "",
        "",
        "",
        "",
        "",
        s.notes,
      ]);
    }
    for (const c of calcs) {
      rows.push([
        "calculation",
        c.name,
        c.sessionDate,
        c.track.name,
        c.weather,
        c.trackTemp,
        c.ambientTemp,
        c.durationMin,
        c.wheelLf,
        c.wheelRf,
        c.wheelLr,
        c.wheelRr,
        c.resultLf,
        c.resultRf,
        c.resultLr,
        c.resultRr,
        "",
        "",
        "",
        "",
        c.targetLf,
        c.targetRf,
        c.targetLr,
        c.targetRr,
        c.referenceName,
        "",
      ]);
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="finding-grip-export.csv"'
    );
    // Leading BOM so Excel reads accented track and session names correctly.
    res.send("\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n");
  })
);

// ─── Billing ─────────────────────────────────────────────────────────────────

gripRouter.post(
  "/billing/checkout",
  wrap(async (req, res) => {
    if (gripIsFree()) {
      throw new AppError(
        409,
        "Finding Grip is free. There is nothing to buy.",
        "FREE_FOR_ALL"
      );
    }
    const account = await getOrCreateGripAccount(req.user!.userId);
    if (account.plan === "PRO" && hasGripPro(account, "USER")) {
      throw new AppError(409, "You already have Finding Grip Pro", "ALREADY_SUBSCRIBED");
    }
    res.json({ url: await createGripCheckoutSession(req.user!.userId) });
  })
);

gripRouter.post(
  "/billing/portal",
  wrap(async (req, res) => {
    res.json({ url: await createGripPortalSession(req.user!.userId) });
  })
);

// ─── Admin ───────────────────────────────────────────────────────────────────

const admin = Router();
admin.use(requireAdmin);

admin.get(
  "/overview",
  wrap(async (_req, res) => {
    const [accounts, pro, sessions, calculations, tracks, damperRows] = await Promise.all(
      [
        prisma.gripAccount.count(),
        prisma.gripAccount.count({
          where: { plan: "PRO", status: { in: ["ACTIVE", "TRIALING"] } },
        }),
        prisma.gripReferenceSession.count(),
        prisma.gripCalculation.count(),
        prisma.gripTrack.count({ where: { isActive: true } }),
        prisma.gripDamperScenario.count(),
      ]
    );
    const { model, error } = getDeployedModel();
    res.json({
      counts: { accounts, pro, sessions, calculations, tracks },
      setup: {
        access: env.GRIP_ACCESS,
        pricing: gripIsFree() ? "free" : "paid",
        testerCount: testerEmails().size,
        calcModel: { ready: !!model, version: model?.version ?? null, problem: error },
        damperTable: {
          rows: damperRows,
          expected: DAMPER_SCENARIO_COUNT,
          ready: damperRows === DAMPER_SCENARIO_COUNT,
        },
        stripePrice: { ready: !!env.STRIPE_GRIP_PRO_PRICE_ID },
      },
    });
  })
);

admin.get(
  "/tracks",
  wrap(async (_req, res) => {
    const tracks = await prisma.gripTrack.findMany({ orderBy: { name: "asc" } });
    res.json({ tracks: tracks.map(trackOut) });
  })
);

admin.post(
  "/tracks",
  wrap(async (req, res) => {
    const input = trackSchema.parse(req.body);
    const exists = await prisma.gripTrack.findUnique({ where: { name: input.name } });
    if (exists)
      throw new AppError(409, "A track with that name already exists", "TRACK_EXISTS");
    const track = await prisma.gripTrack
      .create({
        data: {
          name: input.name,
          shortName: input.shortName,
          country: input.country ?? null,
          logoUrl: input.logoUrl ?? null,
        },
      })
      .catch((err: { code?: string }) => {
        // Two admins adding the same track at once: the unique index decides.
        if (err?.code === "P2002") {
          throw new AppError(
            409,
            "A track with that name already exists",
            "TRACK_EXISTS"
          );
        }
        throw err;
      });
    await prisma.auditLog.create({
      data: {
        adminUserId: req.user!.userId,
        action: "GRIP_ADD_TRACK",
        targetType: "grip_track",
        targetId: track.id,
        details: { name: track.name },
      },
    });
    res.status(201).json({ track: trackOut(track) });
  })
);

admin.put(
  "/tracks/:id",
  wrap(async (req, res) => {
    const input = trackSchema.parse(req.body);
    const existing = await prisma.gripTrack.findUnique({ where: { id: idParam(req) } });
    if (!existing) throw new AppError(404, "Track not found", "NOT_FOUND");
    const clash = await prisma.gripTrack.findFirst({
      where: { name: input.name, NOT: { id: existing.id } },
    });
    if (clash)
      throw new AppError(409, "A track with that name already exists", "TRACK_EXISTS");
    const track = await prisma.gripTrack.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        shortName: input.shortName,
        // Only touch optional fields that were actually sent.
        ...(input.country === undefined ? {} : { country: input.country }),
        ...(input.logoUrl === undefined ? {} : { logoUrl: input.logoUrl }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
    });
    await prisma.auditLog.create({
      data: {
        adminUserId: req.user!.userId,
        action: "GRIP_UPDATE_TRACK",
        targetType: "grip_track",
        targetId: track.id,
        details: { name: track.name, isActive: track.isActive },
      },
    });
    res.json({ track: trackOut(track) });
  })
);

admin.put(
  "/damper-scenarios",
  wrap(async (req, res) => {
    const { scenarios } = z
      .object({ scenarios: z.array(damperRowSchema).max(500) })
      .parse(req.body);
    const problems = validateDamperTable(scenarios);
    if (problems.length > 0) {
      res.status(400).json({
        error: "The damper table is not complete",
        code: "DAMPER_TABLE_INVALID",
        problems,
      });
      return;
    }
    await replaceDamperTable(scenarios);
    await prisma.auditLog.create({
      data: {
        adminUserId: req.user!.userId,
        action: "GRIP_REPLACE_DAMPER_TABLE",
        targetType: "grip_damper_table",
        targetId: "all",
        details: { rows: scenarios.length },
      },
    });
    res.json({ rows: scenarios.length });
  })
);

gripRouter.use("/admin", admin);

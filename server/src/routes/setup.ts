/**
 * Setup Sheet API — mounted at /api/setup.
 *
 * Rules enforced here, never only in the client:
 *  - every record belongs to a team, and every request checks the caller's
 *    role in that team (VIEWER < ENGINEER < OWNER)
 *  - a team always keeps at least one owner
 *  - an invite is honoured only for a verified email address
 *  - every change to a sheet's values is recorded as a revision (who, when,
 *    each key from → to), written in the same transaction as the change
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Prisma, SetupRole, SetupSession, SetupSheet } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/error-handler.js";
import { prisma } from "../models/prisma.js";
import { env } from "../config/env.js";
import { setupSite, siteForRequest } from "../services/site.js";
import { sendSetupInviteEmail } from "../services/email.js";
import {
  requireSetupAccess,
  requireTeamRole,
  roleAtLeast,
} from "../services/setup/access.js";
import {
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  applyPatch,
  carryForward,
  dateOnlySchema,
  diffValues,
  fromDateOnly,
  normalizeEmail,
  readValues,
  sheetPatchSchema,
  sheetValuesSchema,
  toDateOnly,
  cleanValues,
  type SheetValues,
} from "../services/setup/values.js";
import {
  serializeCar,
  serializeEvent,
  serializeNote,
  serializeRevision,
  serializeSession,
  serializeSheet,
  type PersonLookup,
} from "../services/setup/serialize.js";

export const setupRouter = Router();

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);
const param = (req: Request, name: string) => String(req.params[name]);
const uid = (req: Request) => req.user!.userId;
const notFound = () => new AppError(404, "Not found", "NOT_FOUND");

// ─── Rate limits ─────────────────────────────────────────────────────────────
// Mounted ahead of the shared per-IP API limit (see app.ts): a crew on one
// paddock Wi-Fi shares an address, and open sessions poll for changes. So the
// limit that matters is per person; the per-IP one is only a backstop.

const ipBackstop = rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  message: { error: "Too many requests. Please slow down.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

const perUser = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? "anonymous",
  message: { error: "Too many requests. Please slow down.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Invites send email, so they get their own, much lower limit. */
const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? "anonymous",
  message: { error: "That's a lot of invites in one hour. Try again later.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Imports are heavy transactions. */
const importLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? "anonymous",
  message: { error: "Too many imports in a short time. Try again in a few minutes.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

setupRouter.use(ipBackstop);

/** Public: lets the client show a friendly message to signed-out visitors. */
setupRouter.get("/status", (_req, res) => {
  res.json({ open: env.SETUP_ACCESS === "public", siteUrl: setupSite()?.url ?? null });
});

setupRouter.use(requireAuth, perUser, requireSetupAccess);

// ─── Validation ──────────────────────────────────────────────────────────────

const name = z.string().trim().min(1, "Required").max(MAX_NAME_LENGTH);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const roleSchema = z.enum(["OWNER", "ENGINEER", "VIEWER"]);
const sessionKind = z.enum(["TEST", "PRACTICE", "QUALIFYING", "RACE", "OTHER"]);
const sheetKind = z.enum(["TARGET", "ACTUAL"]);
const noteCategory = z.enum(["DRIVER", "ENGINEER", "CHANGE", "GENERAL"]);

const carReference = z
  .record(z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/), z.string().max(2000))
  .refine((r) => Object.keys(r).length <= 30, "At most 30 reference notes");

const carInput = z.object({
  name,
  number: optionalText(20),
  carClass: optionalText(60),
  reference: carReference.optional(),
  archived: z.boolean().optional(),
});

const eventInput = z.object({
  name,
  track: optionalText(MAX_NAME_LENGTH),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  notes: optionalText(MAX_NOTES_LENGTH),
});

const sheetInput = z.object({
  data: sheetValuesSchema,
  notes: optionalText(MAX_NOTES_LENGTH),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function lookupPeople(ids: (string | null | undefined)[]): Promise<PersonLookup> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, displayName: true, email: true },
  });
  return new Map(users.map((u) => [u.id, { displayName: u.displayName, email: u.email }]));
}

/** A session, after checking the caller's role in its team. */
async function sessionFor(req: Request, id: string, minimum: SetupRole = "VIEWER") {
  const session = await prisma.setupSession.findUnique({ where: { id } });
  if (!session) throw notFound();
  const role = await requireTeamRole(session.teamId, uid(req), minimum);
  return { session, role };
}

/** A sheet, after checking the caller's role in its team. */
async function sheetFor(req: Request, id: string, minimum: SetupRole = "VIEWER") {
  const sheet = await prisma.setupSheet.findUnique({
    where: { id },
    include: { session: { select: { teamId: true } } },
  });
  if (!sheet) throw notFound();
  const role = await requireTeamRole(sheet.session.teamId, uid(req), minimum);
  return { sheet, role };
}

type HistoryEntry = {
  id: string;
  name: string;
  kind: SetupSession["kind"];
  seq: number;
  sessionDate: string | null;
  eventId: string;
  eventName: string;
  eventStartDate: string | null;
};

/** Every session of a car, oldest first: by event date, then order within the event. */
async function carHistory(carId: string): Promise<HistoryEntry[]> {
  const sessions = await prisma.setupSession.findMany({
    where: { carId },
    include: { event: { select: { id: true, name: true, startDate: true, createdAt: true } } },
  });
  sessions.sort((a, b) => {
    const da = (a.event.startDate ?? a.event.createdAt).getTime();
    const db = (b.event.startDate ?? b.event.createdAt).getTime();
    if (a.eventId !== b.eventId) return da - db || a.eventId.localeCompare(b.eventId);
    return a.seq - b.seq || a.createdAt.getTime() - b.createdAt.getTime();
  });
  return sessions.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    seq: s.seq,
    sessionDate: fromDateOnly(s.sessionDate),
    eventId: s.eventId,
    eventName: s.event.name,
    eventStartDate: fromDateOnly(s.event.startDate),
  }));
}

/** The sheet a following session should start from: its actual, else its target. */
function bestSheet(sheets: Pick<SetupSheet, "kind" | "data">[]): SheetValues | null {
  const pick = sheets.find((s) => s.kind === "ACTUAL") ?? sheets.find((s) => s.kind === "TARGET");
  return pick ? readValues(pick.data) : null;
}

/** Create a sheet and record its starting values as the first revision. */
async function createSheetWithRevision(
  tx: Prisma.TransactionClient,
  input: { sessionId: string; kind: "TARGET" | "ACTUAL"; data: SheetValues; notes: string | null; userId: string }
) {
  const sheet = await tx.setupSheet.create({
    data: {
      sessionId: input.sessionId,
      kind: input.kind,
      data: input.data,
      notes: input.notes,
      updatedById: input.userId,
    },
  });
  const changes = diffValues({}, input.data);
  if (changes.length > 0 || input.notes) {
    await tx.setupSheetRevision.create({
      data: {
        sheetId: sheet.id,
        changes: changes as unknown as Prisma.InputJsonValue,
        notesChanged: !!input.notes,
        changedById: input.userId,
      },
    });
  }
  return sheet;
}

/**
 * Change a team's membership with its owner rows locked, so two owners
 * demoting or removing each other at the same moment can't leave the team
 * with none. `change` runs only if the team still has another owner, or if
 * the member being changed isn't an owner.
 */
async function changeMemberKeepingAnOwner(
  teamId: string,
  userId: string,
  losesOwnership: (member: { role: SetupRole }) => boolean,
  change: (tx: Prisma.TransactionClient) => Promise<unknown>,
  message: string
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT user_id FROM setup_team_members WHERE team_id = ${teamId} AND role = 'OWNER' FOR UPDATE`;
    const member = await tx.setupTeamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
    if (!member) throw notFound();
    if (member.role === "OWNER" && losesOwnership(member)) {
      const owners = await tx.setupTeamMember.count({ where: { teamId, role: "OWNER" } });
      if (owners <= 1) throw new AppError(409, message, "LAST_OWNER");
    }
    await change(tx);
  });
}

// ─── Me and teams ────────────────────────────────────────────────────────────

/** The caller's teams. Also joins any team that invited their (verified) email. */
setupRouter.get(
  "/me",
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: uid(req) },
      select: { id: true, email: true, displayName: true, emailVerified: true },
    });
    if (!user) throw new AppError(401, "Account not found", "INVALID_ACCOUNT");
    const memberships = await prisma.setupTeamMember.findMany({
      where: { userId: user.id },
      include: { team: { include: { _count: { select: { members: true } } } } },
      orderBy: { team: { name: "asc" } },
    });
    // Invites are offered only to a verified address; the person accepts or declines.
    const email = normalizeEmail(user.email);
    const invites = user.emailVerified
      ? await prisma.setupInvite.findMany({
          where: { email },
          include: {
            team: { select: { name: true } },
            invitedBy: { select: { displayName: true, email: true } },
          },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const waitingInvites = user.emailVerified ? 0 : await prisma.setupInvite.count({ where: { email } });
    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName, emailVerified: user.emailVerified },
      teams: memberships.map((m) => ({
        id: m.team.id,
        name: m.team.name,
        role: m.role,
        memberCount: m.team._count.members,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        teamId: i.teamId,
        teamName: i.team.name,
        role: i.role,
        invitedByName: i.invitedBy ? i.invitedBy.displayName || i.invitedBy.email : null,
        createdAt: i.createdAt,
      })),
      // Invites waiting for this account to verify its email; the client says so.
      waitingInvites,
    });
  })
);

/** The invite must be addressed to the caller's verified email. */
async function ownInvite(req: Request) {
  const [user, invite] = await Promise.all([
    prisma.user.findUnique({ where: { id: uid(req) }, select: { email: true, emailVerified: true } }),
    prisma.setupInvite.findUnique({ where: { id: param(req, "id") } }),
  ]);
  if (!user || !invite || invite.email !== normalizeEmail(user.email)) throw notFound();
  if (!user.emailVerified) throw new AppError(403, "Verify your email to accept invites", "EMAIL_NOT_VERIFIED");
  return invite;
}

setupRouter.post(
  "/invites/:id/accept",
  wrap(async (req, res) => {
    const invite = await ownInvite(req);
    await prisma.$transaction([
      prisma.setupTeamMember.upsert({
        where: { teamId_userId: { teamId: invite.teamId, userId: uid(req) } },
        create: { teamId: invite.teamId, userId: uid(req), role: invite.role },
        update: {},
      }),
      prisma.setupInvite.delete({ where: { id: invite.id } }),
    ]);
    res.json({ teamId: invite.teamId });
  })
);

setupRouter.post(
  "/invites/:id/decline",
  wrap(async (req, res) => {
    const invite = await ownInvite(req);
    await prisma.setupInvite.delete({ where: { id: invite.id } });
    res.status(204).send();
  })
);

setupRouter.post(
  "/teams",
  wrap(async (req, res) => {
    const body = z.object({ name }).parse(req.body);
    const team = await prisma.setupTeam.create({
      data: { name: body.name, createdById: uid(req), members: { create: { userId: uid(req), role: "OWNER" } } },
    });
    res.status(201).json({ team: { id: team.id, name: team.name, role: "OWNER", memberCount: 1 } });
  })
);

setupRouter.patch(
  "/teams/:teamId",
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    await requireTeamRole(teamId, uid(req), "OWNER");
    const body = z.object({ name }).parse(req.body);
    const team = await prisma.setupTeam.update({ where: { id: teamId }, data: { name: body.name } });
    res.json({ team: { id: team.id, name: team.name } });
  })
);

setupRouter.delete(
  "/teams/:teamId",
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    await requireTeamRole(teamId, uid(req), "OWNER");
    await prisma.setupTeam.delete({ where: { id: teamId } });
    res.status(204).send();
  })
);

// ─── Members and invites ─────────────────────────────────────────────────────

setupRouter.get(
  "/teams/:teamId/members",
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    const role = await requireTeamRole(teamId, uid(req));
    const [members, invites] = await Promise.all([
      prisma.setupTeamMember.findMany({
        where: { teamId },
        include: { user: { select: { id: true, email: true, displayName: true } } },
        orderBy: { createdAt: "asc" },
      }),
      // Only owners see who has been invited.
      roleAtLeast(role, "OWNER")
        ? prisma.setupInvite.findMany({ where: { teamId }, orderBy: { createdAt: "asc" } })
        : Promise.resolve([]),
    ]);
    res.json({
      members: members.map((m) => ({
        userId: m.userId,
        email: m.user.email,
        displayName: m.user.displayName,
        role: m.role,
        joinedAt: m.createdAt,
      })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt })),
    });
  })
);

/**
 * Invite someone by email. Always a pending invite that they accept or decline
 * in Setup Sheet once their address is verified, and the same answer whether
 * or not the address has an account, so invites can't be used to find out
 * who is signed up.
 */
setupRouter.post(
  "/teams/:teamId/invites",
  inviteLimiter,
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    await requireTeamRole(teamId, uid(req), "OWNER");
    const body = z
      .object({ email: z.string().trim().email("Enter an email address").max(255), role: roleSchema })
      .parse(req.body);
    const email = normalizeEmail(body.email);

    const [team, inviter, invitee] = await Promise.all([
      prisma.setupTeam.findUniqueOrThrow({ where: { id: teamId } }),
      prisma.user.findUniqueOrThrow({
        where: { id: uid(req) },
        select: { email: true, displayName: true, emailVerified: true },
      }),
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
    ]);
    if (!inviter.emailVerified) {
      throw new AppError(403, "Verify your own email before inviting people", "EMAIL_NOT_VERIFIED");
    }
    if (invitee) {
      const already = await prisma.setupTeamMember.findUnique({
        where: { teamId_userId: { teamId, userId: invitee.id } },
      });
      if (already) throw new AppError(409, "That person is already on this team", "ALREADY_MEMBER");
    }

    await prisma.setupInvite.upsert({
      where: { teamId_email: { teamId, email } },
      create: { teamId, email, role: body.role, invitedById: uid(req) },
      update: { role: body.role, invitedById: uid(req) },
    });

    // The email is a courtesy; the invite stands even if it can't be sent.
    const site = setupSite() ?? siteForRequest(req);
    sendSetupInviteEmail({
      to: email,
      teamName: team.name,
      inviterName: inviter.displayName || inviter.email,
      role: body.role,
      hasAccount: !!invitee,
      site,
    }).catch((err) => console.error("Setup invite email failed:", err));

    res.status(201).json({ status: "invited" });
  })
);

setupRouter.delete(
  "/teams/:teamId/invites/:inviteId",
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    await requireTeamRole(teamId, uid(req), "OWNER");
    await prisma.setupInvite.deleteMany({ where: { id: param(req, "inviteId"), teamId } });
    res.status(204).send();
  })
);

setupRouter.patch(
  "/teams/:teamId/members/:userId",
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    const userId = param(req, "userId");
    await requireTeamRole(teamId, uid(req), "OWNER");
    const body = z.object({ role: roleSchema }).parse(req.body);
    await changeMemberKeepingAnOwner(
      teamId,
      userId,
      () => body.role !== "OWNER",
      (tx) => tx.setupTeamMember.update({ where: { teamId_userId: { teamId, userId } }, data: { role: body.role } }),
      "A team needs at least one owner. Make someone else an owner first."
    );
    res.json({ userId, role: body.role });
  })
);

/** Owners remove anyone; anyone may leave. */
setupRouter.delete(
  "/teams/:teamId/members/:userId",
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    const userId = param(req, "userId");
    await requireTeamRole(teamId, uid(req), userId === uid(req) ? "VIEWER" : "OWNER");
    await changeMemberKeepingAnOwner(
      teamId,
      userId,
      () => true,
      (tx) => tx.setupTeamMember.delete({ where: { teamId_userId: { teamId, userId } } }),
      "A team needs at least one owner. Make someone else an owner first, or delete the team."
    );
    res.status(204).send();
  })
);

// ─── Cars ────────────────────────────────────────────────────────────────────

setupRouter.get(
  "/teams/:teamId/cars",
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    await requireTeamRole(teamId, uid(req));
    const cars = await prisma.setupCar.findMany({
      where: { teamId },
      orderBy: [{ archived: "asc" }, { name: "asc" }, { number: "asc" }],
    });
    res.json({ cars: cars.map(serializeCar) });
  })
);

setupRouter.post(
  "/teams/:teamId/cars",
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    await requireTeamRole(teamId, uid(req), "ENGINEER");
    const body = carInput.parse(req.body);
    const car = await prisma.setupCar.create({
      data: {
        teamId,
        name: body.name,
        number: body.number,
        carClass: body.carClass,
        reference: cleanValues(body.reference ?? {}),
        archived: body.archived ?? false,
      },
    });
    res.status(201).json({ car: serializeCar(car) });
  })
);

setupRouter.patch(
  "/cars/:id",
  wrap(async (req, res) => {
    const existing = await prisma.setupCar.findUnique({ where: { id: param(req, "id") } });
    if (!existing) throw notFound();
    await requireTeamRole(existing.teamId, uid(req), "ENGINEER");
    const body = carInput.partial().parse(req.body);
    const car = await prisma.setupCar.update({
      where: { id: existing.id },
      data: {
        ...body,
        reference: body.reference === undefined ? undefined : cleanValues(body.reference),
      },
    });
    res.json({ car: serializeCar(car) });
  })
);

/** Only a car with no sessions can be deleted; otherwise archive it. */
setupRouter.delete(
  "/cars/:id",
  wrap(async (req, res) => {
    const car = await prisma.setupCar.findUnique({
      where: { id: param(req, "id") },
      include: { _count: { select: { sessions: true } } },
    });
    if (!car) throw notFound();
    await requireTeamRole(car.teamId, uid(req), "ENGINEER");
    if (car._count.sessions > 0) {
      throw new AppError(
        409,
        `This car has ${car._count.sessions} session${car._count.sessions === 1 ? "" : "s"}. Archive it instead, or delete its sessions first.`,
        "CAR_HAS_SESSIONS"
      );
    }
    await prisma.setupCar.delete({ where: { id: car.id } });
    res.status(204).send();
  })
);

setupRouter.get(
  "/cars/:id/history",
  wrap(async (req, res) => {
    const car = await prisma.setupCar.findUnique({ where: { id: param(req, "id") } });
    if (!car) throw notFound();
    await requireTeamRole(car.teamId, uid(req));
    res.json({ history: await carHistory(car.id) });
  })
);

/** Every setup sheet of a car, for the compare view. */
setupRouter.get(
  "/cars/:id/sheets",
  wrap(async (req, res) => {
    const car = await prisma.setupCar.findUnique({ where: { id: param(req, "id") } });
    if (!car) throw notFound();
    await requireTeamRole(car.teamId, uid(req));
    const sheets = await prisma.setupSheet.findMany({ where: { session: { carId: car.id } } });
    res.json({ sheets: sheets.map((s) => serializeSheet(s)) });
  })
);

// ─── Events ──────────────────────────────────────────────────────────────────

setupRouter.get(
  "/teams/:teamId/events",
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    await requireTeamRole(teamId, uid(req));
    const [events, sessions] = await Promise.all([
      prisma.setupEvent.findMany({
        where: { teamId },
        orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      }),
      prisma.setupSession.findMany({ where: { teamId }, select: { eventId: true, carId: true } }),
    ]);
    const summary = new Map<string, { sessionCount: number; carIds: Set<string> }>();
    for (const s of sessions) {
      const e = summary.get(s.eventId) ?? { sessionCount: 0, carIds: new Set<string>() };
      e.sessionCount++;
      e.carIds.add(s.carId);
      summary.set(s.eventId, e);
    }
    res.json({
      events: events.map((e) => ({
        ...serializeEvent(e),
        sessionCount: summary.get(e.id)?.sessionCount ?? 0,
        carIds: [...(summary.get(e.id)?.carIds ?? [])],
      })),
    });
  })
);

setupRouter.post(
  "/teams/:teamId/events",
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    await requireTeamRole(teamId, uid(req), "ENGINEER");
    const body = eventInput.parse(req.body);
    const event = await prisma.setupEvent.create({
      data: {
        teamId,
        name: body.name,
        track: body.track,
        startDate: toDateOnly(body.startDate),
        endDate: toDateOnly(body.endDate ?? body.startDate),
        notes: body.notes,
      },
    });
    res.status(201).json({ event: serializeEvent(event) });
  })
);

/** An event with its sessions, their sheets, and each car's session before this event. */
setupRouter.get(
  "/events/:id",
  wrap(async (req, res) => {
    const event = await prisma.setupEvent.findUnique({ where: { id: param(req, "id") } });
    if (!event) throw notFound();
    const role = await requireTeamRole(event.teamId, uid(req));
    const [sessions, cars] = await Promise.all([
      prisma.setupSession.findMany({ where: { eventId: event.id }, orderBy: [{ seq: "asc" }, { createdAt: "asc" }] }),
      prisma.setupCar.findMany({ where: { teamId: event.teamId }, orderBy: [{ archived: "asc" }, { name: "asc" }] }),
    ]);

    const previous: Record<string, { session: HistoryEntry; sheets: ReturnType<typeof serializeSheet>[] }> = {};
    const carIds = [...new Set(sessions.map((s) => s.carId))];
    const histories = await Promise.all(carIds.map((id) => carHistory(id)));
    const prevIds: string[] = [];
    carIds.forEach((carId, i) => {
      const history = histories[i];
      const first = history.findIndex((h) => h.eventId === event.id);
      if (first > 0) {
        previous[carId] = { session: history[first - 1], sheets: [] };
        prevIds.push(history[first - 1].id);
      }
    });

    const sheets = await prisma.setupSheet.findMany({
      where: { sessionId: { in: [...sessions.map((s) => s.id), ...prevIds] } },
    });
    for (const p of Object.values(previous)) {
      p.sheets = sheets.filter((s) => s.sessionId === p.session.id).map((s) => serializeSheet(s));
    }
    const own = new Set(sessions.map((s) => s.id));
    res.json({
      role,
      event: serializeEvent(event),
      cars: cars.map(serializeCar),
      sessions: sessions.map(serializeSession),
      sheets: sheets.filter((s) => own.has(s.sessionId)).map((s) => serializeSheet(s)),
      previous,
    });
  })
);

setupRouter.patch(
  "/events/:id",
  wrap(async (req, res) => {
    const existing = await prisma.setupEvent.findUnique({ where: { id: param(req, "id") } });
    if (!existing) throw notFound();
    await requireTeamRole(existing.teamId, uid(req), "ENGINEER");
    const body = eventInput.partial().parse(req.body);
    const event = await prisma.setupEvent.update({
      where: { id: existing.id },
      data: {
        name: body.name,
        track: body.track,
        notes: body.notes,
        startDate: body.startDate === undefined ? undefined : toDateOnly(body.startDate),
        endDate: body.endDate === undefined ? undefined : toDateOnly(body.endDate),
      },
    });
    res.json({ event: serializeEvent(event) });
  })
);

/** Owners only: this removes every session, sheet, note and edit in the event. */
setupRouter.delete(
  "/events/:id",
  wrap(async (req, res) => {
    const event = await prisma.setupEvent.findUnique({ where: { id: param(req, "id") } });
    if (!event) throw notFound();
    await requireTeamRole(event.teamId, uid(req), "OWNER");
    await prisma.setupEvent.delete({ where: { id: event.id } });
    res.status(204).send();
  })
);

// ─── Sessions ────────────────────────────────────────────────────────────────

/**
 * Add a session and its target sheet. The target starts from the car's most
 * recent session ("latest", its actual if it has one), a chosen session, or blank.
 */
setupRouter.post(
  "/events/:id/sessions",
  wrap(async (req, res) => {
    const event = await prisma.setupEvent.findUnique({ where: { id: param(req, "id") } });
    if (!event) throw notFound();
    await requireTeamRole(event.teamId, uid(req), "ENGINEER");
    const body = z
      .object({
        carId: z.string().min(1),
        name,
        kind: sessionKind,
        sessionDate: dateOnlySchema,
        startFrom: z.union([z.literal("latest"), z.literal("blank"), z.string().min(1)]).default("latest"),
      })
      .parse(req.body);

    const car = await prisma.setupCar.findUnique({ where: { id: body.carId } });
    if (!car || car.teamId !== event.teamId) throw new AppError(400, "Choose one of this team's cars", "BAD_CAR");

    let sourceId: string | null = null;
    if (body.startFrom === "latest") {
      const history = await carHistory(car.id);
      sourceId = history.at(-1)?.id ?? null;
    } else if (body.startFrom !== "blank") {
      const source = await prisma.setupSession.findUnique({ where: { id: body.startFrom } });
      if (!source || source.teamId !== event.teamId) throw new AppError(400, "Choose one of this team's sessions", "BAD_SOURCE");
      sourceId = source.id;
    }
    const sourceValues = sourceId ? bestSheet(await prisma.setupSheet.findMany({ where: { sessionId: sourceId } })) : null;

    const last = await prisma.setupSession.findFirst({
      where: { eventId: event.id, carId: car.id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });

    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.setupSession.create({
        data: {
          teamId: event.teamId,
          eventId: event.id,
          carId: car.id,
          name: body.name,
          kind: body.kind,
          seq: (last?.seq ?? 0) + 1,
          sessionDate: toDateOnly(body.sessionDate),
        },
      });
      await createSheetWithRevision(tx, {
        sessionId: created.id,
        kind: "TARGET",
        data: sourceValues ? carryForward(sourceValues) : {},
        notes: null,
        userId: uid(req),
      });
      return created;
    });
    res.status(201).json({ session: serializeSession(session) });
  })
);

/** Everything the session page needs in one request. */
setupRouter.get(
  "/sessions/:id",
  wrap(async (req, res) => {
    const { session, role } = await sessionFor(req, param(req, "id"));
    const [event, car, sheets, notes, history] = await Promise.all([
      prisma.setupEvent.findUniqueOrThrow({ where: { id: session.eventId } }),
      prisma.setupCar.findUniqueOrThrow({ where: { id: session.carId } }),
      prisma.setupSheet.findMany({ where: { sessionId: session.id } }),
      prisma.setupSessionNote.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: "asc" } }),
      carHistory(session.carId),
    ]);
    const index = history.findIndex((h) => h.id === session.id);
    const prevEntry = index > 0 ? history[index - 1] : null;
    const [prevSheets, prevNotes] = prevEntry
      ? await Promise.all([
          prisma.setupSheet.findMany({ where: { sessionId: prevEntry.id } }),
          prisma.setupSessionNote.findMany({ where: { sessionId: prevEntry.id }, orderBy: { createdAt: "asc" } }),
        ])
      : [[], []];
    const people = await lookupPeople([
      ...sheets.map((s) => s.updatedById),
      ...notes.map((n) => n.authorId),
      ...prevNotes.map((n) => n.authorId),
    ]);
    res.json({
      role,
      session: serializeSession(session),
      event: serializeEvent(event),
      car: serializeCar(car),
      sheets: sheets.map((s) => serializeSheet(s, people)),
      notes: notes.map((n) => serializeNote(n, people)),
      history,
      previous: prevEntry
        ? {
            session: prevEntry,
            sheets: prevSheets.map((s) => serializeSheet(s, people)),
            notes: prevNotes.map((n) => serializeNote(n, people)),
          }
        : null,
    });
  })
);

/**
 * What changed in a session since a moment: sheets edited after `since`, and
 * the full (short) notes list. Open session pages poll this.
 */
setupRouter.get(
  "/sessions/:id/updates",
  wrap(async (req, res) => {
    const { session } = await sessionFor(req, param(req, "id"));
    const since = z.coerce.date().parse(req.query.since ?? 0);
    const now = new Date();
    const [sheets, notes] = await Promise.all([
      prisma.setupSheet.findMany({ where: { sessionId: session.id, updatedAt: { gt: since } } }),
      prisma.setupSessionNote.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: "asc" } }),
    ]);
    const people = await lookupPeople([...sheets.map((s) => s.updatedById), ...notes.map((n) => n.authorId)]);
    res.json({
      now,
      sheets: sheets.map((s) => serializeSheet(s, people)),
      notes: notes.map((n) => serializeNote(n, people)),
    });
  })
);

/** Sheets of any session in the team, for the compare view. */
setupRouter.get(
  "/sessions/:id/sheets",
  wrap(async (req, res) => {
    const { session } = await sessionFor(req, param(req, "id"));
    const sheets = await prisma.setupSheet.findMany({ where: { sessionId: session.id } });
    const people = await lookupPeople(sheets.map((s) => s.updatedById));
    res.json({ sheets: sheets.map((s) => serializeSheet(s, people)) });
  })
);

setupRouter.patch(
  "/sessions/:id",
  wrap(async (req, res) => {
    const { session } = await sessionFor(req, param(req, "id"), "ENGINEER");
    const body = z
      .object({ name, kind: sessionKind, sessionDate: dateOnlySchema, seq: z.number().int().min(0).max(10_000) })
      .partial()
      .parse(req.body);
    const updated = await prisma.setupSession.update({
      where: { id: session.id },
      data: {
        name: body.name,
        kind: body.kind,
        seq: body.seq,
        sessionDate: body.sessionDate === undefined ? undefined : toDateOnly(body.sessionDate),
      },
    });
    res.json({ session: serializeSession(updated) });
  })
);

setupRouter.delete(
  "/sessions/:id",
  wrap(async (req, res) => {
    const { session } = await sessionFor(req, param(req, "id"), "ENGINEER");
    await prisma.setupSession.delete({ where: { id: session.id } });
    res.status(204).send();
  })
);

// ─── Sheets ──────────────────────────────────────────────────────────────────

/** Start a session's target or actual, blank or copied from another of the team's sheets. */
setupRouter.post(
  "/sessions/:id/sheets",
  wrap(async (req, res) => {
    const { session } = await sessionFor(req, param(req, "id"), "ENGINEER");
    const body = z.object({ kind: sheetKind, fromSheetId: z.string().min(1).nullable().optional() }).parse(req.body);
    let data: SheetValues = {};
    if (body.fromSheetId) {
      const source = await prisma.setupSheet.findUnique({
        where: { id: body.fromSheetId },
        include: { session: { select: { teamId: true } } },
      });
      if (!source || source.session.teamId !== session.teamId) throw new AppError(400, "Choose one of this team's sheets", "BAD_SOURCE");
      data = carryForward(readValues(source.data));
    }
    const exists = await prisma.setupSheet.findUnique({ where: { sessionId_kind: { sessionId: session.id, kind: body.kind } } });
    if (exists) throw new AppError(409, `This session already has ${body.kind === "TARGET" ? "a target" : "an actual"} sheet`, "SHEET_EXISTS");
    const sheet = await prisma
      .$transaction((tx) =>
        createSheetWithRevision(tx, { sessionId: session.id, kind: body.kind, data, notes: null, userId: uid(req) })
      )
      .catch((err: { code?: string }) => {
        // Someone else started the same sheet a moment ago.
        if (err?.code === "P2002") throw new AppError(409, "This sheet was just started by someone else", "SHEET_EXISTS");
        throw err;
      });
    const people = await lookupPeople([sheet.updatedById]);
    res.status(201).json({ sheet: serializeSheet(sheet, people) });
  })
);

/**
 * Change some values (and/or the sheet's notes). Only the keys sent are
 * touched, so two people editing different values don't overwrite each other.
 * The row is locked for the read-modify-write so concurrent saves queue up.
 */
setupRouter.patch(
  "/sheets/:id",
  wrap(async (req, res) => {
    const { sheet } = await sheetFor(req, param(req, "id"), "ENGINEER");
    const body = z
      .object({ values: sheetPatchSchema.optional(), notes: z.string().max(MAX_NOTES_LENGTH).nullable().optional() })
      .parse(req.body);

    const saved = await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ data: unknown; notes: string | null }[]>`
        SELECT data, notes FROM setup_sheets WHERE id = ${sheet.id} FOR UPDATE`;
      if (!locked) throw notFound();
      let patched;
      try {
        patched = applyPatch(readValues(locked.data), body.values ?? {});
      } catch (err) {
        throw new AppError(400, (err as Error).message, "TOO_MANY_VALUES");
      }
      const newNotes = body.notes === undefined ? locked.notes : (body.notes ?? "").trim() || null;
      const notesChanged = newNotes !== locked.notes;
      if (patched.changes.length === 0 && !notesChanged) {
        return tx.setupSheet.findUniqueOrThrow({ where: { id: sheet.id } });
      }
      const updated = await tx.setupSheet.update({
        where: { id: sheet.id },
        data: { data: patched.next, notes: newNotes, updatedById: uid(req) },
      });
      await tx.setupSheetRevision.create({
        data: {
          sheetId: sheet.id,
          changes: patched.changes as unknown as Prisma.InputJsonValue,
          notesChanged,
          changedById: uid(req),
        },
      });
      return updated;
    });
    const people = await lookupPeople([saved.updatedById]);
    res.json({ sheet: serializeSheet(saved, people) });
  })
);

setupRouter.delete(
  "/sheets/:id",
  wrap(async (req, res) => {
    const { sheet } = await sheetFor(req, param(req, "id"), "ENGINEER");
    await prisma.setupSheet.delete({ where: { id: sheet.id } });
    res.status(204).send();
  })
);

setupRouter.get(
  "/sheets/:id/revisions",
  wrap(async (req, res) => {
    const { sheet } = await sheetFor(req, param(req, "id"));
    const revisions = await prisma.setupSheetRevision.findMany({
      where: { sheetId: sheet.id },
      orderBy: { changedAt: "desc" },
      take: 200,
    });
    const people = await lookupPeople(revisions.map((r) => r.changedById));
    res.json({ revisions: revisions.map((r) => serializeRevision(r, people)) });
  })
);

// ─── Notes ───────────────────────────────────────────────────────────────────

/** Anyone on the team, viewers included, can add notes: drivers report here. */
setupRouter.post(
  "/sessions/:id/notes",
  wrap(async (req, res) => {
    const { session } = await sessionFor(req, param(req, "id"), "VIEWER");
    const body = z
      .object({ category: noteCategory.default("GENERAL"), body: z.string().trim().min(1, "Write something first").max(MAX_NOTES_LENGTH) })
      .parse(req.body);
    const note = await prisma.setupSessionNote.create({
      data: { sessionId: session.id, authorId: uid(req), category: body.category, body: body.body },
    });
    res.status(201).json({ note: serializeNote(note, await lookupPeople([note.authorId])) });
  })
);

async function noteFor(req: Request) {
  const note = await prisma.setupSessionNote.findUnique({
    where: { id: param(req, "id") },
    include: { session: { select: { teamId: true } } },
  });
  if (!note) throw notFound();
  const role = await requireTeamRole(note.session.teamId, uid(req));
  // Authors manage their own notes; engineers and owners manage everyone's.
  if (note.authorId !== uid(req) && !roleAtLeast(role, "ENGINEER")) {
    throw new AppError(403, "You can only change your own notes", "INSUFFICIENT_ROLE");
  }
  return note;
}

setupRouter.patch(
  "/notes/:id",
  wrap(async (req, res) => {
    const note = await noteFor(req);
    const body = z
      .object({ category: noteCategory, body: z.string().trim().min(1).max(MAX_NOTES_LENGTH) })
      .partial()
      .parse(req.body);
    const updated = await prisma.setupSessionNote.update({ where: { id: note.id }, data: body });
    res.json({ note: serializeNote(updated, await lookupPeople([updated.authorId])) });
  })
);

setupRouter.delete(
  "/notes/:id",
  wrap(async (req, res) => {
    const note = await noteFor(req);
    await prisma.setupSessionNote.delete({ where: { id: note.id } });
    res.status(204).send();
  })
);

// ─── Import (Excel workbook, parsed in the browser) ──────────────────────────

const MAX_IMPORT_SESSIONS = 40;

/**
 * Create (or reuse) a car and an event, then add the workbook's sheets. A
 * session with the same name for that car in that event is reused. A sheet
 * that already exists is skipped, or replaced when `replace` is true (the
 * replacement is recorded in its edit history like any other change).
 */
setupRouter.post(
  "/teams/:teamId/import",
  importLimiter,
  wrap(async (req, res) => {
    const teamId = param(req, "teamId");
    await requireTeamRole(teamId, uid(req), "ENGINEER");
    const body = z
      .object({
        car: z.union([z.object({ id: z.string().min(1) }), carInput]),
        event: z.union([z.object({ id: z.string().min(1) }), eventInput]),
        // Measurement locations etc. from the workbook: used for a new car, or
        // an existing car that has no reference notes yet.
        carReference: carReference.optional(),
        replace: z.boolean().default(false),
        sessions: z
          .array(
            z.object({
              name,
              kind: sessionKind,
              sessionDate: dateOnlySchema,
              target: sheetInput.nullable().optional(),
              actual: sheetInput.nullable().optional(),
            })
          )
          .min(1, "Nothing to import")
          .max(MAX_IMPORT_SESSIONS),
      })
      .parse(req.body);
    const userId = uid(req);

    const result = await prisma.$transaction(
      async (tx) => {
        const reference = cleanValues(body.carReference ?? {});
        let carId: string;
        if ("id" in body.car) {
          const car = await tx.setupCar.findUnique({ where: { id: body.car.id } });
          if (!car || car.teamId !== teamId) throw new AppError(400, "Choose one of this team's cars", "BAD_CAR");
          carId = car.id;
          if (Object.keys(readValues(car.reference)).length === 0 && Object.keys(reference).length > 0) {
            await tx.setupCar.update({ where: { id: car.id }, data: { reference } });
          }
        } else {
          const c = body.car as z.infer<typeof carInput>;
          carId = (
            await tx.setupCar.create({
              data: {
                teamId,
                name: c.name,
                number: c.number,
                carClass: c.carClass,
                reference: { ...reference, ...cleanValues(c.reference ?? {}) },
              },
            })
          ).id;
        }

        let eventId: string;
        if ("id" in body.event) {
          const event = await tx.setupEvent.findUnique({ where: { id: body.event.id } });
          if (!event || event.teamId !== teamId) throw new AppError(400, "Choose one of this team's events", "BAD_EVENT");
          eventId = event.id;
        } else {
          const e = body.event as z.infer<typeof eventInput>;
          eventId = (
            await tx.setupEvent.create({
              data: {
                teamId,
                name: e.name,
                track: e.track,
                startDate: toDateOnly(e.startDate),
                endDate: toDateOnly(e.endDate ?? e.startDate),
                notes: e.notes,
              },
            })
          ).id;
        }

        const existing = await tx.setupSession.findMany({ where: { eventId, carId }, include: { sheets: true } });
        const byName = new Map(existing.map((s) => [s.name.trim().toLowerCase(), s.id]));
        const sheetsBySession = new Map(existing.map((s) => [s.id, s.sheets]));
        let seq = Math.max(0, ...existing.map((s) => s.seq));
        const counts = { created: 0, replaced: 0, skipped: 0 };
        const sessionIds: string[] = [];

        for (const s of body.sessions) {
          const key = s.name.trim().toLowerCase();
          let sessionId = byName.get(key);
          if (!sessionId) {
            sessionId = (
              await tx.setupSession.create({
                data: { teamId, eventId, carId, name: s.name, kind: s.kind, seq: ++seq, sessionDate: toDateOnly(s.sessionDate) },
              })
            ).id;
            byName.set(key, sessionId);
            sheetsBySession.set(sessionId, []);
          }
          if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId);

          for (const [kind, sheet] of [["TARGET", s.target], ["ACTUAL", s.actual]] as const) {
            if (!sheet) continue;
            const data = cleanValues(sheet.data);
            const prior = sheetsBySession.get(sessionId)!.find((x) => x.kind === kind);
            if (!prior) {
              const created = await createSheetWithRevision(tx, { sessionId, kind, data, notes: sheet.notes, userId });
              sheetsBySession.get(sessionId)!.push(created);
              counts.created++;
            } else if (!body.replace) {
              counts.skipped++;
            } else {
              // Lock and re-read, so an edit saved a moment ago is neither lost
              // silently nor missing from the recorded change.
              const [locked] = await tx.$queryRaw<{ data: unknown; notes: string | null }[]>`
                SELECT data, notes FROM setup_sheets WHERE id = ${prior.id} FOR UPDATE`;
              const changes = diffValues(readValues(locked?.data ?? prior.data), data);
              const notesChanged = (locked?.notes ?? null) !== (sheet.notes ?? null);
              await tx.setupSheet.update({ where: { id: prior.id }, data: { data, notes: sheet.notes, updatedById: userId } });
              if (changes.length > 0 || notesChanged) {
                await tx.setupSheetRevision.create({
                  data: { sheetId: prior.id, changes: changes as unknown as Prisma.InputJsonValue, notesChanged, changedById: userId },
                });
              }
              counts.replaced++;
            }
          }
        }
        return { carId, eventId, sessionIds, ...counts };
      },
      { timeout: 30_000 }
    );
    res.status(201).json(result);
  })
);

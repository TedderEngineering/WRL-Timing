/**
 * Setup Sheet — who may use it at all, and what each person may do in a team.
 *
 * Roles, highest first:
 *   OWNER    everything, including members, invites and deleting the team
 *   ENGINEER cars, events, sessions and setup values
 *   VIEWER   reads everything and adds notes (drivers, guests)
 */
import type { Request, Response, NextFunction } from "express";
import type { SetupRole } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../models/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { normalizeEmail } from "./values.js";

// ─── Product gate (SETUP_ACCESS) ─────────────────────────────────────────────

function testerEmails(): Set<string> {
  return new Set(
    (env.SETUP_TESTER_EMAILS ?? "")
      .split(",")
      .map((e) => normalizeEmail(e))
      .filter(Boolean)
  );
}

export function canUseSetup(user: { email: string; role: "USER" | "ADMIN" }): boolean {
  switch (env.SETUP_ACCESS) {
    case "public":
      return true;
    case "testers":
      return user.role === "ADMIN" || testerEmails().has(normalizeEmail(user.email));
    case "admin":
      return user.role === "ADMIN";
    default:
      return false;
  }
}

/** After requireAuth. Mirrors requireGripAccess. */
export function requireSetupAccess(req: Request, _res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) return next(new AppError(401, "Authentication required", "AUTH_REQUIRED"));
  if (!canUseSetup(user)) {
    return next(new AppError(403, "Setup Sheet is in private testing", "SETUP_NOT_AVAILABLE"));
  }
  // The tester list names email addresses, so only a verified address counts.
  if (env.SETUP_ACCESS === "testers" && user.role !== "ADMIN") {
    prisma.user
      .findUnique({ where: { id: user.userId }, select: { emailVerified: true } })
      .then((u) =>
        u?.emailVerified
          ? next()
          : next(new AppError(403, "Verify your email to use Setup Sheet", "EMAIL_NOT_VERIFIED"))
      )
      .catch(next);
    return;
  }
  next();
}

// ─── Team roles ──────────────────────────────────────────────────────────────

const RANK: Record<SetupRole, number> = { VIEWER: 0, ENGINEER: 1, OWNER: 2 };

export function roleAtLeast(role: SetupRole, minimum: SetupRole): boolean {
  return RANK[role] >= RANK[minimum];
}

/**
 * The caller's role in a team, or a 404 when they aren't a member (so team
 * ids can't be probed), or a 403 when their role is too low.
 */
export async function requireTeamRole(
  teamId: string,
  userId: string,
  minimum: SetupRole = "VIEWER"
): Promise<SetupRole> {
  const membership = await prisma.setupTeamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true },
  });
  if (!membership) throw new AppError(404, "Not found", "NOT_FOUND");
  if (!roleAtLeast(membership.role, minimum)) {
    throw new AppError(
      403,
      minimum === "OWNER"
        ? "Only team owners can do that"
        : "Viewers can read setups and add notes, but not change them",
      "INSUFFICIENT_ROLE"
    );
  }
  return membership.role;
}

/**
 * Join every team that has invited this account's email. Only for verified
 * addresses: otherwise anyone could register an invited address first.
 */
export async function acceptPendingInvites(user: {
  id: string;
  email: string;
  emailVerified: boolean;
}): Promise<string[]> {
  if (!user.emailVerified) return [];
  const email = normalizeEmail(user.email);
  const invites = await prisma.setupInvite.findMany({ where: { email } });
  if (invites.length === 0) return [];
  await prisma.$transaction([
    ...invites.map((invite) =>
      prisma.setupTeamMember.upsert({
        where: { teamId_userId: { teamId: invite.teamId, userId: user.id } },
        create: { teamId: invite.teamId, userId: user.id, role: invite.role },
        update: {},
      })
    ),
    prisma.setupInvite.deleteMany({ where: { id: { in: invites.map((i) => i.id) } } }),
  ]);
  return invites.map((i) => i.teamId);
}

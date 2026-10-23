/**
 * The engagement plan's measures that live in our own database (claude/ENGAGEMENT_PLAN_RACETRACE.md,
 * "What we measure"), for Admin › Engagement. Shares, coffees and visits by source are counted
 * by the site's anonymous analytics (PostHog) instead, and are not repeated here.
 *
 *   Come-back      followers who opened their car's (or driver's) race within 72 hours of it
 *                  being published, by race weekend
 *   Follows        follows per new account, and how many new accounts follow anything
 *   Race emails    race-ready emails sent, and how many led to the race being opened (by the
 *                  person it was sent to, within 7 days)
 *   Activity       people who opened a race, and how many came back on another day
 *
 * Admins and suspended accounts are left out, so the owner's own use doesn't count.
 *
 * Publish time: races carry no publish date, so it is the first record of it being published
 * in the audit log (PUBLISH_RACE, PUBLISH_EVENT_RACES, or UPDATE_RACE to PUBLISHED), else the
 * first race email sent about it (emails go out on publication), else the race's creation (an
 * upload published at once). `publishedFrom` says which.
 */
import { prisma } from "../models/prisma.js";
import { entryForCar } from "./my-cars.js";
import { driverInNames } from "./my-drivers.js";
import { groupIntoWeekends, type LatestRaceRow } from "../dashboard/latest.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const COME_BACK_HOURS = 72;
export const EMAIL_OPEN_DAYS = 7;

// ─── Inputs (plain rows, so the computation is testable without a database) ──

export interface EngagementRace {
  id: string;
  name: string;
  date: Date;
  track: string;
  series: string;
  subSeries: string | null;
  season: number;
  eventId: string | null;
  createdAt: Date;
  entries: { carNumber: string; teamName: string | null; driverNames: string }[];
}

export interface EngagementInput {
  now: Date;
  days: number;
  /** Accounts that count (not admin, not suspended). */
  users: { id: string; createdAt: Date }[];
  cars: { userId: string; number: string; series: string; teamName: string | null; season: number | null; createdAt: Date }[];
  drivers: { userId: string; name: string; createdAt: Date }[];
  /** Users with race emails switched on. */
  emailsOn: string[];
  /** Published races that may fall in the period (with their entries). */
  races: EngagementRace[];
  /** Publish times found in the audit log, by race id (the earliest). */
  auditPublished: Map<string, Date>;
  alertSends: { userId: string; raceId: string; sentAt: Date; officialSentAt: Date | null }[];
  views: { userId: string; raceId: string; viewedAt: Date }[];
}

// ─── Output ──────────────────────────────────────────────────────────────────

export interface WeekendComeBack {
  key: string;
  name: string;
  track: string;
  series: string;
  date: string;
  publishedAt: string;
  publishedFrom: "audit" | "email" | "created";
  races: number;
  /** People following a car or driver in the weekend's races. */
  followers: number;
  /** Of them, people who opened one of those races within 72 hours of its publication. */
  cameBack: number;
}

export interface Engagement {
  period: { days: number; from: string; to: string };
  people: { accounts: number; following: number; carsFollowed: number; driversFollowed: number; emailsOn: number };
  follows: { newAccounts: number; newAccountsFollowing: number; followsPerNewAccount: number | null };
  comeBack: {
    hours: number;
    weekends: number;
    weekendsWithFollowers: number;
    /** Weekends with followers where at least one came back. */
    weekendsWithComeBack: number;
    /** Follower-weekend pairs, and how many came back. */
    followerWeekends: number;
    followerWeekendsCameBack: number;
    recent: WeekendComeBack[];
  };
  emails: { sent: number; officialSent: number; opened: number; openDays: number };
  activity: { peopleOpeningRaces: number; cameBackAnotherDay: number; raceOpens: number };
}

export function computeEngagement(input: EngagementInput): Engagement {
  const { now, days } = input;
  const from = new Date(now.getTime() - days * DAY);
  const inPeriod = (d: Date) => d >= from && d <= now;
  const counted = new Set(input.users.map((u) => u.id));
  const cars = input.cars.filter((c) => counted.has(c.userId));
  const drivers = input.drivers.filter((d) => counted.has(d.userId));
  const following = new Set([...cars.map((c) => c.userId), ...drivers.map((d) => d.userId)]);

  // Follows per new account: what accounts opened in the period follow now.
  const newAccounts = input.users.filter((u) => inPeriod(u.createdAt));
  const followsOf = new Map<string, number>();
  for (const c of cars) followsOf.set(c.userId, (followsOf.get(c.userId) ?? 0) + 1);
  for (const d of drivers) followsOf.set(d.userId, (followsOf.get(d.userId) ?? 0) + 1);
  const newFollows = newAccounts.reduce((n, u) => n + (followsOf.get(u.id) ?? 0), 0);

  // Publish time per race.
  const firstSend = new Map<string, Date>();
  for (const s of input.alertSends) {
    const t = firstSend.get(s.raceId);
    if (!t || s.sentAt < t) firstSend.set(s.raceId, s.sentAt);
  }
  const published = new Map<string, { at: Date; from: "audit" | "email" | "created" }>();
  for (const r of input.races) {
    const audit = input.auditPublished.get(r.id);
    const email = firstSend.get(r.id);
    published.set(r.id, audit ? { at: audit, from: "audit" } : email ? { at: email, from: "email" } : { at: r.createdAt, from: "created" });
  }

  // Each race's followers (any follower, emails on or not).
  const followersOf = new Map<string, Set<string>>();
  for (const r of input.races) {
    const set = new Set<string>();
    for (const c of cars) if (entryForCar(c, r, r.entries)) set.add(c.userId);
    for (const d of drivers) if (r.entries.some((e) => driverInNames(e.driverNames, d.name))) set.add(d.userId);
    followersOf.set(r.id, set);
  }

  const viewsBy = new Map<string, Date[]>();
  for (const v of input.views) {
    const k = `${v.userId}:${v.raceId}`;
    if (!viewsBy.has(k)) viewsBy.set(k, []);
    viewsBy.get(k)!.push(v.viewedAt);
  }
  const openedWithin = (userId: string, raceId: string, start: Date, ms: number) =>
    (viewsBy.get(`${userId}:${raceId}`) ?? []).some((t) => t >= start && t.getTime() <= start.getTime() + ms);

  // Come-back by race weekend: the weekend's races published in the period.
  const periodRaces = input.races.filter((r) => inPeriod(published.get(r.id)!.at));
  const rows: (LatestRaceRow & { season: number; entries: EngagementRace["entries"] })[] = periodRaces
    .map((r) => ({ ...r, premium: false, maxLap: null, totalCars: null }))
    .sort((a, b) => b.date.getTime() - a.date.getTime() || a.name.localeCompare(b.name));
  const weekends = groupIntoWeekends(rows);
  const recent: WeekendComeBack[] = [];
  let withFollowers = 0;
  let withComeBack = 0;
  let pairs = 0;
  let pairsBack = 0;
  for (const g of weekends) {
    const people = new Set<string>();
    const back = new Set<string>();
    for (const r of g.races) {
      const pub = published.get(r.id)!;
      for (const u of followersOf.get(r.id) ?? []) {
        people.add(u);
        if (openedWithin(u, r.id, pub.at, COME_BACK_HOURS * HOUR)) back.add(u);
      }
    }
    if (people.size > 0) withFollowers++;
    if (back.size > 0) withComeBack++;
    pairs += people.size;
    pairsBack += back.size;
    const first = [...g.races].sort((a, b) => published.get(a.id)!.at.getTime() - published.get(b.id)!.at.getTime())[0];
    const pub = published.get(first.id)!;
    recent.push({
      key: g.key,
      name: first.name.split(" — ").pop() ?? first.name,
      track: first.track,
      series: first.series,
      date: [...g.races].map((r) => r.date).sort((a, b) => a.getTime() - b.getTime())[0].toISOString().slice(0, 10),
      publishedAt: pub.at.toISOString(),
      publishedFrom: pub.from,
      races: g.races.length,
      followers: people.size,
      cameBack: back.size,
    });
  }

  // Race emails sent in the period, and how many led to the race being opened.
  const sends = input.alertSends.filter((s) => counted.has(s.userId));
  const sent = sends.filter((s) => inPeriod(s.sentAt));
  const opened = sent.filter((s) => openedWithin(s.userId, s.raceId, s.sentAt, EMAIL_OPEN_DAYS * DAY)).length;
  const officialSent = sends.filter((s) => s.officialSentAt && inPeriod(s.officialSentAt)).length;

  // Activity: people who opened a race in the period, and who did so on more than one day.
  const daysBy = new Map<string, Set<string>>();
  let raceOpens = 0;
  for (const v of input.views) {
    if (!counted.has(v.userId) || !inPeriod(v.viewedAt)) continue;
    raceOpens++;
    if (!daysBy.has(v.userId)) daysBy.set(v.userId, new Set());
    daysBy.get(v.userId)!.add(v.viewedAt.toISOString().slice(0, 10));
  }

  return {
    period: { days, from: from.toISOString(), to: now.toISOString() },
    people: {
      accounts: input.users.length,
      following: following.size,
      carsFollowed: cars.length,
      driversFollowed: drivers.length,
      emailsOn: input.emailsOn.filter((id) => counted.has(id)).length,
    },
    follows: {
      newAccounts: newAccounts.length,
      newAccountsFollowing: newAccounts.filter((u) => (followsOf.get(u.id) ?? 0) > 0).length,
      followsPerNewAccount: newAccounts.length ? newFollows / newAccounts.length : null,
    },
    comeBack: {
      hours: COME_BACK_HOURS,
      weekends: weekends.length,
      weekendsWithFollowers: withFollowers,
      weekendsWithComeBack: withComeBack,
      followerWeekends: pairs,
      followerWeekendsCameBack: pairsBack,
      recent: recent.slice(0, 20),
    },
    emails: { sent: sent.length, officialSent, opened, openDays: EMAIL_OPEN_DAYS },
    activity: {
      peopleOpeningRaces: daysBy.size,
      cameBackAnotherDay: [...daysBy.values()].filter((d) => d.size > 1).length,
      raceOpens,
    },
  };
}

// ─── Loading ─────────────────────────────────────────────────────────────────

/** Audit actions that record a race being published (see routes/admin.ts). */
export function auditPublishTimes(rows: { action: string; targetId: string; details: unknown; createdAt: Date }[]): Map<string, Date> {
  const out = new Map<string, Date>();
  const note = (id: string, at: Date) => {
    const t = out.get(id);
    if (!t || at < t) out.set(id, at);
  };
  for (const r of rows) {
    const d = (r.details ?? {}) as Record<string, unknown>;
    if (r.action === "PUBLISH_RACE") note(r.targetId, r.createdAt);
    else if (r.action === "UPDATE_RACE" && d.status === "PUBLISHED") note(r.targetId, r.createdAt);
    else if (r.action === "PUBLISH_EVENT_RACES" && Array.isArray(d.races)) for (const id of d.races) if (typeof id === "string") note(id, r.createdAt);
  }
  return out;
}

export async function loadEngagement(days: number, now = new Date()): Promise<Engagement> {
  const from = new Date(now.getTime() - days * DAY);
  // Races published in the period were created before its end; allow a long draft time.
  const raceFrom = new Date(from.getTime() - 120 * DAY);
  const [users, cars, drivers, prefs, races, audits, alertSends, views] = await Promise.all([
    prisma.user.findMany({ where: { role: { not: "ADMIN" }, suspendedAt: null }, select: { id: true, createdAt: true } }),
    prisma.userCar.findMany({ select: { userId: true, number: true, series: true, teamName: true, season: true, createdAt: true } }),
    prisma.userDriver.findMany({ select: { userId: true, name: true, createdAt: true } }),
    prisma.userPreferences.findMany({ where: { raceAlerts: true }, select: { userId: true } }),
    prisma.race.findMany({
      where: { status: "PUBLISHED", createdAt: { gte: raceFrom } },
      select: {
        id: true, name: true, date: true, track: true, series: true, subSeries: true, season: true, eventId: true, createdAt: true,
        entries: { select: { carNumber: true, teamName: true, driverNames: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { action: { in: ["PUBLISH_RACE", "UPDATE_RACE", "PUBLISH_EVENT_RACES"] }, createdAt: { gte: raceFrom } },
      select: { action: true, targetId: true, details: true, createdAt: true },
    }),
    prisma.raceAlertSend.findMany({ where: { sentAt: { gte: raceFrom } }, select: { userId: true, raceId: true, sentAt: true, officialSentAt: true } }),
    prisma.userRaceView.findMany({ where: { viewedAt: { gte: raceFrom } }, select: { userId: true, raceId: true, viewedAt: true } }),
  ]);
  return computeEngagement({
    now,
    days,
    users: users as EngagementInput["users"],
    cars: cars as EngagementInput["cars"],
    drivers: drivers as EngagementInput["drivers"],
    emailsOn: (prefs as { userId: string }[]).map((p) => p.userId),
    races: races as EngagementRace[],
    auditPublished: auditPublishTimes(audits as { action: string; targetId: string; details: unknown; createdAt: Date }[]),
    alertSends: alertSends as EngagementInput["alertSends"],
    views: views as EngagementInput["views"],
  });
}

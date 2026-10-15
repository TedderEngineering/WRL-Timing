/**
 * Race-ready emails (engagement plan D).
 *
 *  - Opt-in only: `user_preferences.race_alerts`, off by default.
 *  - Sent when a race with a followed car is published, or when a published race's results
 *    turn official; at most one email per race per user (the `race_alert_sends` row is written
 *    first, so the second trigger never repeats it).
 *  - Recent races only (raced in the last 10 days), so publishing old races sends nothing.
 *  - One-click unsubscribe: a signed link (no login), and List-Unsubscribe headers.
 *  - The subject states facts: "#67 at VIR: P13 in GS, lost 3 places in pit cycle 2".
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../models/prisma.js";
import { env } from "../config/env.js";
import { carMatchesEntry } from "./my-cars.js";
import { carFacts, type CarFacts } from "../dashboard/my-car.js";
import { escapeHtml, sendRaceAlertEmail } from "./email.js";
import { racetraceSite } from "./site.js";
import { canonicalTrack } from "../lib/weekends.js";

export const RECENT_DAYS = 10;
const DAY = 86_400_000;

// ─── Unsubscribe tokens ───────────────────────────────────────────────────────

const sign = (userId: string) =>
  createHmac("sha256", `race-alerts:${env.JWT_ACCESS_SECRET}`).update(userId).digest("base64url").slice(0, 32);

export function unsubscribeToken(userId: string): string {
  return `${Buffer.from(userId).toString("base64url")}.${sign(userId)}`;
}

/** The user id a token was made for, or null when it is not one of ours. */
export function readUnsubscribeToken(token: string): string | null {
  const [id64, sig] = String(token ?? "").split(".");
  if (!id64 || !sig) return null;
  let userId: string;
  try {
    userId = Buffer.from(id64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const want = Buffer.from(sign(userId));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? userId : null;
}

export async function setRaceAlerts(userId: string, on: boolean) {
  await prisma.userPreferences.upsert({
    where: { userId },
    create: { userId, raceAlerts: on },
    update: { raceAlerts: on },
  });
}

export async function getRaceAlerts(userId: string): Promise<boolean> {
  const p = await prisma.userPreferences.findUnique({ where: { userId }, select: { raceAlerts: true } });
  return !!p?.raceAlerts;
}

// ─── Wording ──────────────────────────────────────────────────────────────────

const shortTrack = (track: string) => canonicalTrack(track);

/** "#67 at VIR: P13 in GS, gained 3 places in pit cycle 2 (provisional)". Facts only. */
export function alertSubject(f: CarFacts, track: string, resultsStatus: string | null): string {
  const where = `#${f.number} at ${shortTrack(track)}`;
  const finish =
    f.finishClass !== null
      ? `P${f.finishClass} in ${f.cls}`
      : f.status === "dsq"
        ? "disqualified"
        : f.status === "dnf"
          ? "did not finish"
          : f.status === "dns"
            ? "did not start"
            : "not classified";
  // The biggest pit-cycle change, gained or lost, is the one fact worth the subject line.
  const big = [...f.pitCycles].sort((a, b) => Math.abs(b.net) - Math.abs(a.net))[0];
  const cycle = big && big.net !== 0 ? `, ${big.net > 0 ? "gained" : "lost"} ${Math.abs(big.net)} place${Math.abs(big.net) === 1 ? "" : "s"} in pit cycle ${big.cycle}` : "";
  const prov = resultsStatus === "official" ? "" : " (provisional)";
  return `${where}: ${finish}${cycle}${prov}`;
}

function alertHtml(p: { subject: string; raceName: string; f: CarFacts; raceUrl: string; unsubscribeUrl: string; settingsUrl: string }): string {
  const { f } = p;
  const lines = [
    f.finishClass !== null ? `Finished P${f.finishClass} in ${f.cls}${f.classSize ? ` of ${f.classSize}` : ""} · P${f.finishOverall} overall` : null,
    `${f.laps} of ${f.raceLaps} laps`,
    ...f.pitCycles.map(
      (c) => `Pit cycle ${c.cycle} (settled lap ${c.lap}): P${c.before} → P${c.after} in ${f.cls}, ${c.net > 0 ? `gained ${c.net}` : c.net < 0 ? `lost ${-c.net}` : "held position"}`
    ),
    ...(f.benchmarks ?? []),
  ].filter(Boolean) as string[];
  const accent = "#F48C34";
  return `
    <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 520px; margin: 0 auto; color: #1b1b28;">
      <p style="margin: 0 0 4px; font-size: 13px; color: #6b6b80;">RaceTrace · your car's race is up</p>
      <h2 style="margin: 0 0 12px; font-size: 20px;">${escapeHtml(p.subject)}</h2>
      <p style="margin: 0 0 12px; color: #444;">${escapeHtml(p.raceName)}</p>
      <ul style="padding-left: 18px; margin: 0 0 16px; color: #333; line-height: 1.6;">
        ${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}
      </ul>
      <a href="${p.raceUrl}" style="display: inline-block; background: ${accent}; color: #fff; padding: 11px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open the race</a>
      <p style="margin: 24px 0 0; color: #888; font-size: 12px; line-height: 1.5;">
        You get this because you follow #${escapeHtml(f.number)} on RaceTrace and turned on race emails.
        <a href="${p.unsubscribeUrl}" style="color: #888;">Turn these emails off</a> ·
        <a href="${p.settingsUrl}" style="color: #888;">My cars</a>
      </p>
    </div>`;
}

// ─── Sending ──────────────────────────────────────────────────────────────────

export interface AlertRun {
  raceId: string;
  sent: number;
  skipped: string | null;
}

/**
 * Email every opted-in user who follows a car in this race and has not had an email for it.
 * Safe to call more than once for the same race.
 */
export async function sendRaceAlerts(raceId: string, now = Date.now()): Promise<AlertRun> {
  const race = (await prisma.race.findUnique({
    where: { id: raceId },
    select: {
      id: true, name: true, date: true, track: true, series: true, subSeries: true, season: true, status: true,
      resultsStatus: true, chartData: true, annotationData: true,
      entries: { select: { carNumber: true, teamName: true } },
    },
  })) as any;
  if (!race || race.status !== "PUBLISHED") return { raceId, sent: 0, skipped: "not published" };
  if (now - new Date(race.date).getTime() > RECENT_DAYS * DAY) return { raceId, sent: 0, skipped: "not recent" };
  if (!race.chartData) return { raceId, sent: 0, skipped: "no chart data" };

  const followers = (await prisma.userCar.findMany({
    where: { user: { preferences: { raceAlerts: true }, suspendedAt: null } },
    select: { id: true, userId: true, number: true, series: true, teamName: true, season: true, user: { select: { email: true } } },
  })) as any[];
  const already = new Set(
    ((await prisma.raceAlertSend.findMany({ where: { raceId }, select: { userId: true } })) as { userId: string }[]).map((s) => s.userId)
  );

  const site = racetraceSite();
  let sent = 0;
  const done = new Set<string>();
  for (const car of followers) {
    if (already.has(car.userId) || done.has(car.userId)) continue;
    const entry = race.entries.find((e: any) => carMatchesEntry(car, race, e));
    if (!entry) continue;
    const f = carFacts(race.chartData, race.annotationData ?? null, entry.carNumber);
    if (!f) continue;
    done.add(car.userId);
    // Claim the send first: a concurrent trigger for the same race then fails here, not twice in the inbox.
    try {
      await prisma.raceAlertSend.create({ data: { userId: car.userId, raceId, carId: car.id } });
    } catch {
      continue;
    }
    const subject = alertSubject(f, race.track, race.resultsStatus);
    const unsubscribeUrl = `${site.url}/api/alerts/unsubscribe?t=${unsubscribeToken(car.userId)}`;
    try {
      await sendRaceAlertEmail({
        to: car.user.email,
        subject,
        unsubscribeUrl,
        html: alertHtml({
          subject,
          raceName: race.name,
          f,
          raceUrl: `${site.url}/chart?race=${race.id}&from=alert`,
          unsubscribeUrl,
          settingsUrl: `${site.url}/settings/cars`,
        }),
      });
      sent++;
    } catch (err) {
      console.error(`[race-alerts] ${raceId} → user ${car.userId}:`, (err as Error).message);
    }
  }
  return { raceId, sent, skipped: null };
}

/** Run after the response: an alert never slows or fails a publish. */
export function queueRaceAlerts(raceId: string): void {
  setImmediate(() => {
    sendRaceAlerts(raceId)
      .then((r) => r.sent && console.log(`[race-alerts] ${raceId}: ${r.sent} sent`))
      .catch((err) => console.error(`[race-alerts] ${raceId} failed:`, (err as Error).message));
  });
}

/**
 * Race-ready emails (engagement plan D).
 *
 *  - Opt-in only: `user_preferences.race_alerts`, off by default.
 *  - Sent when a race with a followed car is published, or when a published race's results
 *    turn official; one email per race per user (the `race_alert_sends` row is written first,
 *    so the second trigger never repeats it).
 *  - One exception (owner decision, Oct 15 2026): when that email went out on provisional
 *    results and, once official, the car's finish or pit cycles changed, one "results are
 *    official" email follows, listing what changed. No change, no second email.
 *  - Recent races only (raced in the last 10 days; 30 for the official follow-up), so
 *    publishing old races sends nothing.
 *  - One-click unsubscribe: a signed link (no login), and List-Unsubscribe headers.
 *  - The subject states facts: "#67 at VIR: P13 in GS, lost 3 places in pit cycle 2".
 */
import { withPitFacts } from "../packages/race-pit-facts.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../models/prisma.js";
import { env } from "../config/env.js";
import { entryForCar } from "./my-cars.js";
import { carFacts, type CarFacts } from "../dashboard/my-car.js";
import { escapeHtml, sendRaceAlertEmail } from "./email.js";
import { racetraceSite } from "./site.js";
import { canonicalTrack } from "../lib/weekends.js";

export const RECENT_DAYS = 10;
/** Official results can take a while; the follow-up still goes out within this many days. */
export const OFFICIAL_DAYS = 30;
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

function alertHtml(p: {
  subject: string;
  raceName: string;
  f: CarFacts;
  raceUrl: string;
  unsubscribeUrl: string;
  settingsUrl: string;
  /** The official follow-up: what changed since the provisional email. */
  changes?: string[];
}): string {
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
      <p style="margin: 0 0 4px; font-size: 13px; color: #6b6b80;">RaceTrace · ${p.changes ? "the results are official" : "your car's race is up"}</p>
      <h2 style="margin: 0 0 12px; font-size: 20px;">${escapeHtml(p.subject)}</h2>
      <p style="margin: 0 0 12px; color: #444;">${escapeHtml(p.raceName)}</p>
      ${
        p.changes
          ? `<p style="margin: 0 0 6px; color: #333; font-weight: 600;">Changed since the provisional results</p>
      <ul style="padding-left: 18px; margin: 0 0 16px; color: #333; line-height: 1.6;">
        ${p.changes.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}
      </ul>
      <p style="margin: 0 0 6px; color: #333; font-weight: 600;">Official result</p>`
          : ""
      }
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

// ─── Provisional → official ───────────────────────────────────────────────────

/** What an email said about the car, kept to compare with the official results. */
export interface SentFacts {
  cls: string;
  finishClass: number | null;
  finishOverall: number | null;
  status: string | null;
  pitCycles: { cycle: number; net: number }[];
}

export function sentFacts(f: CarFacts): SentFacts {
  return {
    cls: f.cls,
    finishClass: f.finishClass,
    finishOverall: f.finishOverall,
    status: f.status,
    pitCycles: f.pitCycles.map((c) => ({ cycle: c.cycle, net: c.net })),
  };
}

const finishWords = (f: SentFacts) =>
  f.finishClass !== null
    ? `P${f.finishClass} in ${f.cls}`
    : f.status === "dsq"
      ? "disqualified"
      : f.status === "dnf"
        ? "did not finish"
        : f.status === "dns"
          ? "did not start"
          : "not classified";
const cycleWords = (net: number | undefined) =>
  net === undefined ? "no settled cycle" : net > 0 ? `gained ${net}` : net < 0 ? `lost ${-net}` : "held position";

/** What changed for the car between the provisional email and the official results; [] = nothing. */
export function factChanges(before: SentFacts, now: SentFacts): string[] {
  const out: string[] = [];
  if (finishWords(before) !== finishWords(now)) out.push(`Finish: ${finishWords(before)} → ${finishWords(now)}`);
  else if (before.finishOverall !== now.finishOverall && before.finishOverall !== null && now.finishOverall !== null) {
    out.push(`Overall: P${before.finishOverall} → P${now.finishOverall}`);
  }
  const cycles = [...new Set([...before.pitCycles, ...now.pitCycles].map((c) => c.cycle))].sort((a, b) => a - b);
  for (const n of cycles) {
    const a = before.pitCycles.find((c) => c.cycle === n)?.net;
    const b = now.pitCycles.find((c) => c.cycle === n)?.net;
    if (a !== b) out.push(`Pit cycle ${n}: ${cycleWords(a)} → ${cycleWords(b)}`);
  }
  return out;
}

function readSentFacts(raw: unknown): SentFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<SentFacts>;
  return typeof f.cls === "string" && Array.isArray(f.pitCycles) ? (f as SentFacts) : null;
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
      resultsStatus: true, chartData: true, annotationData: true, currentPackageId: true, packagesDisabled: true,
      entries: { select: { carNumber: true, teamName: true } },
    },
  })) as any;
  if (!race || race.status !== "PUBLISHED") return { raceId, sent: 0, skipped: "not published" };
  const age = now - new Date(race.date).getTime();
  const firstOk = age <= RECENT_DAYS * DAY;
  const official = race.resultsStatus === "official";
  if (!firstOk && !(official && age <= OFFICIAL_DAYS * DAY)) return { raceId, sent: 0, skipped: "not recent" };
  if (!race.chartData) return { raceId, sent: 0, skipped: "no chart data" };
  const chart = await withPitFacts(race, { data: race.chartData, annotations: race.annotationData ?? {} });

  const followers = (await prisma.userCar.findMany({
    where: { user: { preferences: { raceAlerts: true }, suspendedAt: null } },
    select: { id: true, userId: true, number: true, series: true, teamName: true, season: true, user: { select: { email: true } } },
  })) as any[];
  type SendRow = { userId: string; carId: string | null; resultsStatus: string | null; facts: unknown; officialCheckedAt: Date | null };
  const sends = new Map(
    ((await prisma.raceAlertSend.findMany({
      where: { raceId },
      select: { userId: true, carId: true, resultsStatus: true, facts: true, officialCheckedAt: true },
    })) as SendRow[]).map((s) => [s.userId, s])
  );

  const site = racetraceSite();
  let sent = 0;
  const done = new Set<string>();
  for (const car of followers) {
    if (done.has(car.userId)) continue;
    const prior = sends.get(car.userId);
    // After the first email, only the official follow-up, and only for the car that email was about.
    if (prior && (!official || prior.resultsStatus === "official" || prior.officialCheckedAt || (prior.carId && prior.carId !== car.id))) continue;
    if (!prior && !firstOk) continue;
    const entry = entryForCar(car, race, race.entries as { carNumber: string; teamName: string | null }[]);
    if (!entry) continue;
    const f = carFacts(chart.data, chart.annotations ?? null, entry.carNumber);
    if (!f) continue;
    done.add(car.userId);

    let changes: string[] | undefined;
    if (prior) {
      // Claim the comparison first (once per user and race), whatever it finds.
      const claim = (await prisma.raceAlertSend.updateMany({
        where: { userId: car.userId, raceId, officialCheckedAt: null },
        data: { officialCheckedAt: new Date(now) },
      })) as { count: number };
      if (claim.count !== 1) continue;
      const before = readSentFacts(prior.facts);
      if (!before) continue; // sent before facts were kept: nothing to compare with
      changes = factChanges(before, sentFacts(f));
      if (changes.length === 0) continue; // official results changed nothing for this car
    } else {
      // Claim the send first: a concurrent trigger for the same race then fails here, not twice in the inbox.
      try {
        await prisma.raceAlertSend.create({
          data: { userId: car.userId, raceId, carId: car.id, resultsStatus: race.resultsStatus ?? null, facts: sentFacts(f) as object },
        });
      } catch {
        continue;
      }
    }
    const subject = changes ? `Official: ${alertSubject(f, race.track, "official")}` : alertSubject(f, race.track, race.resultsStatus);
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
          changes,
        }),
      });
      sent++;
      if (changes) {
        await prisma.raceAlertSend.updateMany({ where: { userId: car.userId, raceId }, data: { officialSentAt: new Date(now) } });
      }
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

/**
 * Auto-group existing races into events.
 *
 * Logic: races with the same series whose normalized track names match
 * and dates are within 3 days form a single event. Track names are
 * normalized by lowercasing, trimming, and stripping trailing geography
 * words (Raceway, Speedway, Park, Circuit, International, Motorsports).
 * The longest/most complete track name from the group becomes canonical.
 *
 * Also cleans up orphan events (0 races).
 *
 * Idempotent — skips races already assigned to an event.
 *
 * Usage:
 *   npx tsx prisma/seed-events.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/** Words stripped from the end of a track name for comparison only */
const STRIP_WORDS = /\b(raceway|speedway|park|circuit|international|motorsports|motorplex)\b/gi;

/** Normalize a track name for grouping comparison */
function normalizeTrack(track: string): string {
  return track
    .toLowerCase()
    .trim()
    .replace(STRIP_WORDS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Check if two normalized track names should be grouped */
function tracksMatch(a: string, b: string): boolean {
  const na = normalizeTrack(a);
  const nb = normalizeTrack(b);
  if (na === nb) return true;
  // Also match if they share the same first word (e.g. "barber" vs "barber motorsports park")
  const firstA = na.split(" ")[0];
  const firstB = nb.split(" ")[0];
  return firstA === firstB && firstA.length >= 3;
}

async function main() {
  // ── Clean up orphan events with 0 races ──
  const orphans = await prisma.event.findMany({
    where: { races: { none: {} } },
    select: { id: true, name: true },
  });
  if (orphans.length > 0) {
    await prisma.event.deleteMany({
      where: { id: { in: orphans.map((o) => o.id) } },
    });
    console.log(`Deleted ${orphans.length} orphan event(s):`);
    orphans.forEach((o) => console.log(`  - ${o.name}`));
    console.log();
  }

  // ── Group ungrouped races ──
  const races = await prisma.race.findMany({
    where: { eventId: null },
    select: { id: true, name: true, series: true, track: true, date: true, season: true },
    orderBy: [{ series: "asc" }, { date: "asc" }],
  });

  if (races.length === 0) {
    console.log("No ungrouped races found");
    return;
  }

  console.log(`Found ${races.length} ungrouped race(s)\n`);

  // Group races by series + normalized track + date proximity
  const groups: (typeof races)[] = [];
  let current: typeof races = [races[0]];

  for (let i = 1; i < races.length; i++) {
    const prev = current[current.length - 1];
    const race = races[i];
    const sameSeries = race.series === prev.series;
    const sameTrack = sameSeries && tracksMatch(race.track, prev.track);
    const withinWindow =
      Math.abs(race.date.getTime() - prev.date.getTime()) <= THREE_DAYS_MS;

    if (sameTrack && withinWindow) {
      current.push(race);
    } else {
      groups.push(current);
      current = [race];
    }
  }
  groups.push(current);

  console.log(`Grouped into ${groups.length} event(s)\n`);

  let created = 0;
  for (const group of groups) {
    const earliest = group.reduce((a, b) => (a.date < b.date ? a : b));
    const season = String(earliest.season);

    // Use the longest/most complete track name from the group
    const canonicalTrack = group.reduce((best, r) =>
      r.track.length > best.length ? r.track : best,
      group[0].track,
    );

    const name = `${canonicalTrack} ${season}`;

    const event = await prisma.event.create({
      data: {
        name,
        series: earliest.series,
        track: canonicalTrack,
        date: earliest.date,
        season,
        status: "PUBLISHED",
      },
    });

    await prisma.race.updateMany({
      where: { id: { in: group.map((r) => r.id) } },
      data: { eventId: event.id },
    });

    const raceNames = group.map((r) => r.name).join(", ");
    console.log(`  ${name} (${group.length} race(s)): ${raceNames}`);
    created++;
  }

  console.log(`\nCreated ${created} event(s)`);
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

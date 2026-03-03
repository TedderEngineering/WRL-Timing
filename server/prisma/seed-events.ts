/**
 * Auto-group existing races into events.
 *
 * Logic: races with the same series + track whose dates are within 3 days
 * of each other form a single event. Idempotent — skips races already
 * assigned to an event.
 *
 * Usage:
 *   npx tsx prisma/seed-events.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

async function main() {
  const races = await prisma.race.findMany({
    where: { eventId: null },
    select: { id: true, name: true, series: true, track: true, date: true, season: true },
    orderBy: [{ series: "asc" }, { track: "asc" }, { date: "asc" }],
  });

  if (races.length === 0) {
    console.log("No races found to group");
    return;
  }

  console.log(`Found ${races.length} ungrouped race(s)\n`);

  // Group races by series+track proximity
  const groups: (typeof races)[] = [];
  let current: typeof races = [races[0]];

  for (let i = 1; i < races.length; i++) {
    const prev = current[current.length - 1];
    const race = races[i];
    const sameSeriesTrack =
      race.series === prev.series && race.track === prev.track;
    const withinWindow =
      Math.abs(race.date.getTime() - prev.date.getTime()) <= THREE_DAYS_MS;

    if (sameSeriesTrack && withinWindow) {
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
    const name = `${earliest.track} ${season}`;

    const event = await prisma.event.create({
      data: {
        name,
        series: earliest.series,
        track: earliest.track,
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

/**
 * Assign round numbers to races.
 *
 * Groups by (sub_series ?? series, season), sorts by date, assigns
 * round 1, 2, 3... within each group. Idempotent — overwrites existing
 * round numbers.
 *
 * Usage:
 *   npx tsx prisma/seed-round-numbers.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const races = await prisma.race.findMany({
    select: { id: true, series: true, subSeries: true, season: true, date: true },
    orderBy: { date: "asc" },
  });

  if (races.length === 0) {
    console.log("No races found to assign round numbers");
    return;
  }

  // Group by (subSeries ?? series, season)
  const groups = new Map<string, typeof races>();
  for (const race of races) {
    const key = `${race.subSeries ?? race.series}::${race.season}`;
    const arr = groups.get(key) ?? [];
    arr.push(race);
    groups.set(key, arr);
  }

  let updated = 0;
  for (const [key, groupRaces] of groups) {
    // Already sorted by date from the query
    for (let i = 0; i < groupRaces.length; i++) {
      const round = i + 1;
      await prisma.race.update({
        where: { id: groupRaces[i].id },
        data: { roundNumber: round },
      });
      updated++;
    }
    console.log(`  ${key}: ${groupRaces.length} round(s)`);
  }

  console.log(`\nAssigned round numbers to ${updated} race(s)`);
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

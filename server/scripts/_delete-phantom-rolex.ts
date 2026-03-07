/**
 * Delete the phantom 2025 Draft Rolex 24 record (mis-dated duplicate of 2026 race).
 * Usage: npx tsx scripts/_delete-phantom-rolex.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ log: [] });
const RACE_ID = "cmm6ng37i0001tnzkzxzqzwvk";
const EXPECTED_EVENT_ID = "cmmbhh7pz0000tnikgc66hba9";

async function main() {
  // 1. Pre-flight checks
  console.log("=== Pre-flight checks ===\n");

  const race = await prisma.race.findUnique({
    where: { id: RACE_ID },
    select: {
      id: true,
      name: true,
      status: true,
      season: true,
      eventId: true,
      _count: { select: { laps: true, entries: true } },
    },
  });

  if (!race) {
    console.log("Race not found — already deleted?");
    return;
  }

  console.log(`  id:        ${race.id}`);
  console.log(`  name:      ${race.name}`);
  console.log(`  status:    ${race.status}`);
  console.log(`  season:    ${race.season}`);
  console.log(`  event_id:  ${race.eventId}`);
  console.log(`  laps:      ${race._count.laps}`);
  console.log(`  entries:   ${race._count.entries}`);

  // Verify all four conditions
  const checks = [
    { label: "status = DRAFT", pass: race.status === "DRAFT" },
    { label: "season = 2025", pass: race.season === 2025 },
    { label: "lap_count = 35410", pass: race._count.laps === 35410 },
    { label: "event_id matches", pass: race.eventId === EXPECTED_EVENT_ID },
  ];

  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? "PASS" : "FAIL"}: ${c.label}`);
    if (!c.pass) allPass = false;
  }

  if (!allPass) {
    console.error("\nABORT: Not all checks passed. Will not delete.");
    process.exit(1);
  }

  // 2. Delete cascade: laps, entries, pit_stop_analysis, favorites, views, then race
  console.log("\n=== Deleting ===\n");

  const deletedLaps = await prisma.raceLap.deleteMany({ where: { raceId: RACE_ID } });
  console.log(`  Deleted ${deletedLaps.count} race_laps`);

  const deletedEntries = await prisma.raceEntry.deleteMany({ where: { raceId: RACE_ID } });
  console.log(`  Deleted ${deletedEntries.count} race_entries`);

  const deletedPitAnalysis = await prisma.pitStopAnalysis.deleteMany({ where: { raceId: RACE_ID } });
  console.log(`  Deleted ${deletedPitAnalysis.count} pit_stop_analysis`);

  const deletedFavorites = await prisma.userFavorite.deleteMany({ where: { raceId: RACE_ID } });
  console.log(`  Deleted ${deletedFavorites.count} favorites`);

  const deletedViews = await prisma.userRaceView.deleteMany({ where: { raceId: RACE_ID } });
  console.log(`  Deleted ${deletedViews.count} views`);

  const deletedRace = await prisma.race.delete({ where: { id: RACE_ID } });
  console.log(`  Deleted race: ${deletedRace.name} (${deletedRace.id})`);

  // 3. Audit log
  console.log("\n=== Writing audit log ===\n");
  await prisma.$queryRawUnsafe(`
    INSERT INTO audit_log (id, admin_user_id, action, target_type, target_id, details, created_at)
    VALUES (
      gen_random_uuid()::text,
      'cmm1bamhy0ty5qa018xlqzmia',
      'DELETE_RACE',
      'race',
      $1,
      $2::jsonb,
      NOW()
    )
  `,
    RACE_ID,
    JSON.stringify({
      name: race.name,
      reason: "Phantom duplicate: 2025 Draft contained 2026 Rolex 24 data, never published. Deleted to fix event card showing '2 races' for Daytona 2025 event.",
      deletedLaps: deletedLaps.count,
      deletedEntries: deletedEntries.count,
    })
  );
  console.log("  Audit log written");

  // 4. Verify event now has 1 race
  console.log("\n=== Post-deletion verification ===\n");
  const eventRaces = await prisma.race.findMany({
    where: { eventId: EXPECTED_EVENT_ID },
    select: { id: true, name: true, status: true },
  });
  console.log(`  Event ${EXPECTED_EVENT_ID} now has ${eventRaces.length} race(s):`);
  for (const r of eventRaces) {
    console.log(`    ${r.id} | ${r.name} | ${r.status}`);
  }
}

main()
  .catch((e) => { console.error("Fatal:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());

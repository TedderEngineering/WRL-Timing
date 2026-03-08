/**
 * Rename SRO races: "SRO Race N — Track" → "Pirelli GT4 Race N — Track"
 *
 * Also renames "SRO — Track" (no race number) → "Pirelli GT4 — Track"
 *
 * Usage:
 *   npx tsx scripts/rename-sro-races.ts          # dry run (preview changes)
 *   npx tsx scripts/rename-sro-races.ts --apply   # apply changes to database
 */
import { PrismaClient } from "@prisma/client";

const dryRun = !process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient();
  try {
    const races = await prisma.race.findMany({
      where: { series: "SRO" },
      select: { id: true, name: true },
      orderBy: { date: "asc" },
    });

    if (races.length === 0) {
      console.log("No SRO races found in database.");
      return;
    }

    console.log(`Found ${races.length} SRO race(s).\n`);

    const toRename: { id: string; oldName: string; newName: string }[] = [];

    for (const race of races) {
      // Replace "SRO Race" or "SRO —" at the start of the name
      const newName = race.name
        .replace(/^SRO Race/i, "Pirelli GT4 Race")
        .replace(/^SRO —/i, "Pirelli GT4 —");

      if (newName !== race.name) {
        toRename.push({ id: race.id, oldName: race.name, newName });
      }
    }

    if (toRename.length === 0) {
      console.log("No races need renaming — all names already correct.");
      return;
    }

    console.log(`${toRename.length} race(s) to rename:\n`);
    for (const r of toRename) {
      console.log(`  "${r.oldName}"`);
      console.log(`  → "${r.newName}"\n`);
    }

    if (dryRun) {
      console.log("Dry run — no changes made. Run with --apply to update the database.");
      return;
    }

    for (const r of toRename) {
      await prisma.race.update({
        where: { id: r.id },
        data: { name: r.newName },
      });
    }

    console.log(`Updated ${toRename.length} race(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});

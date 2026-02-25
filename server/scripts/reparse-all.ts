/**
 * Re-parse all IMSA races from stored source files.
 * Usage: npx tsx scripts/reparse-all.ts
 */
import { PrismaClient } from "@prisma/client";
import { getParser } from "../src/utils/parsers/index.js";
import { downloadRaceFiles } from "../src/lib/supabase.js";
import { reprocessRace } from "../src/services/race-ingest.js";

async function main() {
  const prisma = new PrismaClient();

  try {
    // List all races
    const races = await prisma.race.findMany({
      select: {
        id: true,
        name: true,
        series: true,
        track: true,
        date: true,
        sourceFiles: true,
      },
      orderBy: { date: "desc" },
    });

    console.log(`Found ${races.length} total race(s)\n`);

    for (const r of races) {
      const sf = r.sourceFiles as Record<string, string> | null;
      const hasSrc =
        sf && typeof sf === "object" && Object.keys(sf).length > 0;
      const srcLabel = hasSrc ? "HAS_SRC" : "NO_SRC";
      console.log(
        `${r.id} | ${r.series} | ${r.name} | ${r.track} | ${r.date?.toISOString().slice(0, 10)} | ${srcLabel}`
      );
    }

    // Filter to IMSA races with source files
    const imsaRaces = races.filter((r) => {
      const sf = r.sourceFiles as Record<string, string> | null;
      return (
        r.series.toLowerCase().includes("imsa") &&
        sf &&
        typeof sf === "object" &&
        Object.keys(sf).length > 0
      );
    });

    console.log(`\n--- Re-parsing ${imsaRaces.length} IMSA race(s) with source files ---\n`);

    for (const race of imsaRaces) {
      console.log(`\nRe-parsing: ${race.name} (${race.id})...`);

      try {
        const sourceFiles = race.sourceFiles as Record<string, string>;

        // Determine parser
        const format = "imsa";
        const parser = getParser(format);
        if (!parser) {
          console.error(`  ERROR: No parser for format "${format}"`);
          continue;
        }

        // Download source files
        console.log("  Downloading source files...");
        const files = await downloadRaceFiles(sourceFiles);
        console.log(`  Downloaded ${Object.keys(files).length} file(s): ${Object.keys(files).join(", ")}`);

        // Re-parse
        console.log("  Parsing...");
        const { data, annotations, warnings } = await parser.parse(files);
        console.log(`  Parsed: ${data.totalCars} cars, ${data.maxLap} laps`);
        if (data.makeGroups) {
          console.log(`  makeGroups: ${Object.keys(data.makeGroups).join(", ")} (${Object.keys(data.makeGroups).length} manufacturers)`);
        }
        for (const w of warnings) console.log(`  WARN: ${w}`);

        // Update DB
        console.log("  Updating chartData + annotationData...");
        await prisma.race.update({
          where: { id: race.id },
          data: {
            chartData: data as any,
            annotationData: annotations as any,
            maxLap: data.maxLap,
            totalCars: data.totalCars,
          },
        });

        // Re-create entries and laps
        console.log("  Re-creating entries and laps...");
        const result = await reprocessRace(race.id);
        console.log(`  Done: ${result.entriesCreated} entries, ${result.lapsCreated} laps`);
      } catch (err: any) {
        console.error(`  ERROR: ${err.message}`);
      }
    }

    console.log("\n--- All done ---");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

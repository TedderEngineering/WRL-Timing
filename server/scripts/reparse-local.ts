/**
 * Re-parse IMSA races from local source files and update the database.
 * Usage: npx tsx scripts/reparse-local.ts
 */
import { PrismaClient } from "@prisma/client";
import { getParser } from "../src/utils/parsers/index.js";
import { reprocessRace } from "../src/services/race-ingest.js";
import { readFileSync } from "fs";
import { resolve } from "path";

const DATA_ROOT = resolve(
  "C:/Users/TE/Documents/2026 Projects/WRL Data/IMSA"
);

// Map race IDs to their local source file paths
const RACE_FILES: Array<{
  raceId: string;
  name: string;
  files: { timeCardsJson: string; flagsFile?: string; pitStopJson?: string };
}> = [
  {
    raceId: "cmlzxjtsj0q6sqa01rzb31415",
    name: "BMW M Endurance Challenge (2026 Daytona)",
    files: {
      timeCardsJson: `${DATA_ROOT}/Daytona GS/23_Time Cards_Race.json`,
      flagsFile: `${DATA_ROOT}/Daytona GS/25_FlagsAnalysisWithRCMessages_Race.json`,
      pitStopJson: `${DATA_ROOT}/Daytona GS/20_Pit Stops Time Cards_Race.json`,
    },
  },
  {
    raceId: "cmlyky4g60dl1qa0112jqwk40",
    name: "BMW M Endurance Challenge at Daytona (2025)",
    files: {
      timeCardsJson: `${DATA_ROOT}/2025/Daytona/IMPC/23_Time Cards_Race.json`,
    },
  },
  {
    raceId: "cmlymbobp0gwaqa01sd1yoq6n",
    name: "Canadian Tire Motorsports Park 120",
    files: {
      timeCardsJson: `${DATA_ROOT}/2025/Canadian Tire/23_Time Cards_Race (1).json`,
    },
  },
];

async function main() {
  const prisma = new PrismaClient({ log: [] });
  const parser = getParser("imsa")!;

  try {
    for (const entry of RACE_FILES) {
      console.log(`\n=== ${entry.name} (${entry.raceId}) ===`);

      // Verify race exists
      const race = await prisma.race.findUnique({
        where: { id: entry.raceId },
        select: { id: true, name: true },
      });
      if (!race) {
        console.log("  SKIP: Race not found in DB");
        continue;
      }

      // Read local files
      const files: Record<string, string> = {};
      try {
        files.lapChartJson = readFileSync(entry.files.timeCardsJson, "utf-8");
        console.log(`  Loaded: ${entry.files.timeCardsJson}`);
      } catch (e: any) {
        console.error(`  ERROR reading lap chart: ${e.message}`);
        continue;
      }

      if (entry.files.flagsFile) {
        try {
          files.flagsJson = readFileSync(entry.files.flagsFile, "utf-8");
          console.log(`  Loaded: ${entry.files.flagsFile}`);
        } catch {
          console.log(`  No flags file, will use lap-time FCY detection`);
        }
      }

      if (entry.files.pitStopJson) {
        try {
          files.pitStopJson = readFileSync(entry.files.pitStopJson, "utf-8");
          console.log(`  Loaded: ${entry.files.pitStopJson}`);
        } catch {
          console.log(`  No pit stop file, will use inferred pit detection`);
        }
      }

      // Parse
      console.log("  Parsing...");
      const { data, annotations, warnings } = await parser.parse(files);
      console.log(`  Result: ${data.totalCars} cars, ${data.maxLap} laps`);
      if (data.makeGroups) {
        const makes = Object.entries(data.makeGroups)
          .map(([k, v]) => `${k}(${v.length})`)
          .join(", ");
        console.log(`  Manufacturers: ${makes}`);
      } else {
        console.log("  WARNING: No makeGroups generated!");
      }

      // Count penalties and settles
      let totalPenaltyMarkers = 0;
      let totalSettles = 0;
      for (const [, ann] of Object.entries(annotations)) {
        const a = ann as any;
        totalPenaltyMarkers += (a.pits || []).filter(
          (p: any) => p.c === "#f87171"
        ).length;
        totalSettles += (a.settles || []).length;
      }
      console.log(
        `  Annotations: ${totalPenaltyMarkers} penalty markers, ${totalSettles} settle markers`
      );

      // Check settle colors
      const settleColors = { green: 0, red: 0, gray: 0, other: 0 };
      for (const [, ann] of Object.entries(annotations)) {
        for (const s of (ann as any).settles || []) {
          if (s.c === "#4ade80") settleColors.green++;
          else if (s.c === "#f87171") settleColors.red++;
          else if (s.c === "#888") settleColors.gray++;
          else settleColors.other++;
        }
      }
      console.log(
        `  Settle colors: ${settleColors.green} green (gained), ${settleColors.red} red (lost), ${settleColors.gray} gray (held)`
      );

      for (const w of warnings) console.log(`  WARN: ${w}`);

      // Update database
      console.log("  Updating database...");
      await prisma.race.update({
        where: { id: entry.raceId },
        data: {
          chartData: data as any,
          annotationData: annotations as any,
          maxLap: data.maxLap,
          totalCars: data.totalCars,
        },
      });

      const result = await reprocessRace(entry.raceId);
      console.log(
        `  DB updated: ${result.entriesCreated} entries, ${result.lapsCreated} laps`
      );
    }

    console.log("\n=== All done ===");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

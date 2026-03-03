/**
 * Match pit stop JSON files from resources/ to existing IMSA races,
 * upload to Supabase Storage, and reparse each matched race.
 *
 * Usage:
 *   npx tsx scripts/add-pit-stop-files.ts            # full run
 *   npx tsx scripts/add-pit-stop-files.ts --dry-run   # preview only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import {
  supabase,
  STORAGE_BUCKET,
} from "../src/lib/supabase.js";
import {
  generateAnnotations,
  parseIMSAPitStopData,
  toPitStopTimeCards,
} from "../src/utils/parsers/position-analysis.js";
import type { PitStopTimeCard } from "../src/utils/parsers/position-analysis.js";
import type { RaceDataJson, AnnotationJson } from "../src/utils/race-validators.js";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

interface PitStopFile {
  filePath: string;
  fileName: string;
  eventName: string;
  carNumbers: Set<number>;
  content: string;
}

/** Normalize an event name for fuzzy comparison */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Check if file event name is a reasonable match for DB race name */
function eventNameMatches(fileEvent: string, raceName: string): boolean {
  const fe = normalizeName(fileEvent);
  const rn = normalizeName(raceName);
  // Either one contains the other, or they share a substantial substring
  if (rn.includes(fe) || fe.includes(rn)) return true;
  // Split into words and check overlap
  const feWords = new Set(fe.split(" ").filter((w) => w.length > 2));
  const rnWords = new Set(rn.split(" ").filter((w) => w.length > 2));
  let shared = 0;
  for (const w of feWords) {
    if (rnWords.has(w)) shared++;
  }
  // At least 2 meaningful words in common, or >50% of file event words match
  return shared >= 2 || (feWords.size > 0 && shared / feWords.size > 0.5);
}

async function main() {
  const prisma = new PrismaClient();

  try {
    // ── 1. Read all pit stop files from resources/ ───────────────
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const resourcesDir = path.resolve(__dirname, "../../resources");
    const allFiles = fs.readdirSync(resourcesDir);
    const pitFiles = allFiles.filter(
      (f) => f.startsWith("20_Pit Stops") && f.endsWith(".json")
    );

    console.log(`Found ${pitFiles.length} pit stop file(s) in resources/\n`);

    const parsedFiles: PitStopFile[] = [];
    for (const fileName of pitFiles) {
      const filePath = path.join(resourcesDir, fileName);
      const raw = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
      const json = JSON.parse(raw);
      const carNumbers = new Set<number>();
      const eventName: string = json.session?.event_name ?? "";

      if (Array.isArray(json.pit_stop_analysis)) {
        for (const entry of json.pit_stop_analysis) {
          const num = parseInt(entry.number, 10);
          if (!isNaN(num)) carNumbers.add(num);
        }
      }

      console.log(
        `  ${fileName}: "${eventName}" — ${carNumbers.size} cars [${[...carNumbers].slice(0, 5).join(", ")}${carNumbers.size > 5 ? "..." : ""}]`
      );
      parsedFiles.push({ filePath, fileName, eventName, carNumbers, content: raw });
    }

    // ── 2. Query all IMSA races with entries ─────────────────────
    const races = await prisma.race.findMany({
      where: { series: { contains: "imsa", mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        series: true,
        track: true,
        date: true,
        sourceFiles: true,
        chartData: true,
        annotationData: true,
        entries: { select: { carNumber: true } },
      },
      orderBy: { date: "desc" },
    });

    console.log(`\nFound ${races.length} IMSA race(s) in DB\n`);

    // Build race car-number sets
    const raceSets = races.map((r) => ({
      ...r,
      carNums: new Set(r.entries.map((e) => parseInt(e.carNumber, 10))),
    }));

    // ── 3. Match each file to a race ─────────────────────────────
    const matches: Array<{ file: PitStopFile; race: (typeof raceSets)[0] }> =
      [];

    for (const file of parsedFiles) {
      let bestRace: (typeof raceSets)[0] | null = null;
      let bestOverlap = 0;

      for (const race of raceSets) {
        if (race.carNums.size === 0) continue;
        // Require event name match to avoid cross-event false positives
        if (file.eventName && !eventNameMatches(file.eventName, race.name)) continue;
        let overlap = 0;
        for (const num of file.carNumbers) {
          if (race.carNums.has(num)) overlap++;
        }
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestRace = race;
        }
      }

      const overlapPct =
        bestRace && file.carNumbers.size > 0
          ? bestOverlap / file.carNumbers.size
          : 0;

      if (bestRace && overlapPct >= 0.5) {
        const sf = bestRace.sourceFiles as Record<string, string> | null;
        if (sf && sf.pitStopJson && !FORCE) {
          console.log(
            `  SKIP ${file.fileName} -> ${bestRace.name} (already has pitStopJson, use --force to re-run)`
          );
          continue;
        }
        console.log(
          `  MATCH ${file.fileName} "${file.eventName}" -> ${bestRace.name} (${bestOverlap}/${file.carNumbers.size} = ${(overlapPct * 100).toFixed(0)}%)`
        );
        matches.push({ file, race: bestRace });
      } else {
        console.log(
          `  NO MATCH ${file.fileName} "${file.eventName}" (best: ${bestRace?.name ?? "none"}, overlap: ${bestOverlap}/${file.carNumbers.size})`
        );
      }
    }

    console.log(`\n${matches.length} file(s) to process\n`);

    if (DRY_RUN) {
      console.log("--- DRY RUN — no changes made ---");
      return;
    }

    if (!supabase) {
      console.error("ERROR: Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
      process.exit(1);
    }

    // ── 4. Upload + re-annotate each match ─────────────────────────
    for (const { file, race } of matches) {
      console.log(`\nProcessing: ${file.fileName} -> ${race.name} (${race.id})`);

      try {
        // Upload to storage
        const storagePath = `${race.id}/pitStopJson.json`;
        console.log(`  Uploading to ${storagePath}...`);
        const { error: uploadErr } = await supabase!.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, Buffer.from(file.content, "utf-8"), {
            contentType: "application/json",
            upsert: true,
          });

        if (uploadErr) {
          console.error(`  Upload failed: ${uploadErr.message}`);
          continue;
        }

        // Update sourceFiles
        const sf = (race.sourceFiles as Record<string, string>) || {};
        sf.pitStopJson = storagePath;
        await prisma.race.update({
          where: { id: race.id },
          data: { sourceFiles: sf },
        });
        console.log("  sourceFiles updated");

        // Build pit time cards from the local file
        const pitData = JSON.parse(file.content);
        const parsedStops = parseIMSAPitStopData(pitData);
        const pitTimeCards = new Map<number, PitStopTimeCard[]>();
        for (const [carNum, stops] of parsedStops) {
          pitTimeCards.set(carNum, toPitStopTimeCards(stops));
        }
        console.log(`  Built pit time cards for ${pitTimeCards.size} cars`);

        // Re-generate annotations using existing chartData + new pit time cards
        const chartData = race.chartData as unknown as RaceDataJson;
        if (!chartData || !chartData.cars) {
          console.error("  ERROR: No chartData in DB");
          continue;
        }

        const existingAnnotations = race.annotationData as unknown as AnnotationJson | null;
        console.log(`  Re-generating annotations (${chartData.totalCars} cars, ${chartData.maxLap} laps)...`);
        const newAnnotations = generateAnnotations(chartData, existingAnnotations ?? undefined, pitTimeCards);

        await prisma.race.update({
          where: { id: race.id },
          data: { annotationData: newAnnotations as any },
        });
        console.log("  annotationData updated");
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

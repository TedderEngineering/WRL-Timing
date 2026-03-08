/**
 * Bulk import IMSA race data from downloaded files into the database.
 *
 * Groups files by race (using Time Cards JSON as the anchor), reads metadata
 * from the JSON, matches supporting files (CSV, pit stops, flags), then runs
 * the IMSA parser and ingests into the database.
 *
 * Usage:
 *   npx tsx scripts/imsa-bulk-import.ts                    # dry run
 *   npx tsx scripts/imsa-bulk-import.ts --apply            # import into DB
 *   npx tsx scripts/imsa-bulk-import.ts --apply --publish   # import as PUBLISHED
 *   npx tsx scripts/imsa-bulk-import.ts --dir ./downloads/2025
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { getParser } from "../src/utils/parsers/index.js";
import { ingestRaceData } from "../src/services/race-ingest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const dryRun = !hasFlag("apply");
const publish = hasFlag("publish");
const inputDir =
  getArg("dir") || path.join(__dirname, "..", "downloads", "2025");

// ─── Championship label mapping ──────────────────────────────────────────────

const CHAMPIONSHIP_LABELS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /weathertech\s+sportsc/i, label: "IMSA WeatherTech" },
  { pattern: /airbnb\s+endurance/i, label: "IMSA Endurance" },
  { pattern: /michelin\s+pilot\s+challenge/i, label: "IMSA MPC" },
  { pattern: /bmw\s+m\s+endurance/i, label: "IMSA MPC" },
  { pattern: /vp\s+racing/i, label: "IMSA VPRC" },
  { pattern: /mx-?5\s+cup/i, label: "MX-5 Cup" },
  { pattern: /mazda\s+mx-?5/i, label: "MX-5 Cup" },
  { pattern: /porsche\s+carrera/i, label: "PCCNA" },
  { pattern: /lamborghini\s+super\s+trofeo/i, label: "LST" },
  { pattern: /ford\s+mustang/i, label: "Mustang Challenge" },
  { pattern: /mustang\s+challenge/i, label: "Mustang Challenge" },
  { pattern: /historic\s+sportscar/i, label: "HSR" },
];

function championshipLabel(raw: string): string {
  for (const { pattern, label } of CHAMPIONSHIP_LABELS) {
    if (pattern.test(raw)) return label;
  }
  return raw;
}

// ─── File parsing helpers ────────────────────────────────────────────────────

interface FileInfo {
  filename: string;
  fullPath: string;
  slot: "timeCardsJson" | "timeCardsCsv" | "pitStopJson" | "flagsJson";
  sessionName: string; // e.g., "Race", "Race 1", "Qualifying Race"
  track: string;
  date: string; // YYYY-MM-DD
}

/**
 * Parse a downloaded IMSA filename into its components.
 * Format: {prefix}_{session} [{track}, {date}, IMSA].{ext}
 */
function parseFilename(filename: string): FileInfo | null {
  // Extract metadata tag: [Track, YYYY-MM-DD, IMSA]
  const tagMatch = filename.match(/\[([^,]+),\s*(\d{4}-\d{2}-\d{2}),\s*IMSA\]/i);
  if (!tagMatch) return null;

  const track = tagMatch[1].trim();
  const date = tagMatch[2];

  // Determine slot from prefix
  const upper = filename.toUpperCase();
  let slot: FileInfo["slot"];
  let prefixEnd: number;

  if (upper.startsWith("23_TIME CARDS") || upper.startsWith("23_TIME_CARDS")) {
    const ext = path.extname(filename).toUpperCase();
    if (ext === ".JSON") {
      slot = "timeCardsJson";
    } else if (ext === ".CSV") {
      slot = "timeCardsCsv";
    } else {
      return null;
    }
    // Find the underscore after "23_Time Cards" or "23_Time_Cards"
    const prefixMatch = filename.match(/^23_Time[_ ]Cards[_ ]?/i);
    prefixEnd = prefixMatch ? prefixMatch[0].length : 0;
  } else if (
    upper.startsWith("20_PIT STOPS") ||
    upper.startsWith("20_PIT_STOPS")
  ) {
    if (path.extname(filename).toUpperCase() !== ".JSON") return null;
    slot = "pitStopJson";
    const prefixMatch = filename.match(/^20_Pit[_ ]Stops[_ ]Time[_ ]Cards[_ ]?/i);
    prefixEnd = prefixMatch ? prefixMatch[0].length : 0;
  } else if (
    upper.startsWith("25_FLAGSANALYSIS") ||
    upper.startsWith("99_FLAGSANALYSIS")
  ) {
    // PDF and JSON both go to flagsJson slot (parser handles base64 PDF detection)
    slot = "flagsJson";
    const prefixMatch = filename.match(/^\d{2}_FlagsAnalysis(?:WithRCMessages)?[_ ]?/i);
    prefixEnd = prefixMatch ? prefixMatch[0].length : 0;
  } else {
    return null;
  }

  // Extract session name: everything between prefix and metadata tag
  const beforeTag = filename.slice(prefixEnd, filename.indexOf("[")).trim();
  const sessionName = beforeTag || "Race";

  return { filename, fullPath: "", slot, sessionName, track, date };
}

// ─── Race grouping ──────────────────────────────────────────────────────────

interface RaceGroup {
  key: string; // "sessionName|track|date"
  sessionName: string;
  track: string;
  date: string;
  files: Map<string, string>; // slot → fullPath
  // Metadata from JSON (populated after reading)
  championship?: string;
  eventName?: string;
  raceName?: string;
}

async function main() {
  console.log(`Scanning ${inputDir} for IMSA race files...\n`);

  if (!fs.existsSync(inputDir)) {
    console.error(`Directory not found: ${inputDir}`);
    process.exit(1);
  }

  const allFiles = fs.readdirSync(inputDir);
  const imsaFiles = allFiles.filter((f) =>
    /\[.*IMSA\]/i.test(f) && /\.(JSON|CSV|PDF)$/i.test(f)
  );

  console.log(`Found ${imsaFiles.length} IMSA files.\n`);

  // Parse and group files
  const groups = new Map<string, RaceGroup>();

  for (const filename of imsaFiles) {
    const info = parseFilename(filename);
    if (!info) continue;

    info.fullPath = path.join(inputDir, filename);
    const key = `${info.sessionName}|${info.track}|${info.date}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        sessionName: info.sessionName,
        track: info.track,
        date: info.date,
        files: new Map(),
      });
    }

    const group = groups.get(key)!;

    // Only keep the best file per slot (prefer JSON flags over PDF)
    const existing = group.files.get(info.slot);
    if (!existing) {
      group.files.set(info.slot, info.fullPath);
    } else if (
      info.slot === "flagsJson" &&
      info.fullPath.toUpperCase().endsWith(".JSON") &&
      existing.toUpperCase().endsWith(".PDF")
    ) {
      // Prefer JSON flags over PDF
      group.files.set(info.slot, info.fullPath);
    }
  }

  // Filter to groups that have at least timeCardsJson or timeCardsCsv
  const raceGroups = Array.from(groups.values()).filter(
    (g) => g.files.has("timeCardsJson") || g.files.has("timeCardsCsv")
  );

  console.log(`Found ${raceGroups.length} race groups with timing data.\n`);

  // Read JSON metadata for each group (or fall back to CSV-only)
  for (const group of raceGroups) {
    const jsonPath = group.files.get("timeCardsJson");
    if (jsonPath) {
      try {
        const raw = fs.readFileSync(jsonPath, "utf8").replace(/^\uFEFF/, "");
        if (raw.trim().length === 0) {
          // Empty/corrupt JSON — remove from files so parser uses CSV
          console.error(`  Warning: empty JSON file, falling back to CSV: ${path.basename(jsonPath)}`);
          group.files.delete("timeCardsJson");
        } else {
          const data = JSON.parse(raw);
          group.championship = data.session?.championship_name || "";
          group.eventName = data.session?.event_name || "";
        }
      } catch (e: any) {
        console.error(`  Warning: bad JSON (${e.message}), falling back to CSV: ${path.basename(jsonPath)}`);
        group.files.delete("timeCardsJson");
      }
    }

    // Build display name: "{championship} {session} — {event}"
    if (group.eventName) {
      const champLabel = championshipLabel(group.championship || "");
      const sessionPart =
        group.sessionName !== "Race" ? ` ${group.sessionName}` : "";
      group.raceName = `${champLabel}${sessionPart} — ${group.eventName}`;
    } else {
      // No JSON metadata — derive name from filename tag
      group.raceName = `IMSA ${group.sessionName} — ${group.track}`;
    }
  }

  // Remove groups that lost both JSON and CSV
  const validGroups = raceGroups.filter(
    (g) => g.files.has("timeCardsJson") || g.files.has("timeCardsCsv")
  );

  // Sort by date then name
  validGroups.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return (a.raceName || "").localeCompare(b.raceName || "");
  });

  // Check which races already exist in the database
  const prisma = new PrismaClient();
  try {
    const existingRaces = await prisma.race.findMany({
      where: { series: "IMSA" },
      select: { name: true, date: true, track: true },
    });

    // Build lookup of existing races by date+name (exact) and date+eventName (partial)
    const existingExact = new Set<string>();
    const existingByDateEvent = new Map<string, string>(); // date → existing name (for partial matching)
    for (const r of existingRaces) {
      const dateStr = r.date.toISOString().slice(0, 10);
      existingExact.add(`${dateStr}|${r.name}`);
      // Also store by date + event name (the suffix part) for matching old imports
      existingByDateEvent.set(`${dateStr}|${r.name}`, r.name);
    }

    // Separate new vs existing
    const toImport: RaceGroup[] = [];
    const alreadyExists: RaceGroup[] = [];

    for (const group of validGroups) {
      const dateNameKey = `${group.date}|${group.raceName}`;
      // Exact match on full name
      if (existingExact.has(dateNameKey)) {
        alreadyExists.push(group);
        continue;
      }
      // Partial match: check if an existing race name matches the eventName
      // (catches old imports that used just the event name, e.g., "BMW M Endurance Challenge at Daytona")
      if (group.eventName) {
        let found = false;
        for (const [key, existingName] of existingByDateEvent) {
          const [existDate] = key.split("|");
          if (existDate === group.date && existingName === group.eventName) {
            found = true;
            break;
          }
        }
        if (found) {
          alreadyExists.push(group);
          continue;
        }
      }
      toImport.push(group);
    }

    // Display summary
    console.log("━━━ Races to import ━━━\n");
    if (toImport.length === 0) {
      console.log("  (none — all races already exist in the database)\n");
    } else {
      for (const g of toImport) {
        const slots = Array.from(g.files.keys()).join(", ");
        console.log(`  ${g.date}  ${g.raceName}`);
        console.log(`           files: ${slots}`);
      }
      console.log(`\n  Total: ${toImport.length} race(s) to import\n`);
    }

    if (alreadyExists.length > 0) {
      console.log("━━━ Already in database (skipping) ━━━\n");
      for (const g of alreadyExists) {
        console.log(`  ${g.date}  ${g.raceName}`);
      }
      console.log(`\n  Total: ${alreadyExists.length} existing race(s)\n`);
    }

    if (dryRun) {
      console.log(
        "Dry run — no changes made. Run with --apply to import into the database."
      );
      return;
    }

    if (toImport.length === 0) {
      console.log("Nothing to import.");
      return;
    }

    // Import each race
    console.log(`\nImporting ${toImport.length} race(s)...\n`);
    const parser = getParser("imsa");
    let successCount = 0;
    let failCount = 0;

    for (const group of toImport) {
      const label = `${group.date} ${group.raceName}`;
      process.stdout.write(`  Importing: ${label}...`);

      try {
        // Read files into strings
        const files: Record<string, string> = {};
        for (const [slot, filePath] of group.files) {
          if (filePath.toUpperCase().endsWith(".PDF")) {
            // Flags PDFs need to be base64 encoded for the parser
            const buf = fs.readFileSync(filePath);
            files[slot] = buf.toString("base64");
          } else {
            files[slot] = fs.readFileSync(filePath, "utf8");
          }
        }

        // Parse
        const { data, annotations, warnings } = await parser.parse(files);

        if (warnings.length > 0) {
          console.log(` (${warnings.length} warnings)`);
          for (const w of warnings.slice(0, 3)) {
            console.log(`    ⚠ ${w}`);
          }
          if (warnings.length > 3) {
            console.log(`    ... and ${warnings.length - 3} more`);
          }
        }

        // Build metadata
        const metadata = {
          name: group.raceName!,
          date: new Date(group.date),
          track: group.track,
          series: "IMSA",
          season: parseInt(group.date.slice(0, 4), 10),
          premium: false,
          status: publish ? ("PUBLISHED" as const) : ("DRAFT" as const),
        };

        // Ingest
        const result = await ingestRaceData(
          metadata,
          data,
          annotations,
          "cmm1bamhy0ty5qa018xlqzmia"
        );

        console.log(
          ` OK — ${result.entriesCreated} cars, ${result.lapsCreated} laps`
        );
        successCount++;
      } catch (e: any) {
        console.log(` FAILED — ${e.message}`);
        failCount++;
      }
    }

    console.log(
      `\nDone! ${successCount} imported, ${failCount} failed, ${alreadyExists.length} skipped (existing).`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});

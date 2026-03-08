/**
 * IMSA Timing Data Downloader
 *
 * Crawls imsa.results.alkamelcloud.com to discover and download race data files
 * for IMSA championships (WeatherTech, Michelin Pilot Challenge, VP Racing, etc.).
 *
 * Usage:
 *   npx tsx scripts/imsa-download.ts                         # interactive — browse all
 *   npx tsx scripts/imsa-download.ts --season 25_2025        # specific season
 *   npx tsx scripts/imsa-download.ts --event "02_Daytona International Speedway"
 *   npx tsx scripts/imsa-download.ts --races                 # download all race sessions
 *   npx tsx scripts/imsa-download.ts --all                   # download all sessions
 *   npx tsx scripts/imsa-download.ts --championship all      # all championships (default: WeatherTech only)
 *   npx tsx scripts/imsa-download.ts --out ./downloads       # custom output directory
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = "https://imsa.results.alkamelcloud.com";

// ─── Championship patterns ──────────────────────────────────────────────────

const CHAMPIONSHIP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /weathertech\s+sportsc/i, label: "IMSA WeatherTech" },
  { pattern: /airbnb\s+endurance/i, label: "IMSA Endurance" },
  { pattern: /michelin\s+pilot\s+challenge/i, label: "IMSA MPC" },
  { pattern: /vp\s+racing/i, label: "IMSA VPRC" },
  { pattern: /mx-?5\s+cup/i, label: "MX-5 Cup" },
  { pattern: /porsche\s+carrera/i, label: "PCCNA" },
  { pattern: /lamborghini\s+super\s+trofeo/i, label: "LST" },
  { pattern: /ford\s+mustang/i, label: "Mustang Cup" },
];

// Default: only WeatherTech + successor names (AirBNB Endurance is 2026 rebrand)
const DEFAULT_CHAMPIONSHIP_FILTER = /weathertech|airbnb\s+endurance/i;

function matchChampionship(raw: string): string | null {
  const name = raw.replace(/^\d+_/, "");
  for (const { pattern, label } of CHAMPIONSHIP_PATTERNS) {
    if (pattern.test(name)) return label;
  }
  return null;
}

// ─── File matching ──────────────────────────────────────────────────────────

const WANTED_FILES = [
  // Time Cards JSON — primary data file (required by parser)
  { prefix: "23_Time Cards", ext: ".JSON", slot: "timeCardsJson", priority: 1 },
  { prefix: "23_Time_Cards", ext: ".JSON", slot: "timeCardsJson", priority: 2 },
  // Time Cards CSV — optional enrichment (adds FLAG_AT_FL per lap)
  { prefix: "23_Time Cards", ext: ".CSV", slot: "timeCardsCsv", priority: 1 },
  { prefix: "23_Time_Cards", ext: ".CSV", slot: "timeCardsCsv", priority: 2 },
  // Pit Stops JSON — optional for precise pit in/out timing and driver changes
  { prefix: "20_Pit Stops Time Cards", ext: ".JSON", slot: "pitStopJson", priority: 1 },
  { prefix: "20_Pit_Stops_Time_Cards", ext: ".JSON", slot: "pitStopJson", priority: 2 },
  { prefix: "20_Pit Stops", ext: ".JSON", slot: "pitStopJson", priority: 3 },
  // Flags Analysis JSON — RC messages + flag transitions (2024 and earlier)
  { prefix: "25_FlagsAnalysisWithRCMessages", ext: ".JSON", slot: "flagsJson", priority: 1 },
  { prefix: "99_FlagsAnalysisWithRCMessages", ext: ".JSON", slot: "flagsJson", priority: 2 },
  { prefix: "25_FlagsAnalysis", ext: ".JSON", slot: "flagsJson", priority: 3 },
  { prefix: "99_FlagsAnalysis", ext: ".JSON", slot: "flagsJson", priority: 4 },
  // Flags Analysis PDF — fallback (2025+, no JSON available)
  { prefix: "25_FlagsAnalysis", ext: ".PDF", slot: "flagsPdf", priority: 1 },
  { prefix: "99_FlagsAnalysis", ext: ".PDF", slot: "flagsPdf", priority: 2 },
];

interface DropdownOption {
  value: string;
  label: string;
  selected?: boolean;
}

interface SessionFile {
  url: string;
  filename: string;
  slot: string;
  priority: number;
  hourNum: number; // 0 = session root, N = hour N subdirectory
}

interface Session {
  timestamp: string;
  name: string;
  type: "race" | "practice" | "qualify" | "test" | "other";
  championship: string;
  championshipLabel: string;
  files: SessionFile[];
}

interface EventData {
  season: string;
  event: string;
  eventLabel: string;
  sessions: Session[];
}

// ─── HTML Parsing ────────────────────────────────────────────────────────────

function parseDropdownOptions(html: string, selectName: string): DropdownOption[] {
  const selectRe = new RegExp(
    `<select\\s+name="${selectName}"[^>]*>([\\s\\S]*?)</select>`,
    "i"
  );
  const selectMatch = html.match(selectRe);
  if (!selectMatch) return [];

  const options: DropdownOption[] = [];
  const optionRe = /<option\s+[Vv]alue="([^"]*)"([^>]*)>([^<]*)<\/option>/gi;
  let m: RegExpExecArray | null;
  while ((m = optionRe.exec(selectMatch[1])) !== null) {
    options.push({
      value: m[1],
      label: m[3].trim(),
      selected: /SELECTED/i.test(m[2]),
    });
  }
  return options;
}

function parseResultLinks(html: string): string[] {
  const links: string[] = [];
  const re = /href="(Results\/[^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    links.push(decodeURIComponent(m[1]));
  }
  return links;
}

// ─── Fetching ────────────────────────────────────────────────────────────────

async function fetchPage(params: Record<string, string>): Promise<string> {
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  return resp.text();
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} downloading ${url}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert Alkamel timestamp "202504261700" → "2025-04-26" */
function formatTimestampToDate(timestamp: string): string {
  if (timestamp.length < 8) return "";
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}

// ─── Session Classification ─────────────────────────────────────────────────

function classifySession(sessionName: string): Session["type"] {
  const lower = sessionName.toLowerCase();
  if (/\brace\b/.test(lower)) return "race";
  if (/\bqualif|\bqualify\b/.test(lower)) return "qualify";
  if (/\bpractice\b|\bfp\d/.test(lower)) return "practice";
  if (/\btest\b/.test(lower)) return "test";
  return "other";
}

// ─── Link Grouping ──────────────────────────────────────────────────────────

/**
 * IMSA link format (no series level, unlike SRO site):
 *   Results/{season}/{event}/{championship}/{timestamp}_{session}/{filename}
 *   Results/{season}/{event}/{championship}/{timestamp}_{session}/{hourSubdir}/{filename}
 */
function groupLinksIntoSessions(
  links: string[],
  championshipFilter: RegExp | null
): Session[] {
  const sessionMap = new Map<string, Session>();

  for (const link of links) {
    const parts = link.split("/");
    // parts: [Results, season, event, championship, timestamp_session, file]
    //    or: [Results, season, event, championship, timestamp_session, hourSubdir, file]
    if (parts.length < 6) continue;

    const championshipRaw = parts[3];
    const championshipLabel = matchChampionship(championshipRaw);

    // Filter by championship if specified
    if (championshipFilter) {
      const cleanName = championshipRaw.replace(/^\d+_/, "");
      if (!championshipFilter.test(cleanName)) continue;
    }

    // Use the matched label, or derive one from the raw name
    const label = championshipLabel || championshipRaw.replace(/^\d+_/, "").trim();

    const sessionPart = parts[4];
    const underscoreIdx = sessionPart.indexOf("_");
    if (underscoreIdx === -1) continue;

    const timestamp = sessionPart.slice(0, underscoreIdx);
    const sessionName = sessionPart.slice(underscoreIdx + 1).trim();

    // Get filename (last part) and detect hourly sub-directory
    const filename = parts[parts.length - 1];
    let hourNum = 0;
    if (parts.length >= 7) {
      // Check if parts[5] is an hourly subdir (e.g., "24_Hour 24", "01_HOUR 1")
      const hourMatch = parts[5].match(/(\d+)_[Hh]our\s+(\d+)/);
      if (hourMatch) {
        hourNum = parseInt(hourMatch[2], 10);
      }
    }

    // Check if this file matches what we want
    const matchedFile = matchWantedFile(filename);
    if (!matchedFile) continue;

    const sessionKey = `${championshipRaw}|${sessionPart}`;
    if (!sessionMap.has(sessionKey)) {
      sessionMap.set(sessionKey, {
        timestamp,
        name: sessionName,
        type: classifySession(sessionName),
        championship: championshipRaw,
        championshipLabel: label,
        files: [],
      });
    }

    sessionMap.get(sessionKey)!.files.push({
      url: `${BASE_URL}/${link.split("/").map((p) => encodeURIComponent(p)).join("/")}`,
      filename,
      slot: matchedFile.slot,
      priority: matchedFile.priority,
      hourNum,
    });
  }

  return Array.from(sessionMap.values());
}

function matchWantedFile(filename: string): { slot: string; priority: number } | null {
  const upper = filename.toUpperCase();
  for (const want of WANTED_FILES) {
    if (
      upper.startsWith(want.prefix.toUpperCase()) &&
      upper.endsWith(want.ext)
    ) {
      // Skip "by Class", "by Hour", "by Number" variants
      if (/by\s+(class|hour|number)/i.test(filename)) continue;
      // Skip Grid/Starting Grid files
      if (/starting\s+grid|^0[012]_/i.test(filename)) continue;
      return { slot: want.slot, priority: want.priority };
    }
  }
  return null;
}

// ─── Deduplicate files per slot ─────────────────────────────────────────────

/**
 * For each slot, keep the best file:
 * - Prefer files from the highest hour number (endurance race final results)
 * - Within the same hour, prefer lower priority number (better match)
 * - Drop flagsPdf if flagsJson exists
 */
function deduplicateFiles(files: SessionFile[]): SessionFile[] {
  const bySlot = new Map<string, SessionFile>();
  for (const f of files) {
    const existing = bySlot.get(f.slot);
    if (!existing) {
      bySlot.set(f.slot, f);
    } else {
      // Prefer higher hour number (later = more complete)
      if (f.hourNum > existing.hourNum) {
        bySlot.set(f.slot, f);
      } else if (f.hourNum === existing.hourNum && f.priority < existing.priority) {
        bySlot.set(f.slot, f);
      }
    }
  }

  // Drop PDF flags if JSON flags exist
  if (bySlot.has("flagsJson") && bySlot.has("flagsPdf")) {
    bySlot.delete("flagsPdf");
  }

  return Array.from(bySlot.values());
}

// ─── Interactive prompts ────────────────────────────────────────────────────

function createRl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stderr });
}

async function promptChoice(
  rl: readline.Interface,
  message: string,
  choices: { value: string; label: string }[]
): Promise<string> {
  console.error(`\n${message}`);
  for (let i = 0; i < choices.length; i++) {
    console.error(`  ${i + 1}. ${choices[i].label}`);
  }
  return new Promise((resolve) => {
    rl.question("\nChoice: ", (answer) => {
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < choices.length) {
        resolve(choices[idx].value);
      } else {
        const match = choices.find(
          (c) =>
            c.value.toLowerCase() === answer.toLowerCase() ||
            c.label.toLowerCase() === answer.toLowerCase()
        );
        resolve(match?.value || choices[0].value);
      }
    });
  });
}

async function promptMultiSelect(
  rl: readline.Interface,
  message: string,
  items: { value: number; label: string }[]
): Promise<number[]> {
  console.error(`\n${message}`);
  for (const item of items) {
    console.error(`  ${item.value}. ${item.label}`);
  }
  console.error(
    `\nEnter numbers separated by commas (e.g. 1,2,3), "all" for all, or "races" for race sessions only:`
  );
  return new Promise((resolve) => {
    rl.question("Selection: ", (answer) => {
      const lower = answer.trim().toLowerCase();
      if (lower === "all") {
        resolve(items.map((i) => i.value));
      } else if (lower === "races") {
        resolve([]); // sentinel — caller handles this
      } else {
        const nums = answer
          .split(/[,\s]+/)
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n));
        resolve(nums);
      }
    });
  });
}

// ─── Discovery ──────────────────────────────────────────────────────────────

async function discoverEvents(
  season: string,
  championshipFilter: RegExp | null
): Promise<EventData[]> {
  console.error(`\nFetching events for season ${season}...`);
  const html = await fetchPage({ season, evvent: "" });
  const events = parseDropdownOptions(html, "evvent");

  const allEvents: EventData[] = [];

  for (const event of events) {
    if (!event.value) continue;
    console.error(`  Scanning ${event.label}...`);
    const eventHtml = await fetchPage({ season, evvent: event.value });
    const links = parseResultLinks(eventHtml);
    const sessions = groupLinksIntoSessions(links, championshipFilter);

    if (sessions.length > 0) {
      allEvents.push({
        season,
        event: event.value,
        eventLabel: event.label,
        sessions,
      });
    }
  }

  return allEvents;
}

async function discoverSingleEvent(
  season: string,
  event: string,
  championshipFilter: RegExp | null
): Promise<EventData> {
  console.error(`\nFetching ${event}...`);
  const html = await fetchPage({ season, evvent: event });
  const links = parseResultLinks(html);
  const sessions = groupLinksIntoSessions(links, championshipFilter);
  const events = parseDropdownOptions(html, "evvent");
  const eventLabel =
    events.find((e) => e.value === event)?.label || event.replace(/^\d+_/, "");

  return { season, event, eventLabel, sessions };
}

// ─── Display ────────────────────────────────────────────────────────────────

function displaySessions(events: EventData[]): {
  index: number;
  session: Session;
  event: EventData;
}[] {
  const items: { index: number; session: Session; event: EventData }[] = [];
  let idx = 1;

  for (const event of events) {
    console.error(`\n━━━ ${event.eventLabel} ━━━`);

    // Group by championship
    const byChampionship = new Map<string, Session[]>();
    for (const s of event.sessions) {
      if (!byChampionship.has(s.championshipLabel))
        byChampionship.set(s.championshipLabel, []);
      byChampionship.get(s.championshipLabel)!.push(s);
    }

    for (const [label, sessions] of byChampionship) {
      // Sort: races first, then by timestamp
      sessions.sort((a, b) => {
        const typeOrder = { race: 0, qualify: 1, practice: 2, test: 3, other: 4 };
        const ta = typeOrder[a.type] ?? 4;
        const tb = typeOrder[b.type] ?? 4;
        if (ta !== tb) return ta - tb;
        return a.timestamp.localeCompare(b.timestamp);
      });

      console.error(`\n  ${label}:`);
      for (const session of sessions) {
        const dedupedFiles = deduplicateFiles(session.files);
        const fileList = dedupedFiles.map((f) => f.slot).join(", ");
        const typeTag =
          session.type === "race"
            ? "[RACE]"
            : session.type === "qualify"
              ? "[QUAL]"
              : session.type === "practice"
                ? "[PRAC]"
                : session.type === "test"
                  ? "[TEST]"
                  : "[    ]";
        console.error(
          `    ${String(idx).padStart(3)}. ${typeTag} ${session.name} — files: ${fileList}`
        );
        items.push({ index: idx, session, event });
        idx++;
      }
    }
  }

  return items;
}

// ─── Download ───────────────────────────────────────────────────────────────

async function downloadSession(
  session: Session,
  event: EventData,
  outDir: string
): Promise<string[]> {
  const dedupedFiles = deduplicateFiles(session.files);
  const downloaded: string[] = [];

  // Flat output: downloads/{year}/
  const seasonYear = event.season.replace(/^\d+_/, "");
  const subDir = path.join(outDir, seasonYear);

  // Build metadata tag for filenames: [Track, YYYY-MM-DD, IMSA]
  const track = event.eventLabel.replace(/[^\w\s-]/g, "").trim();
  const dateStr = formatTimestampToDate(session.timestamp);
  const metaTag = track && dateStr ? ` [${track}, ${dateStr}, IMSA]` : "";

  for (const file of dedupedFiles) {
    // Build tagged filename
    const ext = path.extname(file.filename);
    const base = path.basename(file.filename, ext);
    const taggedFilename = metaTag ? `${base}${metaTag}${ext}` : file.filename;
    const destPath = path.join(subDir, taggedFilename);

    if (fs.existsSync(destPath)) {
      console.error(`    Skip (exists): ${taggedFilename}`);
      downloaded.push(destPath);
      continue;
    }

    // Check if untagged version exists in same dir — rename it
    const untaggedPath = path.join(subDir, file.filename);
    if (metaTag && fs.existsSync(untaggedPath)) {
      fs.renameSync(untaggedPath, destPath);
      console.error(`    Renamed: ${file.filename} → ${taggedFilename}`);
      downloaded.push(destPath);
      continue;
    }

    try {
      console.error(`    Downloading: ${taggedFilename}...`);
      await downloadFile(file.url, destPath);
      downloaded.push(destPath);
    } catch (e: any) {
      console.error(`    ERROR: ${taggedFilename} — ${e.message}`);
    }
  }

  return downloaded;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  const hasFlag = (name: string): boolean => args.includes(`--${name}`);

  let season = getArg("season");
  let event = getArg("event");
  const downloadAll = hasFlag("all");
  const racesOnly = hasFlag("races");
  const outDir = getArg("out") || path.join(__dirname, "..", "downloads");

  // Championship filter
  const champArg = getArg("championship");
  let championshipFilter: RegExp | null = DEFAULT_CHAMPIONSHIP_FILTER;
  if (champArg === "all") {
    championshipFilter = null; // no filter — all championships
  } else if (champArg) {
    championshipFilter = new RegExp(champArg, "i");
  }

  // If no season specified, fetch the page to discover available seasons
  if (!season) {
    const html = await fetchPage({ season: "", evvent: "" });
    const seasons = parseDropdownOptions(html, "season");
    if (seasons.length === 0) {
      console.error("No seasons found.");
      process.exit(1);
    }

    if (downloadAll || racesOnly) {
      // Use latest season
      season = seasons[seasons.length - 1].value;
    } else {
      const rl = createRl();
      season = await promptChoice(
        rl,
        "Select season:",
        seasons.map((s) => ({ value: s.value, label: s.label }))
      );
      rl.close();
    }
  }

  // Discover events
  let events: EventData[];
  if (event) {
    events = [await discoverSingleEvent(season, event, championshipFilter)];
  } else {
    events = await discoverEvents(season, championshipFilter);
  }

  if (events.length === 0 || events.every((e) => e.sessions.length === 0)) {
    console.error("No sessions found matching championship filter.");
    console.error(
      "Tip: use --championship all to see all championships, or --championship <pattern> to filter."
    );
    process.exit(1);
  }

  // Display all sessions
  const items = displaySessions(events);

  if (downloadAll || racesOnly) {
    // Auto-select
    const toDownload = racesOnly
      ? items.filter((i) => i.session.type === "race")
      : items;

    console.error(
      `\nDownloading ${toDownload.length} session(s) to ${outDir}...`
    );

    let totalFiles = 0;
    for (const item of toDownload) {
      console.error(
        `\n  ${item.session.championshipLabel} — ${item.event.eventLabel} — ${item.session.name}`
      );
      const files = await downloadSession(item.session, item.event, outDir);
      totalFiles += files.length;
    }

    console.error(`\nDone! Downloaded ${totalFiles} file(s).`);
  } else {
    // Interactive selection
    const rl = createRl();
    const selected = await promptMultiSelect(
      rl,
      "Select sessions to download:",
      items.map((i) => ({
        value: i.index,
        label: `${i.session.championshipLabel} — ${i.event.eventLabel} — ${i.session.name}`,
      }))
    );
    rl.close();

    let toDownload: typeof items;
    if (selected.length === 0) {
      // "races" was entered
      toDownload = items.filter((i) => i.session.type === "race");
    } else {
      toDownload = items.filter((i) => selected.includes(i.index));
    }

    if (toDownload.length === 0) {
      console.error("No sessions selected.");
      process.exit(0);
    }

    console.error(
      `\nDownloading ${toDownload.length} session(s) to ${outDir}...`
    );

    let totalFiles = 0;
    for (const item of toDownload) {
      console.error(
        `\n  ${item.session.championshipLabel} — ${item.event.eventLabel} — ${item.session.name}`
      );
      const files = await downloadSession(item.session, item.event, outDir);
      totalFiles += files.length;
    }

    console.error(`\nDone! Downloaded ${totalFiles} file(s).`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});

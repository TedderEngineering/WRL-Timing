/**
 * Alkamel Timing Data Downloader
 *
 * Crawls usac.alkamelna.com to discover and download race data files
 * for SRO GT4 America and GR Cup North America.
 *
 * Usage:
 *   npx tsx scripts/alkamel-download.ts                         # interactive — browse all
 *   npx tsx scripts/alkamel-download.ts --series 06_SRO         # specific series
 *   npx tsx scripts/alkamel-download.ts --season 25_2025        # specific season
 *   npx tsx scripts/alkamel-download.ts --event "03_Circuit of the Americas"
 *   npx tsx scripts/alkamel-download.ts --all                   # download all race sessions
 *   npx tsx scripts/alkamel-download.ts --out ./downloads       # custom output directory
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = "http://usac.alkamelna.com";

// Sub-series we care about — match by normalized name (numbers vary per event)
const TARGET_SUB_SERIES_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /pirelli\s+gt4\s+america|gt4\s+america/i, label: "GT4" },
  { pattern: /tgrna\s+gr\s+cup|gr\s+cup\s+north\s+america/i, label: "GR Cup" },
];

function matchSubSeries(raw: string): string | null {
  // Strip leading number prefix like "16_" or "03_"
  const name = raw.replace(/^\d+_/, "");
  for (const { pattern, label } of TARGET_SUB_SERIES_PATTERNS) {
    if (pattern.test(name)) return label;
  }
  return null;
}

// File prefixes we want to download (for race sessions)
const WANTED_FILES = [
  { prefix: "00_Results", ext: ".CSV", slot: "resultsCsv", priority: 1 },
  { prefix: "03_Results", ext: ".CSV", slot: "resultsCsv", priority: 2 },
  { prefix: "03_Provisional Results", ext: ".CSV", slot: "resultsCsv", priority: 3 },
  { prefix: "05_Provisional Results", ext: ".CSV", slot: "resultsCsv", priority: 4 },
  { prefix: "05_Results", ext: ".CSV", slot: "resultsCsv", priority: 5 },
  { prefix: "23_AnalysisEndurance", ext: ".CSV", slot: "lapsCsv", priority: 1 },
  { prefix: "20_Pit Stops", ext: ".PDF", slot: "pitStopPdf", priority: 1 },
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
}

interface Session {
  timestamp: string;
  name: string;
  type: "race" | "practice" | "qualify" | "test" | "other";
  subSeries: string;
  subSeriesLabel: string;
  files: SessionFile[];
}

interface EventData {
  series: string;
  season: string;
  event: string;
  eventLabel: string;
  sessions: Session[];
}

// ─── HTML Parsing ─────────────────────────────────────────────────────────────

function parseDropdownOptions(html: string, selectName: string): DropdownOption[] {
  // Find the <select name="..."> block
  const selectRe = new RegExp(
    `<select\\s+name="${selectName}"[^>]*>([\\s\\S]*?)</select>`,
    "i"
  );
  const selectMatch = html.match(selectRe);
  if (!selectMatch) return [];

  const options: DropdownOption[] = [];
  const optionRe = /<option\s+Value="([^"]*)"([^>]*)>([^<]*)<\/option>/gi;
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

// ─── Fetching ─────────────────────────────────────────────────────────────────

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

// ─── Session Classification ──────────────────────────────────────────────────

function classifySession(sessionName: string): Session["type"] {
  const lower = sessionName.toLowerCase();
  if (/\brace\b/.test(lower)) return "race";
  if (/\bqualif|\bqualify\b/.test(lower)) return "qualify";
  if (/\bpractice\b|\bfp\d/.test(lower)) return "practice";
  if (/\btest\b/.test(lower)) return "test";
  return "other";
}

// ─── Link Grouping ───────────────────────────────────────────────────────────

function groupLinksIntoSessions(links: string[]): Session[] {
  // Link format: Results/{series}/{season}/{event}/{subSeries}/{timestamp}_{session}/{filename}
  // or with subdirs: Results/{series}/{season}/{event}/{subSeries}/{timestamp}_{session}/{subdir}/{filename}
  const sessionMap = new Map<string, Session>();

  for (const link of links) {
    const parts = link.split("/");
    // parts[0] = "Results", [1] = series, [2] = season, [3] = event, [4] = subSeries, [5] = timestamp_session
    if (parts.length < 7) continue;

    const subSeriesRaw = parts[4];
    // Only process target sub-series
    const subSeriesLabel = matchSubSeries(subSeriesRaw);
    if (!subSeriesLabel) continue;

    const sessionPart = parts[5]; // e.g. "202504261700_Race 1"
    const underscoreIdx = sessionPart.indexOf("_");
    if (underscoreIdx === -1) continue;

    const timestamp = sessionPart.slice(0, underscoreIdx);
    const sessionName = sessionPart.slice(underscoreIdx + 1).trim();

    // Get filename (last part, ignoring sub-directories like "01_HOUR 1")
    const filename = parts[parts.length - 1];

    // Check if this file matches what we want
    const matchedFile = matchWantedFile(filename);
    if (!matchedFile) continue;

    const sessionKey = `${subSeriesRaw}|${sessionPart}`;
    if (!sessionMap.has(sessionKey)) {
      sessionMap.set(sessionKey, {
        timestamp,
        name: sessionName,
        type: classifySession(sessionName),
        subSeries: subSeriesRaw,
        subSeriesLabel,
        files: [],
      });
    }

    sessionMap.get(sessionKey)!.files.push({
      url: `${BASE_URL}/${link.split("/").map((p) => encodeURIComponent(p)).join("/")}`,
      filename,
      slot: matchedFile.slot,
      priority: matchedFile.priority,
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
      // Skip "Results by Class" for the 00_ slot — we only want the main results
      if (want.prefix === "00_Results" && /by\s+class/i.test(filename)) continue;
      // Skip "Results by Hour"
      if (/by\s+hour/i.test(filename)) continue;
      return { slot: want.slot, priority: want.priority };
    }
  }
  return null;
}

// ─── Deduplicate files per slot (keep best priority) ──────────────────────────

function deduplicateFiles(files: SessionFile[]): SessionFile[] {
  const bySlot = new Map<string, SessionFile>();
  for (const f of files) {
    const existing = bySlot.get(f.slot);
    if (!existing || f.priority < existing.priority) {
      bySlot.set(f.slot, f);
    }
  }
  return Array.from(bySlot.values());
}

// ─── Interactive prompts ──────────────────────────────────────────────────────

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
        // Try matching by value
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
  console.error(`\nEnter numbers separated by commas (e.g. 1,2,3), "all" for all, or "races" for race sessions only:`);
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

// ─── Discovery ────────────────────────────────────────────────────────────────

async function discoverEvents(
  series: string,
  season: string
): Promise<EventData[]> {
  console.error(`\nFetching events for ${series} / ${season}...`);
  const html = await fetchPage({ series, season, evvent: "" });
  const events = parseDropdownOptions(html, "evvent");

  const allEvents: EventData[] = [];

  for (const event of events) {
    if (!event.value) continue;
    console.error(`  Scanning ${event.label}...`);
    const eventHtml = await fetchPage({ series, season, evvent: event.value });
    const links = parseResultLinks(eventHtml);
    const sessions = groupLinksIntoSessions(links);

    if (sessions.length > 0) {
      allEvents.push({
        series,
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
  series: string,
  season: string,
  event: string
): Promise<EventData> {
  console.error(`\nFetching ${event}...`);
  const html = await fetchPage({ series, season, evvent: event });
  const links = parseResultLinks(html);
  const sessions = groupLinksIntoSessions(links);
  const events = parseDropdownOptions(html, "evvent");
  const eventLabel =
    events.find((e) => e.value === event)?.label || event.replace(/^\d+_/, "");

  return { series, season, event, eventLabel, sessions };
}

// ─── Display ──────────────────────────────────────────────────────────────────

function displaySessions(events: EventData[]): {
  index: number;
  session: Session;
  event: EventData;
}[] {
  const items: { index: number; session: Session; event: EventData }[] = [];
  let idx = 1;

  for (const event of events) {
    console.error(`\n━━━ ${event.eventLabel} ━━━`);

    // Group by sub-series
    const bySubSeries = new Map<string, Session[]>();
    for (const s of event.sessions) {
      if (!bySubSeries.has(s.subSeriesLabel)) bySubSeries.set(s.subSeriesLabel, []);
      bySubSeries.get(s.subSeriesLabel)!.push(s);
    }

    for (const [label, sessions] of bySubSeries) {
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

// ─── Download ─────────────────────────────────────────────────────────────────

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

  // Build metadata tag for filenames: [Track, YYYY-MM-DD, Series]
  const track = event.eventLabel.replace(/[^\w\s-]/g, "").trim();
  const dateStr = formatTimestampToDate(session.timestamp);
  const seriesLabel = session.subSeriesLabel;
  const metaTag = track && dateStr ? ` [${track}, ${dateStr}, ${seriesLabel}]` : "";

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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  const hasFlag = (name: string): boolean => args.includes(`--${name}`);

  let series = getArg("series") || "06_SRO";
  let season = getArg("season");
  let event = getArg("event");
  const downloadAll = hasFlag("all");
  const racesOnly = hasFlag("races");
  const outDir = getArg("out") || path.join(__dirname, "..", "downloads");

  // If no season specified, fetch the page to discover available seasons
  if (!season) {
    const html = await fetchPage({ series, season: "", evvent: "" });
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
    events = [await discoverSingleEvent(series, season, event)];
  } else {
    events = await discoverEvents(series, season);
  }

  if (events.length === 0 || events.every((e) => e.sessions.length === 0)) {
    console.error("No sessions found for target sub-series.");
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
        `\n  ${item.session.subSeriesLabel} — ${item.event.eventLabel} — ${item.session.name}`
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
      items.map((i) => ({ value: i.index, label: `${i.session.subSeriesLabel} — ${i.event.eventLabel} — ${i.session.name}` }))
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
        `\n  ${item.session.subSeriesLabel} — ${item.event.eventLabel} — ${item.session.name}`
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

/**
 * Arguments for the fact engine (G2 `scripts/build-facts.ts`) from a work
 * folder's manifest.
 *
 * build-facts takes `<format> role=path…`. Its Alkamel adapter needs exactly
 * one lap file (laps or time_cards, CSV) and reads every flags and by-class
 * file it is given, so duplicates of the same content (flags JSON + CSV) are
 * dropped here: one file per role, in the order the adapter prefers.
 */
import type { FileRole, Manifest, ManifestFile } from "./types.js";

/** Lowercase slug matching the package schema's packageId pattern ^[a-z0-9]+(-[a-z0-9]+)*$. */
export function packageIdFor(m: Pick<Manifest, "seriesId" | "metadata">): string {
  return `${m.seriesId}-${m.metadata.raceDate}-${m.metadata.sessionName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const ext = (f: ManifestFile) => (f.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

function pick(files: ManifestFile[], role: FileRole, prefer: string[]): ManifestFile | null {
  const xs = files.filter((f) => f.role === role && prefer.includes(ext(f)));
  xs.sort((a, b) => prefer.indexOf(ext(a)) - prefer.indexOf(ext(b)));
  return xs[0] ?? null;
}

export function factFiles(m: Manifest): ManifestFile[] {
  const fs = m.files;
  const out: (ManifestFile | null)[] = [];
  if (m.factFormat === "speedhive" || m.factFormat === "wrl-website") {
    out.push(pick(fs, "laps", ["csv"]), pick(fs, "summary", ["csv"]), pick(fs, "flags", ["csv"]), pick(fs, "control_log", ["csv"]));
  } else {
    out.push(pick(fs, "laps", ["csv"]) ?? pick(fs, "time_cards", ["csv"]));
    // Main results: JSON and CSV of the same mark are both kept (the adapter prefers JSON rows and reads report_message from it).
    out.push(...fs.filter((f) => f.role === "results" && ["csv", "json"].includes(ext(f))));
    out.push(
      pick(fs, "results_by_class", ["json", "csv"]),
      pick(fs, "pit_cards_json", ["json"]) ?? pick(fs, "pit_cards_pdf", ["pdf"]),
      pick(fs, "drive_time", ["csv"]),
      pick(fs, "flags", ["json", "csv"]),
      pick(fs, "weather", ["csv"]),
      pick(fs, "lap_chart", ["json"])
    );
  }
  return out.filter((f): f is ManifestFile => !!f);
}

/** Argument vector after `npx tsx scripts/build-facts.ts`. */
export function buildFactsArgs(m: Manifest, dirPath: (name: string) => string, out: string): string[] {
  return [
    m.factFormat,
    ...factFiles(m).map((f) => `${f.role}=${dirPath(f.name)}`),
    "--out",
    out,
    "--series",
    m.seriesLabel,
    "--event",
    m.metadata.event,
    "--session",
    m.metadata.sessionName,
    "--season",
    String(m.metadata.season),
    "--package-id",
    packageIdFor(m),
    // The WRL website export has no date in its files (D-DATE); the others carry their own.
    ...(m.factFormat === "wrl-website" ? ["--date", m.metadata.raceDate] : []),
  ];
}

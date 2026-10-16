/**
 * Helpers for reviewing an analysis package on Admin › Analysis drafts: the context that renders
 * story tokens ({car:…}, {class:…}, {driver:…}) and the car stories in reading order.
 */
import type { CarStory, Entry, RaceAnalysisPackage } from "@shared/race-analysis-package/types";
import type { ProseContext } from "../../lib/prose";

/** The lookups prose needs, built the same way as the Dashboard's recap and Your car card. */
export function storyContext(pkg: RaceAnalysisPackage): ProseContext {
  const cars: NonNullable<ProseContext["cars"]> = {};
  for (const e of pkg.entries ?? []) {
    cars[e.car] = {
      team: e.team ?? "",
      drivers: (e.drivers ?? []).map((d) => d.name),
      driverNumbers: (e.drivers ?? []).map((d) => d.number),
    };
  }
  const classes = Object.fromEntries((pkg.metadata?.classes ?? []).map((c) => [c.id, c.name ?? c.id]));
  return { cars, classes };
}

export interface StoryRow {
  car: string;
  entry: Entry | null;
  story: CarStory | null;
}

export interface ClassStories {
  classId: string;
  name: string;
  rows: StoryRow[];
}

const finishKey = (e: Entry | null) => e?.result?.positionClass ?? Number.POSITIVE_INFINITY;

/**
 * Every car, class by class in the package's class order, each class in finishing order (unclassified
 * cars last, by car number). A car with no story is kept, with story null, so a gap is visible.
 */
export function storiesByClass(pkg: RaceAnalysisPackage): ClassStories[] {
  const storyOf = new Map((pkg.carStories ?? []).map((s) => [String(s.car), s]));
  const defs = [...(pkg.metadata?.classes ?? [])].sort((a, b) => a.order - b.order);
  const groups = new Map<string, ClassStories>();
  for (const d of defs) groups.set(d.id, { classId: d.id, name: d.name ?? d.id, rows: [] });

  const seen = new Set<string>();
  for (const e of pkg.entries ?? []) {
    const car = String(e.car);
    seen.add(car);
    if (!groups.has(e.class)) groups.set(e.class, { classId: e.class, name: e.class, rows: [] });
    groups.get(e.class)!.rows.push({ car, entry: e, story: storyOf.get(car) ?? null });
  }
  // A story for a car missing from the entry list still shows, in its own group.
  for (const [car, story] of storyOf) {
    if (seen.has(car)) continue;
    if (!groups.has("?")) groups.set("?", { classId: "?", name: "Not in the entry list", rows: [] });
    groups.get("?")!.rows.push({ car, entry: null, story });
  }

  const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return [...groups.values()]
    .filter((g) => g.rows.length > 0)
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => finishKey(a.entry) - finishKey(b.entry) || byNumber(a.car, b.car)) }));
}

/** "P3 in class", "DNF", "Not classified": the finish as a short label, from the package only. */
export function finishLabel(e: Entry | null): string | null {
  const r = e?.result;
  if (!r) return null;
  if (r.status === "classified") return r.positionClass ? `P${r.positionClass} in class` : "Classified";
  return { not_classified: "Not classified", dnf: "DNF", dns: "DNS", dsq: "DSQ", excluded: "Excluded" }[r.status] ?? null;
}

/** True when the text matches the filter: a car number ("12", "#12") or part of a team or driver name. */
export function matchesFilter(row: StoryRow, filter: string): boolean {
  const q = filter.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  if (row.car.toLowerCase() === q) return true;
  if (/^\d+$/.test(q)) return false; // a number means a car number, not part of "Team 12"
  const e = row.entry;
  const hay = [e?.team, ...(e?.drivers ?? []).map((d) => d.name)].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

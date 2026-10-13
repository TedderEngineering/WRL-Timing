/**
 * A small, display-ready recap of one published Race Analysis Package for
 * the dashboard (RaceTrace 2.0, G6 dashboard). Prose stays as written in the
 * package ({text, refs}); the client renders the tokens, so every number on
 * the dashboard is the package's own fact reference.
 */
import type { Prose } from "../analysis/schema/package-types.js";

export interface RecapCar {
  team: string;
  make: string;
  drivers: string[];
}

export interface RecapClassWinner {
  class: string;
  className: string;
  car: string;
  team: string;
  make: string;
  drivers: string[];
  summary: Prose | null;
}

export interface RecapMoment {
  id: string;
  lap: number;
  lapEnd: number | null;
  causes: string[];
  title: Prose;
  text: Prose | null;
  cars: string[];
}

export interface RecapBand {
  kind: "fcy" | "pit_cycle";
  fromLap: number;
  toLap: number;
  label: string;
}

export interface Recap {
  packageId: string;
  session: string;
  resultsStatus: string;
  totalLaps: number | null;
  headline: Prose;
  /** The summary's paragraphs, shown when the reader expands the recap. */
  paragraphs: Prose[];
  classWinners: RecapClassWinner[];
  moments: RecapMoment[];
  bands: RecapBand[];
  postRace: { car: string; class: string; penaltyS: number; before: number | null; after: number | null }[];
  /** Entity lookup for rendering {car:…}, {class:…}, {driver:…} tokens. */
  cars: Record<string, RecapCar & { driverNumbers: number[] }>;
  classes: Record<string, string>;
}

type Pkg = Record<string, any>;

/** First lap of `car` whose crossing time (endS) is at or after t. */
function lapAt(pkg: Pkg, car: string | null, t: number | undefined): number | null {
  if (!car || typeof t !== "number") return null;
  const cols = pkg.laps?.cars?.[car];
  if (!cols?.endS || !cols?.lap) return null;
  for (let i = 0; i < cols.endS.length; i++) {
    if (typeof cols.endS[i] === "number" && cols.endS[i] >= t) return cols.lap[i];
  }
  return cols.lap[cols.lap.length - 1] ?? null;
}

export function extractRecap(pkg: Pkg): Recap | null {
  const summary = pkg.raceSummary;
  if (!summary?.headline?.text) return null;

  const meta = pkg.metadata ?? {};
  const classOrder: { id: string; name: string; order?: number }[] = [...(meta.classes ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
  const classes: Record<string, string> = Object.fromEntries(classOrder.map((c) => [c.id, c.name ?? c.id]));

  const entries: any[] = pkg.entries ?? [];
  const cars: Recap["cars"] = {};
  for (const e of entries) {
    cars[e.car] = {
      team: e.team ?? "",
      make: e.make && e.make !== "TBD" ? e.make : "",
      drivers: (e.drivers ?? []).map((d: any) => d.name),
      driverNumbers: (e.drivers ?? []).map((d: any) => d.number),
    };
  }

  const classified = entries.filter((e) => e.result && typeof e.result.positionOverall === "number");
  const overallWinner = classified.find((e) => e.result.positionOverall === 1) ?? null;
  const totalLaps = overallWinner?.result?.laps ?? null;

  const summaries = new Map<string, Prose>(
    (summary.classSummaries ?? []).map((c: any) => [c.class, c.text as Prose])
  );
  const classWinners: RecapClassWinner[] = [];
  for (const c of classOrder) {
    const w = classified.find((e) => e.class === c.id && e.result.positionClass === 1);
    if (!w) continue;
    classWinners.push({
      class: c.id,
      className: c.name ?? c.id,
      car: w.car,
      team: w.team ?? "",
      make: cars[w.car]?.make ?? "",
      drivers: cars[w.car]?.drivers ?? [],
      summary: summaries.get(c.id) ?? null,
    });
  }

  const moments: RecapMoment[] = (summary.keyMoments ?? []).map((k: any) => ({
    id: k.id,
    lap: Number(k.lap?.value),
    lapEnd: k.lapEnd ? Number(k.lapEnd.value) : null,
    causes: k.causes ?? [],
    title: k.title,
    text: k.text ?? null,
    cars: k.cars ?? [],
  }));

  const bands: RecapBand[] = [];
  for (const f of pkg.fcyPeriods ?? []) {
    if (Array.isArray(f.leaderLaps)) {
      bands.push({ kind: "fcy", fromLap: f.leaderLaps[0], toLap: f.leaderLaps[1], label: f.type === "safety_car" ? "Safety car" : "Full Course Yellow" });
    }
  }
  // Pit cycles as one band per overlapping group, in leader laps.
  const leader = overallWinner?.car ?? null;
  const cyc = (pkg.pitCycles ?? [])
    .map((c: any) => ({ from: lapAt(pkg, leader, c.opens?.raceTimeS), to: lapAt(pkg, leader, c.closes?.raceTimeS) }))
    .filter((c: any) => c.from != null && c.to != null)
    .sort((a: any, b: any) => a.from - b.from);
  for (const c of cyc) {
    const last = bands.length ? bands[bands.length - 1] : null;
    if (last && last.kind === "pit_cycle" && c.from <= last.toLap + 1) last.toLap = Math.max(last.toLap, c.to);
    else bands.push({ kind: "pit_cycle", fromLap: c.from, toLap: c.to, label: "Pit cycles" });
  }

  const postRace = classified
    .filter((e) => typeof e.result.postRacePenaltyS === "number" && e.result.postRacePenaltyS > 0)
    .map((e) => ({
      car: e.car,
      class: e.class,
      penaltyS: e.result.postRacePenaltyS,
      before: e.result.prePenaltyPositionClass ?? null,
      after: e.result.positionClass ?? null,
    }));

  return {
    packageId: pkg.packageId,
    session: meta.session ?? "",
    resultsStatus: meta.resultsStatus ?? "none",
    totalLaps,
    headline: summary.headline,
    paragraphs: summary.paragraphs ?? [],
    classWinners,
    moments,
    bands,
    postRace,
    cars,
    classes,
  };
}

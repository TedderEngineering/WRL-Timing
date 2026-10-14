import type { Prose } from "../../lib/prose";

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

export interface Recap {
  packageId: string;
  session: string;
  resultsStatus: string;
  totalLaps: number | null;
  headline: Prose;
  paragraphs: Prose[];
  classWinners: RecapClassWinner[];
  moments: RecapMoment[];
  bands: { kind: "fcy" | "pit_cycle"; fromLap: number; toLap: number; label: string }[];
  postRace: { car: string; class: string; penaltyS: number; before: number | null; after: number | null }[];
  cars: Record<string, { team: string; make: string; drivers: string[]; driverNumbers: number[] }>;
  classes: Record<string, string>;
}

export interface LatestRace {
  id: string;
  name: string;
  session: string;
  date: string;
  totalCars: number | null;
  maxLap: number | null;
  resultsStatus: string | null;
  locked: boolean;
  lockReason: string | null;
  recap: Recap | null;
}

export interface LatestEvent {
  key: string;
  series: string;
  subSeries: string | null;
  seriesLabel: string | null;
  round: { number: number; of: number; name: string } | null;
  track: string;
  startDate: string;
  endDate: string;
  isNew: boolean;
  races: LatestRace[];
}

export type RoundStatus = "on_site" | "missing" | "live" | "upcoming";

export interface SeasonRound {
  round: number;
  name: string;
  track: string;
  start: string;
  end: string;
  note?: string;
  status: RoundStatus;
  isNext: boolean;
  races: { id: string; name: string; date: string }[];
}

export interface SeasonSeries {
  id: string;
  label: string;
  shortLabel: string;
  badge: string;
  source: { title: string; url: string; checked: string };
  rounds: SeasonRound[];
  counts: { total: number; run: number; onSite: number };
  complete: boolean;
  latestOnSite: SeasonRound | null;
  next: SeasonRound | null;
}

export interface SeasonResponse {
  season: number | null;
  seasons: number[];
  today: string;
  series: SeasonSeries[];
  suggested: string[];
  next: (SeasonRound & { seriesId: string; seriesLabel: string }) | null;
  upcoming: (SeasonRound & { seriesId: string; seriesLabel: string })[];
}

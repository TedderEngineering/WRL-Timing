/**
 * Read-only indexes over a Race Analysis Package for the rule checks.
 */
import type {
  CarId,
  Entry,
  FcyPeriod,
  FlagEvent,
  IsoDateTime,
  Penalty,
  PitPassage,
  RaceAnalysisPackage,
  Stint,
} from "../package-types.js";
import type { Rulebook, TimingFormatKey } from "../rulebook-types.js";
import { rulebookClassFor } from "../load-rulebook.js";

export interface CarLap {
  lap: number;
  /** raceTimeS of the crossing that ends the lap. */
  endS: number;
  /** raceTimeS of the start of the lap (previous crossing, or end - lap time for the first row). */
  startS: number;
  lapTimeS: number | null;
  fcy: number | null;
  pos: number | null;
  driver: number | null;
}

const FORMAT_KEYS: Record<string, TimingFormatKey> = {
  "alkamel-imsa": "alkamel_imsa",
  "alkamel-sro": "alkamel_sro",
  "alkamel-grcup": "alkamel_grcup",
  speedhive: "speedhive",
  "wrl-website": "wrl_website",
};

export function formatKeyOf(sourceFormat: string | undefined): TimingFormatKey | null {
  return (sourceFormat && FORMAT_KEYS[sourceFormat]) || null;
}

/** Natural car order: numeric value, then string ('7' < '007' < '11'). */
export function carOrder(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.length - b.length || a.localeCompare(b);
}

export const r3 = (x: number) => Math.round(x * 1000) / 1000;

function parseOffset(iso: string): number {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  if (!m) return 0;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -v : v;
}

export class RaceCtx {
  readonly pkg: RaceAnalysisPackage;
  readonly rulebook: Rulebook;
  readonly format: TimingFormatKey | null;
  readonly originMs: number;
  readonly offsetMin: number;
  readonly entries = new Map<CarId, Entry>();
  readonly laps = new Map<CarId, CarLap[]>();
  readonly lapIdx = new Map<CarId, Map<number, number>>();
  readonly passages = new Map<CarId, PitPassage[]>();
  readonly passageById = new Map<string, PitPassage>();
  readonly penalties: Penalty[];
  readonly flags: FlagEvent[];
  readonly fcy: FcyPeriod[];
  readonly stints = new Map<CarId, Stint[]>();
  /** Last crossing of the race (chequered flag); Infinity when unknown. */
  readonly chequeredS: number;
  /** Published race duration (time expiry - origin), when known. */
  readonly publishedDurationS: number | null;
  /** Scheduled start of the session (rulebook event session), ISO 8601, when known. */
  readonly scheduledStart: string | null;
  /** The format carries pit-lane in/out timestamps (Alkamel); WRL does not. */
  readonly hasPitTimes: boolean;
  /** The race has race-control messages or penalty decisions (flags file / control log). */
  readonly hasRaceControl: boolean;
  /** FCY periods come from a flags file or race-control log (not reconstructed from per-lap flags). */
  readonly fcyFromFlags: boolean;
  /** Overall leader crossings (raceTimeS), ascending. */
  readonly leaderCrossings: number[];

  constructor(
    pkg: RaceAnalysisPackage,
    rulebook: Rulebook,
    opts: { publishedDurationS?: number | null; scheduledStart?: string | null } = {}
  ) {
    this.pkg = pkg;
    this.rulebook = rulebook;
    this.format = formatKeyOf(pkg.metadata?.sourceFormat);
    this.originMs = Date.parse(pkg.metadata.timeOrigin);
    this.offsetMin = parseOffset(pkg.metadata.timeOrigin);
    for (const e of pkg.entries ?? []) this.entries.set(e.car, e);
    const leader: number[] = [];
    for (const [car, c] of Object.entries(pkg.laps?.cars ?? {})) {
      const rows: CarLap[] = [];
      for (let i = 0; i < c.lap.length; i++) {
        const lt = c.lapTimeS?.[i] ?? null;
        const prevEnd =
          i > 0 && c.lap[i - 1] === c.lap[i] - (c.span?.[i] ?? 1) ? c.endS[i - 1] : null;
        const startS =
          prevEnd ?? (lt !== null ? c.endS[i] - lt : i > 0 ? c.endS[i - 1] : 0);
        rows.push({
          lap: c.lap[i],
          endS: c.endS[i],
          startS: r3(Math.max(0, startS)),
          lapTimeS: lt,
          fcy: c.fcy?.[i] ?? null,
          pos: c.pos?.[i] ?? null,
          driver: c.driver?.[i] ?? null,
        });
        if (c.pos?.[i] === 1) leader.push(c.endS[i]);
      }
      this.laps.set(car, rows);
      this.lapIdx.set(car, new Map(rows.map((r, i) => [r.lap, i])));
    }
    this.leaderCrossings = leader.sort((a, b) => a - b);
    for (const p of pkg.events?.pitPassages ?? []) {
      this.passageById.set(p.id, p);
      this.passages.set(p.car, [...(this.passages.get(p.car) ?? []), p]);
    }
    for (const list of this.passages.values()) list.sort((a, b) => a.ordinal - b.ordinal);
    for (const s of pkg.stints ?? [])
      this.stints.set(s.car, [...(this.stints.get(s.car) ?? []), s]);
    for (const list of this.stints.values()) list.sort((a, b) => a.ordinal - b.ordinal);
    this.penalties = [...(pkg.events?.penalties ?? [])];
    this.flags = [...(pkg.events?.flags ?? [])].sort(
      (a, b) => a.at.raceTimeS - b.at.raceTimeS
    );
    this.fcy = [...(pkg.fcyPeriods ?? [])].sort(
      (a, b) => a.start.raceTimeS - b.start.raceTimeS
    );
    this.chequeredS = pkg.metadata.chequeredFlag?.raceTimeS ?? Infinity;
    this.publishedDurationS =
      pkg.metadata.scheduledDurationS ?? opts.publishedDurationS ?? null;
    this.scheduledStart = opts.scheduledStart ?? null;
    this.hasPitTimes = [...this.passageById.values()].some((p) => p.pitIn !== null);
    this.hasRaceControl =
      this.penalties.some((p) => p.source?.kind === "official") ||
      this.flags.some(
        (f) => f.type === "message" || f.type === "pits_open" || f.type === "pits_closed"
      );
    this.fcyFromFlags =
      this.fcy.length === 0
        ? this.flags.length > 0
        : this.fcy.every((f) => f.source?.kind === "official");
  }

  /** ISO 8601 wall clock of a race time, in the race's own UTC offset. */
  clock(raceTimeS: number): IsoDateTime {
    const local = new Date(
      this.originMs + Math.round(raceTimeS * 1000) + this.offsetMin * 60000
    );
    const iso = local.toISOString().replace("Z", "");
    const sign = this.offsetMin < 0 ? "-" : "+";
    const abs = Math.abs(this.offsetMin);
    return `${iso}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  }

  /** Class label of a car in the timing data. */
  classOf(car: CarId): string | null {
    return this.entries.get(car)?.class ?? null;
  }

  /** Rulebook class id of a car (null when the rulebook does not list the class). */
  rbClassOf(car: CarId): string | null {
    const c = this.classOf(car);
    return c ? rulebookClassFor(this.rulebook, c) : null;
  }

  /** Every car of the race (entries, else lap-table cars), in car order. */
  allCars(): CarId[] {
    const s = new Set<CarId>([...this.entries.keys(), ...this.laps.keys()]);
    return [...s].sort(carOrder);
  }

  lap(car: CarId, lap: number): CarLap | null {
    const i = this.lapIdx.get(car)?.get(lap);
    return i === undefined ? null : this.laps.get(car)![i];
  }

  /** The car's lap whose interval (start, end] contains t; the first lap when t is before it; null after the last. */
  lapAt(car: CarId, t: number): CarLap | null {
    const rows = this.laps.get(car) ?? [];
    for (const r of rows) if (t <= r.endS) return r;
    return null;
  }

  /** The FCY period containing t (start <= t < end; a period ending at the finish is open-ended). */
  fcyAt(t: number): FcyPeriod | null {
    for (const f of this.fcy) {
      const end = f.endsAtFinish ? Infinity : f.end.raceTimeS;
      if (f.start.raceTimeS <= t && t < end) return f;
    }
    return null;
  }

  /** A line crossing at t is under green when no FCY period contains it. */
  isGreenAt(t: number): boolean {
    return this.fcyAt(t) === null;
  }

  flagsIn(type: FlagEvent["type"], from: number, to: number): FlagEvent[] {
    return this.flags.filter(
      (f) => f.type === type && f.at.raceTimeS >= from && f.at.raceTimeS <= to
    );
  }

  penaltiesOf(car: CarId): Penalty[] {
    return this.penalties.filter((p) => p.car === car);
  }

  /** Slowest class median clean green lap (D-REF-PACE), for bounding WRL boundary laps. */
  slowestClassMedianLapS(): number | null {
    const v = (this.pkg.metadata.classes ?? [])
      .map((c) => c.medianCleanGreenLapS)
      .filter((x): x is number => typeof x === "number");
    return v.length ? Math.max(...v) : null;
  }

  hasRedFlag(): boolean {
    return this.fcy.some((f) => f.type === "red");
  }
}

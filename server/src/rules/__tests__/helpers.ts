/**
 * Builders for small synthetic fact packages and rulebooks used by the rule-check unit tests.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CarId,
  DriveTime,
  FcyPeriod,
  FlagEvent,
  Penalty,
  PitPassage,
  RaceAnalysisPackage,
  SourceFormat,
  Stint,
} from "../package-types.js";
import type { RuleDef, Rulebook, Severity, TimingFormatKey } from "../rulebook-types.js";
import { validateRulebook } from "../load-rulebook.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ORIGIN = "2026-05-01T12:00:00.000-04:00";

export function loadFixture(name: string): RaceAnalysisPackage {
  return JSON.parse(
    readFileSync(join(HERE, "fixtures", name), "utf8")
  ) as RaceAnalysisPackage;
}

const tp = (s: number) => ({ raceTimeS: s });

export interface CarSpec {
  class: string;
  drivers?: number[];
  result?: {
    laps: number;
    status?: "classified" | "dnf" | "dns" | "not_classified";
    pos?: number;
  };
  /** The overall leader at every crossing (pos = 1). */
  leader?: boolean;
  /** Lap crossings: [lap, endS] or [lap, endS, lapTimeS]. Lap time defaults to the gap to the previous crossing. */
  laps?: ([number, number] | [number, number, number])[];
}

export interface PassageSpec {
  car: CarId;
  kind?: PitPassage["kind"];
  pitIn?: number | null;
  pitOut?: number | null;
  lane?: number | null;
  inLap?: number;
  outLap?: number | null;
  outcome?: PitPassage["outcome"];
  driverIn?: number | null;
  driverOut?: number | null;
  fcyContext?: PitPassage["fcyContext"];
  confidence?: PitPassage["confidence"];
}

export interface PackageSpec {
  format?: SourceFormat;
  durationS?: number | null;
  chequeredS?: number;
  track?: string;
  raceDate?: string;
  cars: Record<CarId, CarSpec>;
  passages?: PassageSpec[];
  /** [start, end] (end null = ends at finish); source defaults to official (flags file). */
  fcy?: {
    start: number;
    end: number | null;
    source?: "official" | "reconstructed";
    type?: FcyPeriod["type"];
  }[];
  flags?: { type: FlagEvent["type"]; at: number; classes?: string[]; message?: string }[];
  penalties?: (Omit<Partial<Penalty>, "issued"> & {
    car: CarId;
    type: Penalty["penaltyType"];
    issued: number;
    servedBy?: number;
  })[];
  stints?: (Partial<Stint> & { car: CarId; startLap: number; endLap: number })[];
  driveTimes?: {
    car: CarId;
    driver: number;
    s: number;
    confidence?: DriveTime["confidence"];
  }[];
  classes?: { id: string; median?: number }[];
}

export function makePkg(spec: PackageSpec): RaceAnalysisPackage {
  const lapCars: RaceAnalysisPackage["laps"]["cars"] = {};
  for (const [car, c] of Object.entries(spec.cars)) {
    if (!c.laps) continue;
    const rows = [...c.laps].sort((a, b) => a[0] - b[0]);
    lapCars[car] = {
      lap: rows.map((r) => r[0]),
      endS: rows.map((r) => r[1]),
      lapTimeS: rows.map((r, i) =>
        r.length === 3 ? r[2] : i === 0 ? r[1] : r[1] - rows[i - 1][1]
      ),
      flag: rows.map(() => null),
      fcy: rows.map(() => 0),
      fcyFrac: rows.map(() => 0),
      pit: rows.map(() => 0),
      pos: rows.map(() => (c.leader ? 1 : 0)),
      cpos: rows.map(() => 0),
      lapsDown: rows.map(() => 0),
      clean: rows.map(() => 1),
    };
  }
  const counter = new Map<string, number>();
  const passages: PitPassage[] = (spec.passages ?? [])
    .slice()
    .sort((a, b) => (a.pitIn ?? a.inLap ?? 0) - (b.pitIn ?? b.inLap ?? 0))
    .map((p) => {
      const n = (counter.get(p.car) ?? 0) + 1;
      counter.set(p.car, n);
      const pitOut =
        p.pitOut ?? (p.pitIn != null && p.lane != null ? p.pitIn + p.lane : null);
      return {
        id: `pit:${p.car}:${n}`,
        car: p.car,
        ordinal: n,
        kind: p.kind ?? "stop",
        kindBasis: ["default_stop"],
        outcome: p.outcome ?? "rejoined",
        pitIn: p.pitIn == null ? null : tp(p.pitIn),
        pitOut: pitOut == null ? null : tp(pitOut),
        inLap: p.inLap ?? 0,
        inLapCompleted: true,
        outLap: p.outLap ?? null,
        officialPitLaneTimeS:
          p.lane ?? (p.pitIn != null && pitOut != null ? pitOut - p.pitIn : null),
        fcyContext: p.fcyContext ?? "green",
        fcyPeriodIds: [],
        timeLost: { valueS: null, method: "none" },
        stopNumber: null,
        cycleId: null,
        driverIn: p.driverIn ?? null,
        driverOut: p.driverOut ?? null,
        penaltiesServed: [],
        source: { kind: "official" },
        confidence: p.confidence ?? "high",
      } as PitPassage;
    });
  const fcy: FcyPeriod[] = (spec.fcy ?? []).map((f, i) => ({
    id: `fcy:${i + 1}`,
    type: f.type ?? "fcy",
    start: tp(f.start),
    end: tp(f.end ?? spec.chequeredS ?? 1e6),
    endsAtFinish: f.end === null,
    leaderLaps: [0, 0],
    durationS: (f.end ?? spec.chequeredS ?? 1e6) - f.start,
    source: { kind: f.source ?? "official" },
    confidence: f.source === "reconstructed" ? "medium" : "high",
  }));
  const flags: FlagEvent[] = (spec.flags ?? [])
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((f, i) => ({
      id: `flag:${i + 1}`,
      type: f.type,
      at: tp(f.at),
      classes: f.classes,
      message: f.message,
      source: { kind: "official" },
    }));
  const pcount = new Map<string, number>();
  const penalties: Penalty[] = (spec.penalties ?? []).map((p) => {
    const n = (pcount.get(p.car) ?? 0) + 1;
    pcount.set(p.car, n);
    const served =
      p.servedBy !== undefined
        ? passages.filter((x) => x.car === p.car)[p.servedBy - 1]
        : undefined;
    return {
      id: `pen:${p.car}:${n}`,
      car: p.car,
      issued: tp(p.issued),
      reason: p.reason ?? "Incident Responsibility",
      penaltyType: p.type,
      amountS: p.amountS ?? null,
      status: p.status ?? (served ? "served" : "issued"),
      servedByPassageId: served?.id ?? null,
      source: { kind: "official" },
      confidence: "high",
    } as Penalty;
  });
  const scount = new Map<string, number>();
  const stints: Stint[] = (spec.stints ?? []).map((s) => {
    const n = (scount.get(s.car) ?? 0) + 1;
    scount.set(s.car, n);
    return {
      id: `stint:${s.car}:${n}`,
      ordinal: n,
      driver: null,
      start: tp(0),
      end: tp(0),
      startReason: "pit_out",
      endReason: "pit_in",
      laps: s.endLap - s.startLap + 1,
      driveTimeS: 0,
      source: { kind: "derived" },
      confidence: "high",
      ...s,
    } as Stint;
  });
  const driveTimes: DriveTime[] = (spec.driveTimes ?? []).map((d) => ({
    id: `drive:${d.car}:${d.driver}`,
    car: d.car,
    driver: d.driver,
    driveTimeS: d.s,
    stintIds: [],
    source: { kind: "derived" },
    confidence: d.confidence ?? "high",
  }));
  const classes =
    spec.classes ??
    [...new Set(Object.values(spec.cars).map((c) => c.class))].map((id) => ({ id }));
  return {
    schemaVersion: "1.0.0",
    metadata: {
      series: "Test",
      season: 2026,
      event: "Test event",
      session: "Race",
      track: { id: spec.track ?? "test-track", name: "Test track" },
      raceDate: spec.raceDate ?? "2026-05-01",
      timezone: "America/New_York",
      timeOrigin: ORIGIN,
      scheduledDurationS: spec.durationS === undefined ? 3600 : spec.durationS,
      chequeredFlag:
        spec.chequeredS === undefined
          ? { raceTimeS: 3700 }
          : { raceTimeS: spec.chequeredS },
      sourceFormat: spec.format ?? "alkamel-imsa",
      resultsStatus: "official",
      classes: classes.map((c, i) => ({
        id: c.id,
        name: c.id,
        order: i + 1,
        medianCleanGreenLapS: (c as { median?: number }).median ?? null,
      })),
      lexicon: [],
    },
    entries: Object.entries(spec.cars).map(([car, c]) => ({
      id: `car:${car}`,
      car,
      class: c.class,
      team: "Team",
      make: "TBD",
      makeBasis: "none",
      vehicle: "TBD",
      drivers: (c.drivers ?? [1, 2]).map((n) => ({ number: n, name: "A. Driver" })),
      result: c.result
        ? {
            id: `result:${car}`,
            status: c.result.status ?? "classified",
            positionOverall: c.result.pos ?? null,
            positionClass: null,
            laps: c.result.laps,
            resultsStatus: "official",
            source: { kind: "official" },
            confidence: "high",
          }
        : null,
      source: { kind: "official" },
      confidence: "high",
    })),
    laps: { layout: "columnar-per-car/1", columnSources: {}, cars: lapCars },
    fcyPeriods: fcy,
    events: { pitPassages: passages, pitGroups: [], penalties, retirements: [], flags },
    stints,
    driveTimes,
  } as unknown as RaceAnalysisPackage;
}

const FORMATS: TimingFormatKey[] = [
  "alkamel_imsa",
  "alkamel_sro",
  "speedhive",
  "wrl_website",
];

export function rule(
  id: string,
  type: RuleDef["type"],
  params: Record<string, unknown>,
  extra: Partial<RuleDef> = {}
): RuleDef {
  return {
    id,
    type,
    title: id,
    params,
    source: { doc: "DOC", section: "1.1", page: 1 },
    quote: "A short verbatim quote.",
    verified: false,
    checkable_with: Object.fromEntries(FORMATS.map((f) => [f, ["x"]])),
    check: "synthetic test rule; EMIT(...)",
    severity: "likely" as Severity,
    ...extra,
  };
}

export function makeRulebook(rules: RuleDef[], extra: Partial<Rulebook> = {}): Rulebook {
  const rb: Rulebook = {
    schema: "racetrace-rulebook/0.1",
    id: "test-2026",
    series: { id: "test", name: "Test Series", timing_formats: ["alkamel_imsa"] },
    season: 2026,
    status: "draft",
    documents: [
      {
        id: "DOC",
        title: "Test regulations",
        version: "1",
        date: "2026-01-01",
        issuer: "Test",
        obtained: "yes",
      },
    ],
    classes: [{ id: "GS" }, { id: "TCR" }],
    defaults: { tolerances: { pit_clock_s: 0.5, drive_time_s: 1.0 } },
    rules,
    ...extra,
  };
  const errs = validateRulebook(rb);
  if (errs.length) throw new Error(`invalid test rulebook:\n${errs.join("\n")}`);
  return rb;
}

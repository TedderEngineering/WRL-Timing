/**
 * Fact engine entry point: buildFacts(input) → the fact sections of a Race Analysis Package
 * (FACT_ENGINE_SPEC.md §2). Pure and deterministic: no I/O, no clock (generatedAt is an input).
 * Prose sections (ruleFindings, carStories, raceSummary) are left empty for the Claude pass.
 */
import { checkLapChart } from "./engine/lap-chart.js";
import type {
  Confidence,
  DataQualityNote,
  LapColumns,
  LapTable,
  PitPassage,
  RaceAnalysisPackage,
  SourceFile,
  SourceFormat,
} from "./schema/package-types.js";
import type { BuildOptions, InputFile, Issue, SourceFileInfo } from "./types.js";
import { adapt } from "./adapters/index.js";
import { buildClasses, buildLaps, buildTimeAxis, sortedCars, tp, type Ctx } from "./engine/context.js";
import { buildFcyPeriods, classifyLapFcy, toFcyPeriods } from "./engine/fcy.js";
import { computePositions } from "./engine/positions.js";
import {
  assignStopNumbers,
  buildRawPassages,
  classifyAlkamel,
  estimateTransit,
  fcyContext,
  linkServedMessages,
  linkTimeAtStop,
  parsePenalties,
  passageRows,
  type Passage,
} from "./engine/passages.js";
import { classMedians, classifyWrl, computeTimeLost, markClean, promoteLongStopsToGarage } from "./engine/timelost.js";
import { buildPitCycles, buildPositionChanges, computeCycleResults, detectSwaps, toPitCycles } from "./engine/cycles.js";
import { buildStints } from "./engine/stints.js";
import { buildResults, finalisePenalties } from "./engine/results.js";
import { carOrder, matchDriver, rd } from "./util.js";

export const ENGINE_VERSION = "1.2.10"; // 1.1.0: C8, cycle positions count from before the cycle opened. 1.1.1: red-flag holds (kind red_flag_hold), Drive Time rows split by a red flag joined. 1.2.0: one cycle result per car (nMembers counts cars), green_loss_exceeds_pit_lane, serve window in green time, time penalties at the next stop, repeated RC messages merged. 1.2.1: a post-race time penalty printed twice (race control and results) is one; a drive-through with no pit-lane time is linked to its penalty. 1.2.2: garage time excluded from the serve window; stop penalties announced just after the car came in. 1.2.3: a Stop + N is never served by a transit-speed pass; low-confidence stops are not ranked in a cycle; more results wordings; no-lap cars named by race control started. 1.2.4: RedMist stops whose time lost is over the garage threshold are garage visits (no pit-cycle member); a black flag is not a disqualification unless it says so. 1.2.5: RedMist pit flags still set while the car laps at racing pace are ignored (a stop no longer runs on for 50 laps). 1.2.6: the same for stops from the pit report; pit-report rows with no lap pit flag and under 10 s in the pit lane are not stops. 1.2.7: a report stop is not moved back across laps at racing pace with stuck pit flags. 1.2.8: a car that joined late starts its first stint with its first lap; a drive-through served in a RedMist visit with a reissued entry is linked to it; a retirement notes laps counted in the pit lane after it. 1.2.9: RedMist report rows under 20 s are not pit-lane times (the rows of one split visit are one stop), and a WRL drive-through needs race control's penalty. 1.2.10: a driver-change stop names the out-lap's driver when the lap records lag; a reissued entry's short partial time is not a pit-lane time.
export type FactsPackage = RaceAnalysisPackage;

export interface BuildFactsInput {
  format: SourceFormat;
  files: InputFile[];
  options?: BuildOptions;
}

const MEDIUM_NOTES = new Set([
  "no_time_card",
  "in_lap_from_b_flag",
  "last_in_pit_inferred",
  "pit_out_is_session_end",
  "ambiguous_short_stop",
  "span_row_in_passage",
  "fcy_reconstructed_boundary",
  "ref_window_widened",
  "neighbours_few",
  "neighbours_all_classes",
  "neighbours_wide_window",
  "negative_time_lost",
  "out_lap_ends_in_pit_lane",
  "no_rc_penalty_text",
  "pit_report_laps_corrected",
  "pit_entry_renumbered",
  "pit_lane_time_exceeds_passage",
  "pit_clock_lap_mismatch",
  "not_in_pit_report",
  "pit_flag_lap_late",
  "green_loss_exceeds_pit_lane",
  "served_before_message",
  "drive_through_without_pit_time",
  "pit_flags_stuck",
]);
const LOW_NOTES = new Set([
  "drive_through_by_duration",
  "drive_through_by_loss_fraction",
  "pit_flag_without_loss",
  "inferred_passage",
  "fcy_lap_field_fallback",
  "fcy_loss_below_minus_10",
  "fcy_loss_exceeds_pit_lane",
  "no_reference_pace",
]);

export function confidenceFromNotes(notes: string[], floor: Confidence = "high"): Confidence {
  let c: Confidence = floor;
  for (const n of notes) {
    if (LOW_NOTES.has(n)) return "low";
    if (MEDIUM_NOTES.has(n)) c = "medium";
  }
  return c;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "race";
}


export function buildFacts(input: BuildFactsInput): FactsPackage {
  const opts = input.options ?? {};
  const issues: Issue[] = [];
  const files: SourceFileInfo[] = input.files.map((f, i) => ({ ...f, fileId: `f${i + 1}` }));
  const { race, issues: adapterIssues } = adapt(input.format, files);
  issues.push(...adapterIssues);

  /* M1, M2 */
  const axis = buildTimeAxis(race, opts, issues);
  const laps = buildLaps(race, axis);
  const { classes, classOf } = buildClasses(race);
  const cars = sortedCars(new Set([...race.entries.map((e) => e.car)]));
  for (const c of Object.keys(laps)) if (!classOf[c]) throw new Error(`car ${c} has laps but no entry`);
  const allEnds = Object.values(laps).flatMap((rs) => rs.map((r) => r.endT));
  const raceEndT = allEnds.length ? Math.max(...allEnds) : axis.origin;
  const ff = race.flagRecords.filter((r) => r.recType.toUpperCase() === "FF").map((r) => r.tS);
  let chequerT: number;
  if (ff.length) chequerT = Math.min(...ff);
  else {
    const maxLap = Math.max(0, ...Object.values(laps).flatMap((rs) => rs.map((r) => r.lap)));
    const ends = Object.values(laps).flatMap((rs) => rs.filter((r) => r.lap === maxLap).map((r) => r.endT));
    chequerT = ends.length ? Math.min(...ends) : raceEndT;
  }
  const ctx: Ctx = {
    race,
    opts,
    axis,
    laps,
    cars,
    classOf,
    classes,
    raceEndT,
    chequerT,
    issues,
    fileIds: (role: string) => files.filter((f) => f.role === role).map((f) => f.fileId),
  };

  /* M3, M4 */
  const fcy = buildFcyPeriods(ctx);
  classifyLapFcy(laps, fcy.periods);

  /* M5 */
  const pos = computePositions(laps, classOf);
  // A-LC: report where the official lap chart, when there is one, disagrees with D-POS.
  checkLapChart(files, laps, issues);

  /* M6, M7, M8 */
  let passages = buildRawPassages(ctx);
  const unknown = passages.filter((p) => !classOf[p.car]);
  for (const p of unknown) {
    issues.push({ severity: "blocker", code: "CARD-UNMATCHED", message: `Pit record for car '${p.car}' (${p.refs[0]}) matches no entry.`, files: p.files });
  }
  passages = passages.filter((p) => classOf[p.car]);
  const { penalties: pens, served } = parsePenalties(ctx);
  const rb = opts.rulebook ?? null;
  const garageS = rb?.garageThresholdS ?? 600;
  const serveWindowS = rb?.serveWindowS ?? 1200;
  const transit = estimateTransit(passages, rb?.pitLaneTransitS, laps);
  const wrl = race.format === "speedhive" || race.format === "wrl-website";
  // Kinds from pit-lane times (Alkamel rules) when the race has any; else the WRL time-lost rules
  // (Speedhive, WRL website, RedMist without a pit report).
  const lapOnly = wrl || (race.format === "redmist" && !passages.some((p) => p.official !== null));
  if (!lapOnly) {
    if (transit.estimated && transit.valueS !== null) {
      issues.push(
        transit.valid
          ? { severity: "note", code: "TRANSIT-ESTIMATED", message: `No configured pit-lane transit for this track; the race minimum official pit-lane time (${rd(transit.valueS)} s, ${transit.fromPassageId}) is the transit estimate (D-TRANSIT).`, factIds: transit.fromPassageId ? [transit.fromPassageId] : [] }
          : { severity: "warning", code: "TRANSIT-ESTIMATE-INVALID", message: `The race minimum pit-lane time (${rd(transit.valueS)} s) is more than 0.75 x the median: no drive-through in this race, so no duration-based classification is done.` },
      );
    }
  }

  /* D-FCY-STOP for every passage (needs laps.fcy) */
  for (const p of passages) fcyContext(ctx, p, fcy.periods);

  /* M9, M10 (Alkamel; RedMist with a pit report) */
  if (!lapOnly) {
    classifyAlkamel(ctx, passages, pens, transit, garageS, serveWindowS, fcy.periods);
    linkTimeAtStop(passages, pens);
  }

  /* M11 */
  markClean(ctx, passages);
  const medians = classMedians(ctx);
  const { groups } = computeTimeLost(ctx, passages);
  if (lapOnly) classifyWrl(ctx, passages, groups, garageS);
  else if (race.format === "redmist") promoteLongStopsToGarage(passages, groups, garageS);
  assignStopNumbers(passages);
  linkServedMessages(pens, served);

  // laps.pit bits
  for (const p of passages) {
    const rows = laps[p.car] ?? [];
    if (p.inIdx === null) continue;
    rows[p.inIdx].pit |= 1;
    if (p.outIdx !== null) {
      rows[p.outIdx].pit |= 2;
      for (let i = p.inIdx + 1; i < p.outIdx; i++) rows[i].pit |= 4;
    } else if (p.lastIdx !== undefined) {
      for (let i = p.inIdx + 1; i <= p.lastIdx; i++) rows[i].pit |= 4;
    }
  }
  for (const p of passages) {
    if (passageRows(laps[p.car] ?? [], p).some((r) => r.span > 1)) p.confNotes.push("span_row_in_passage");
  }

  /* M13 - M15 */
  const drafts = buildPitCycles(ctx, passages, fcy.periods, medians, rb?.pitCycleModel);
  const swaps = detectSwaps(ctx, pos, passages);
  const cycleResults = computeCycleResults(ctx, pos, drafts, passages, swaps, groups);
  const positionChanges = buildPositionChanges(ctx, swaps, drafts, passages);

  /* M12 */
  const scheduledDurationS = rb?.scheduledDurationS ?? race.session.scheduledDurationS ?? null;
  const driveEndT = rb?.driveTimeEndsAt === "leader_finish" || scheduledDurationS === null ? chequerT : axis.origin + scheduledDurationS;
  const { stints, driveTimes } = buildStints(ctx, passages, fcy.periods, driveEndT);

  /* M16 */
  const results = buildResults(ctx, passages);
  const penalties = finalisePenalties(ctx, pens, results.entries, results.tookFlag);

  /* M18 confidence (passages) */
  for (const p of passages) p.confidence = confidenceFromNotes(p.confNotes, p.confidence);
  const pitCycles = toPitCycles(ctx, drafts, passages, medians, groups);
  const lowShare = passages.length ? passages.filter((p) => p.confidence === "low").length / passages.length : 0;
  if (lowShare > 0.1) {
    issues.push({ severity: "warning", code: "LOW-CONFIDENCE-SHARE", message: `${Math.round(lowShare * 100)} % of pit passages are low confidence; their numbers need a judgement before a story states them.` });
  }
  const noLoss = passages.filter((p) => p.noLoss);
  if (noLoss.length) {
    issues.push({ severity: "warning", code: "PIT-FLAG-NO-LOSS", message: `${noLoss.length} passage(s) carry the pit flag but lost less than 10 s (WN9); kept at confidence low and not cycle members.`, factIds: noLoss.map((p) => p.id) });
  }

  /* M19 assemble */
  const pitPassages = passages.map((p) => toPitPassage(ctx, p, results.entries));
  const lapTable = toLapTable(ctx, files);
  const fcyPeriods = toFcyPeriods(ctx, fcy.periods, fcy.flags);
  const sourceFiles: SourceFile[] = files.map((f) => {
    const sf: SourceFile = { fileId: f.fileId, role: f.role, name: f.name, sha256: f.sha256, bytes: f.bytes, archive: f.archive };
    const mark = f.reportMark ?? (["results", "results_by_class", "summary"].includes(f.role) ? (race.results?.mark ?? "unknown") : undefined);
    if (mark) sf.reportMark = mark;
    return sf;
  });
  const lexicon = new Set<string>();
  // Lexicon = proper names that contain a digit (they may appear verbatim in prose, V4/A7). Names
  // without digits are left out so that they cannot mask a banned or required word (e.g. session 'Race').
  const addLex = (s: string | null | undefined) => {
    if (s && s.trim() && /[0-9]/.test(s)) lexicon.add(s.trim());
  };
  const meta = race.session;
  const series = opts.series ?? meta.series ?? "TBD";
  const event = opts.event ?? meta.event ?? "TBD";
  const session = opts.session ?? meta.session ?? "Race";
  const trackName = opts.track?.name ?? meta.trackName ?? "TBD";
  [series, event, session, trackName].forEach(addLex);
  for (const e of results.entries) {
    addLex(e.team);
    addLex(e.vehicle === "TBD" ? null : e.vehicle);
    addLex(e.make === "TBD" ? null : e.make);
    for (const d of e.drivers) addLex(d.name);
  }
  for (const c of classes) {
    addLex(c.name);
    addLex(c.id);
  }
  const dataQuality: DataQualityNote[] = dedupeIssues(issues).map((x, i) => {
    const n: DataQualityNote = { id: `dq:${i + 1}`, severity: x.severity, code: x.code, message: x.message };
    if (x.factIds?.length) n.factIds = x.factIds;
    if (x.files?.length) n.files = x.files;
    return n;
  });
  const metadataClasses = classes.map((c) => ({ id: c.id, name: c.name, order: c.order, medianCleanGreenLapS: rd(medians[c.id] ?? null, 4) }));
  const season = opts.season ?? Number(axis.raceDate.slice(0, 4));
  const pkg: RaceAnalysisPackage = {
    schemaVersion: "1.1.0",
    packageId: opts.packageId ?? slug(`${series}-${axis.raceDate}-${session}`),
    status: "draft",
    completeness: {
      entries: "complete",
      laps: "complete",
      fcyPeriods: "complete",
      events: "complete",
      stints: "complete",
      pitCycles: "complete",
      cycleResults: "complete",
      positionChanges: "complete",
      ruleChecks: "absent",
      ruleFindings: "absent",
      carStories: "absent",
      raceSummary: "absent",
    },
    engineVersion: opts.engineVersion ?? ENGINE_VERSION,
    rulebookVersion: rb?.id && rb?.version ? `${rb.id}@${rb.version}` : null,
    rulebook: rb ? { status: "partial", ...(rb.id ? { fileId: rb.id } : {}), ...(rb.version ? { version: rb.version } : {}) } : { status: "absent" },
    generatedAt: opts.generatedAt ?? "1970-01-01T00:00:00Z",
    analysis: { author: "engine" },
    sourceFiles,
    metadata: {
      series,
      ...(opts.seriesId ? { seriesId: opts.seriesId } : {}),
      season,
      event,
      session,
      track: {
        id: opts.track?.id ?? slug(trackName),
        name: trackName,
        ...(opts.track?.layout ? { layout: opts.track.layout } : {}),
        ...(opts.track?.lengthM ?? meta.trackLengthM ? { lengthM: opts.track?.lengthM ?? meta.trackLengthM } : {}),
        pitLaneTransitS: rb?.pitLaneTransitS ?? null,
      },
      raceDate: axis.raceDate,
      timezone: axis.timezone,
      timeOrigin: axis.timeOriginIso,
      timeOriginSource: axis.originSource,
      scheduledDurationS,
      scheduledLaps: meta.scheduledLaps ?? null,
      chequeredFlag: tp(ctx, chequerT),
      sourceFormat: race.format,
      adapterVersion: race.adapterVersion,
      resultsStatus: results.resultsStatus,
      classes: metadataClasses,
      lexicon: [...lexicon].sort(),
    },
    entries: results.entries,
    laps: lapTable,
    fcyPeriods,
    events: {
      pitPassages,
      pitGroups: groups,
      penalties,
      retirements: results.retirements,
      flags: fcy.flags,
    },
    stints,
    driveTimes,
    pitCycles,
    cycleResults,
    positionChanges,
    ruleChecks: [],
    ruleFindings: [],
    carStories: [],
    raceSummary: null,
    dataQuality,
  };
  return pkg;
}

function dedupeIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const x of issues) {
    const k = `${x.severity}|${x.code}|${x.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  const rank = { blocker: 0, warning: 1, note: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function toPitPassage(ctx: Ctx, p: Passage, entries: RaceAnalysisPackage["entries"]): PitPassage {
  const rows = ctx.laps[p.car] ?? [];
  const drivers = entries.find((e) => e.car === p.car)?.drivers ?? [];
  const drvNum = (num: number | null, name: string | null): number | null => (num !== null ? num : matchDriver(name, drivers));
  const di = drvNum(p.inDriverNumber, p.inDriverName);
  const dout = drvNum(p.outDriverNumber, p.outDriverName);
  const refs = [...p.refs];
  for (const r of passageRows(rows, p)) {
    const ref = `${r.fileId}:L${r.row}`;
    if (!refs.includes(ref)) refs.push(ref);
  }
  const official = p.outcome === "retired" ? null : rd(p.official);
  const out: PitPassage = {
    id: p.id,
    car: p.car,
    ordinal: p.ordinal,
    kind: p.kind,
    kindBasis: p.kindBasis.length ? p.kindBasis : ["default_stop"],
    outcome: p.outcome,
    pitIn: p.pinT !== null && !p.bOnly ? tp(ctx, p.pinT) : null,
    pitOut: p.poutT !== null && !p.bOnly && p.outcome !== "retired" ? tp(ctx, p.poutT) : null,
    inLap: p.inLap,
    inLapCompleted: p.inLapCompleted,
    outLap: p.outLap,
    officialPitLaneTimeS: official,
    fcyContext: p.fcyContext,
    fcyPeriodIds: p.fcyPeriodIds,
    timeLost: p.timeLost,
    stopNumber: p.stopNumber,
    cycleId: p.cycleId,
    driverIn: di,
    driverOut: dout,
    driverChange: di !== null && dout !== null ? di !== dout : null,
    penaltiesServed: p.penaltiesServed,
    lapDown: p.lapDown,
    source: {
      kind: p.source === "pit_json" || p.source === "pdf_card" ? "official" : "derived",
      files: [...new Set([...p.files, ...(rows[0] ? [rows[0].fileId] : [])])],
      refs,
      method: "D-PIT-PASSAGE",
    },
    confidence: p.confidence,
  };
  if (official !== null) out.pitLaneTimeReliable = p.reliable;
  if (p.groupId) out.groupId = p.groupId;
  if (p.positionEffect) out.positionEffect = p.positionEffect;
  const cn = [...new Set(p.confNotes)];
  if (cn.length) out.confidenceNotes = cn;
  if (p.notes.length) out.notes = [...new Set(p.notes)];
  return out;
}

function toLapTable(ctx: Ctx, files: SourceFileInfo[]): LapTable {
  const lapFiles = files.filter((f) => f.role === "laps" || f.role === "time_cards").map((f) => f.fileId);
  const derived = (method: string, extra: string[] = []) => ({ source: { kind: "derived" as const, files: [...lapFiles, ...extra], method }, confidence: "high" as const });
  const official = (method?: string) => ({ source: { kind: "official" as const, files: lapFiles, ...(method ? { method } : {}) }, confidence: "high" as const });
  const cars: Record<string, LapColumns> = {};
  const exceptions: NonNullable<LapTable["exceptions"]> = [];
  const wrl = ctx.race.format === "speedhive" || ctx.race.format === "wrl-website";
  let anyDriver = false;
  let anySpeed = false;
  for (const car of [...Object.keys(ctx.laps)].sort(carOrder)) {
    const rows = ctx.laps[car];
    const cols: LapColumns = {
      lap: rows.map((r) => r.lap),
      lapTimeS: rows.map((r) => rd(r.lapTimeS)),
      endS: rows.map((r) => rd(r.endT - ctx.axis.origin)),
      flag: rows.map((r) => r.flag),
      fcy: rows.map((r) => r.fcy),
      fcyFrac: rows.map((r) => r.fcyFrac),
      pit: rows.map((r) => r.pit),
      pos: rows.map((r) => r.pos),
      cpos: rows.map((r) => r.cpos),
      lapsDown: rows.map((r) => r.lapsDown),
      clean: rows.map((r) => r.clean),
    };
    if (rows.some((r) => r.span > 1)) {
      cols.span = rows.map((r) => r.span);
      for (const r of rows) if (r.span > 1) exceptions.push({ car, lap: r.lap, column: "lapTimeS", confidence: "medium", note: `span row: covers ${r.span} laps (skipped lap numbers)` });
    }
    if (rows.some((r) => r.driver !== null)) {
      cols.driver = rows.map((r) => r.driver);
      anyDriver = true;
    }
    if (!wrl && rows.some((r) => r.speedKph !== null)) {
      cols.speedKph = rows.map((r) => r.speedKph);
      cols.topSpeedKph = rows.map((r) => r.topSpeedKph);
      anySpeed = true;
    }
    cars[car] = cols;
  }
  const columnSources: LapTable["columnSources"] = {
    lap: official(),
    lapTimeS: official("D-LAP"),
    endS: official("D-TIME"),
    flag: official(),
    fcy: derived("D-FCY-LAP"),
    fcyFrac: derived("D-FCY-LAP"),
    pit: derived("D-INLAP"),
    pos: derived("D-POS"),
    cpos: derived("D-POS"),
    lapsDown: derived("D-LAPDOWN"),
    clean: derived("D-REF-PACE"),
  };
  if (anyDriver) {
    columnSources.driver = {
      source: { kind: "official", files: lapFiles, ...(ctx.race.format === "redmist" ? { method: "RFID driver at the line crossing" } : {}) },
      confidence: ctx.race.format === "wrl-website" ? "medium" : "high",
    };
  }
  if (anySpeed) {
    columnSources.speedKph = official();
    columnSources.topSpeedKph = official();
  }
  const out: LapTable = { layout: "columnar-per-car/1", columnSources, cars };
  if (exceptions.length) out.exceptions = exceptions;
  return out;
}

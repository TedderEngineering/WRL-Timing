/**
 * M6 raw passages (D-PIT-PASSAGE, D-INLAP/D-OUTLAP, D-PITLANE), M7 penalty parse and M10 linking
 * (D-PENALTY), M8 transit (D-TRANSIT) and M9 kinds (D-PIT-KIND, D-FCY-STOP, D-STOPNUM).
 */
import type { KindBasis, PassageKind, PenaltyStatus, PenaltyType, PositionEffect, TimeLost } from "../schema/package-types.js";
import type { CanonPitRecord, CarId } from "../types.js";
import { carOrder, median, rd } from "../util.js";
import { lapAt, type Ctx, type LapRow } from "./context.js";
import type { Period } from "./fcy.js";
import { periodIdsTouching } from "./fcy.js";

export interface Passage {
  car: CarId;
  ordinal: number;
  id: string;
  source: "pit_json" | "pdf_card" | "drive_time" | "b_flag" | "pit_column" | "pit_column_inferred";
  files: string[];
  refs: string[];
  /** Official pit-in / pit-out instants (adapter axis); null when the source has none. */
  pinT: number | null;
  poutT: number | null;
  /** Ordering instant: pit-in, the B-flag estimate, or the in-lap start (WRL). */
  sortT: number;
  /** Rejoin instant for cycles and positions: pit-out, the B-flag estimate, or the out-lap end (WRL). */
  rejoinT: number | null;
  official: number | null;
  reliable: boolean;
  inLap: number;
  inLapCompleted: boolean;
  outLap: number | null;
  inIdx: number | null;
  outIdx: number | null;
  /** Last row inside the passage when it never rejoined (WRL: every flagged row of a run that reaches the end). */
  lastIdx?: number;
  bOnly: boolean;
  /** RedMist: a lap-1 pit-report stop whose lap-1 crossing was on track (the car left the pit lane after the start). */
  pitLaneStart?: boolean;
  pitType: "NORMAL" | "PENALTY" | null;
  inDriverNumber: number | null;
  outDriverNumber: number | null;
  inDriverName: string | null;
  outDriverName: string | null;
  outcome: "rejoined" | "retired" | "finished_in_pit_lane";
  kind: PassageKind;
  kindBasis: KindBasis[];
  fcyContext: "green" | "fcy" | "mixed";
  fcyPeriodIds: string[];
  timeLost: TimeLost;
  groupId?: string;
  stopNumber: number | null;
  cycleId: string | null;
  penaltiesServed: string[];
  confidence: "high" | "medium" | "low";
  confNotes: string[];
  notes: string[];
  noLoss: boolean;
  lapDown: boolean | null;
  positionEffect?: PositionEffect;
}

export interface PenaltyDraft {
  id: string;
  car: CarId;
  t: number | null;
  reason: string;
  ptype: PenaltyType;
  amountS: number | null;
  rawText: string;
  files: string[];
  refs: string[];
  servedBy: Passage | null;
  servedMsgT: number | null;
  servedMsgRef: string | null;
  status: PenaltyStatus;
  convertedFromId?: string;
  postRace: boolean;
  confidence: "high" | "medium" | "low";
  confNotes: string[];
}

/* ------------------------------------------------------------------ helpers */

/** Rows of a passage (in-lap … out-lap; a retirement covers its in-lap only). */
export function passageRows(rows: LapRow[], p: Passage): LapRow[] {
  if (p.inIdx === null) return [];
  const hi = p.outIdx ?? p.lastIdx ?? p.inIdx;
  return rows.slice(p.inIdx, hi + 1);
}

function idxOfLap(rows: LapRow[], lap: number | null): number | null {
  if (lap === null) return null;
  const i = rows.findIndex((r) => r.lap === lap);
  return i < 0 ? null : i;
}

function blank(car: CarId): Omit<Passage, "source" | "files" | "refs" | "pinT" | "poutT" | "sortT" | "rejoinT" | "official" | "inLap" | "inLapCompleted" | "outLap" | "inIdx" | "outIdx"> {
  return {
    car,
    ordinal: 0,
    id: "",
    reliable: true,
    bOnly: false,
    pitType: null,
    inDriverNumber: null,
    outDriverNumber: null,
    inDriverName: null,
    outDriverName: null,
    outcome: "rejoined",
    kind: "stop",
    kindBasis: [],
    fcyContext: "green",
    fcyPeriodIds: [],
    timeLost: { valueS: null, method: "none" },
    stopNumber: null,
    cycleId: null,
    penaltiesServed: [],
    confidence: "high",
    confNotes: [],
    notes: [],
    noLoss: false,
    lapDown: null,
  };
}

/* ------------------------------------------------------------------ M6 */

export function buildRawPassages(ctx: Ctx): Passage[] {
  const out: Passage[] = [];
  if (ctx.race.format === "speedhive" || ctx.race.format === "wrl-website") {
    for (const car of ctx.cars) out.push(...wrlPassages(ctx, car));
  } else if (ctx.race.format === "redmist") {
    out.push(...redmistPassages(ctx));
  } else {
    out.push(...alkamelPassages(ctx));
  }
  // ordinals and outcomes
  const byCar = new Map<string, Passage[]>();
  for (const p of out) byCar.set(p.car, [...(byCar.get(p.car) ?? []), p]);
  for (const [car, ps] of byCar) {
    ps.sort((a, b) => a.sortT - b.sortT);
    ps.forEach((p, i) => {
      p.ordinal = i + 1;
      p.id = `pit:${car}:${i + 1}`;
    });
    const rows = ctx.laps[car] ?? [];
    const tookFlag = rows.length > 0 && rows[rows.length - 1].endT >= ctx.chequerT - 1e-6;
    for (const p of ps) {
      if (p.outLap !== null) p.outcome = "rejoined";
      else p.outcome = tookFlag ? "finished_in_pit_lane" : "retired";
    }
  }
  return out.sort((a, b) => carOrder(a.car, b.car) || a.ordinal - b.ordinal);
}

function wrlPassages(ctx: Ctx, car: CarId): Passage[] {
  const rows = ctx.laps[car] ?? [];
  const ww = ctx.race.format === "wrl-website";
  const out: Passage[] = [];
  const mk = (i0: number, i1: number | null, inferred: boolean, last?: number): Passage => {
    const inRow = rows[i0];
    const outRow = i1 === null ? null : rows[i1];
    const refs = rows.slice(i0, (i1 ?? last ?? i0) + 1).map((r) => `${r.fileId}:L${r.row}`);
    const p: Passage = {
      ...blank(car),
      source: inferred ? "pit_column_inferred" : "pit_column",
      files: [inRow.fileId],
      refs,
      pinT: null,
      poutT: null,
      sortT: inRow.startT,
      rejoinT: outRow ? outRow.endT : null,
      official: null,
      inLap: inRow.lap,
      inLapCompleted: true,
      outLap: outRow ? outRow.lap : null,
      inIdx: i0,
      outIdx: i1,
      ...(i1 === null && last !== undefined ? { lastIdx: last } : {}),
    };
    p.reliable = false;
    p.notes.push("No pit-lane timestamps in this format; pit-in/pit-out are unknown and the official pit-lane time is null (D-PITLANE).");
    if (inferred) {
      p.confNotes.push("last_in_pit_inferred");
      p.notes.push("In_Pit not set; the passage is inferred from Last_In_Pit on the out-lap (WN3). In-lap = previous row.");
    }
    if (ww) {
      p.inDriverName = i0 > 0 ? rows[i0 - 1].driverName : null;
      p.outDriverName = i1 !== null && i1 + 1 < rows.length ? rows[i1 + 1].driverName : null;
      p.inDriverNumber = i0 > 0 ? rows[i0 - 1].driver : null;
      p.outDriverNumber = i1 !== null && i1 + 1 < rows.length ? rows[i1 + 1].driver : null;
    }
    return p;
  };
  let k = 0;
  while (k < rows.length) {
    if (rows[k].inPit) {
      let j = k;
      while (j + 1 < rows.length && rows[j + 1].inPit) j++;
      const outI = j + 1 < rows.length ? j + 1 : null;
      out.push(mk(k, outI, false, j));
      k = outI !== null ? outI + 1 : j + 1;
      continue;
    }
    if (ww && rows[k].lastInPit && k > 0) out.push(mk(k - 1, k, true));
    k++;
  }
  return out;
}

type TimedPitRecord = CanonPitRecord & { inClockS: number; extraRefs?: string[]; notes?: string[] };

/** A red-flag hold: from the red flag record to the next flag that restarts the session (FCY, SC or green). */
export interface RedHold {
  start: number;
  end: number;
}

/** Red flags in the flags file, each ending at the next FCY, SC, green or chequered record (else the race end). */
export function redHolds(flagRecords: Ctx["race"]["flagRecords"], raceEndT: number): RedHold[] {
  const recs = [...flagRecords].sort((a, b) => a.tS - b.tS);
  const out: RedHold[] = [];
  for (let i = 0; i < recs.length; i++) {
    const t = recs[i].recType.toUpperCase();
    if (t !== "RF" && t !== "RED") continue;
    if (out.length && recs[i].tS <= out[out.length - 1].end) continue;
    const next = recs.slice(i + 1).find((r) => ["FCY", "SC", "GF", "FF"].includes(r.recType.toUpperCase()));
    out.push({ start: recs[i].tS, end: next ? next.tS : raceEndT });
  }
  return out;
}

/** Seconds of [a, b] inside any hold. */
function secondsInHolds(holds: RedHold[], a: number, b: number): number {
  return holds.reduce((s, h) => s + Math.max(0, Math.min(b, h.end) - Math.max(a, h.start)), 0);
}

function alkamelPassages(ctx: Ctx): Passage[] {
  const recs: TimedPitRecord[] = ctx.race.pitRecords.filter((r): r is TimedPitRecord => r.inClockS !== null).map((r) => ({ ...r }));
  const issues = ctx.issues;
  const holds = redHolds(ctx.race.flagRecords, ctx.raceEndT);
  // Drive Time PIT rows: merge into a card within 1.5 s, else a passage of their own. The Drive Time
  // clock stops during a red flag, so a visit that spans one is split into rows that end when the
  // red flag starts and resume when it ends: those rows join the visit they belong to.
  const pitRows = ctx.race.driveStints.filter((d) => d.type === "PIT" && d.startClockS !== null).sort((a, b) => a.startClockS! - b.startClockS!);
  for (const d of pitRows) {
    const m = recs.find((r) => r.car === d.car && Math.abs(r.inClockS - d.startClockS!) <= 1.5);
    const ref = `${d.fileId}:L${d.row}`;
    const dEnd = d.timeS !== null ? d.startClockS! + d.timeS : d.endClockS;
    if (m) {
      m.pitType = (d.pitType as "NORMAL" | "PENALTY") || null;
      m.driveTimeRef = ref;
      continue;
    }
    // Inside a time card's visit (it starts later than the card's pit-in): the same visit.
    const host = recs.find(
      (r) => r.car === d.car && r.source !== "drive_time" && r.outClockS !== null && r.inClockS < d.startClockS! && d.startClockS! <= r.outClockS + 1.5 && (dEnd === null || dEnd <= r.outClockS + 1.5),
    );
    if (host) {
      (host.extraRefs ??= []).push(ref);
      continue;
    }
    // Starts when a red flag ends and continues a visit that was open when it began (a PIT row that
    // stopped at the red flag, or a card with no pit-out): one visit.
    const hold = holds.find((h) => Math.abs(d.startClockS! - h.end) <= 2);
    const before = hold
      ? recs.find((r) => r.car === d.car && r.inClockS < hold.start && (r.outClockS === null || (r.source === "drive_time" && Math.abs(r.outClockS - hold.start) <= 2)))
      : undefined;
    if (before) {
      if (before.outClockS !== null) {
        before.outClockS = dEnd;
        before.pitTimeS = before.pitTimeS !== null && d.timeS !== null ? before.pitTimeS + d.timeS : null;
      }
      (before.extraRefs ??= []).push(ref);
      (before.notes ??= []).push("Drive Time splits this visit at the red flag; its rows before and after the red flag are joined.");
      continue;
    }
    recs.push({
      car: d.car,
      source: "drive_time",
      fileId: d.fileId,
      ref,
      nr: null,
      inClockS: d.startClockS!,
      outClockS: dEnd,
      pitTimeS: d.timeS,
      pitType: (d.pitType as "NORMAL" | "PENALTY") || null,
      driveTimeRef: ref,
    });
  }
  const out: Passage[] = [];
  const explained = new Map<string, Set<number>>();
  const lastRace = ctx.raceEndT;
  for (const r of recs) {
    const rows = ctx.laps[r.car] ?? [];
    const p: Passage = {
      ...blank(r.car),
      source: r.source,
      files: [r.fileId],
      refs: [r.ref],
      pinT: r.inClockS,
      poutT: r.outClockS,
      sortT: r.inClockS,
      rejoinT: r.outClockS,
      official: r.pitTimeS ?? (r.outClockS !== null ? r.outClockS - r.inClockS : null),
      inLap: 1,
      inLapCompleted: false,
      outLap: null,
      inIdx: null,
      outIdx: null,
      pitType: r.pitType ?? null,
      inDriverNumber: r.inDriverNumber ?? null,
      outDriverNumber: r.outDriverNumber ?? null,
      inDriverName: r.inDriver ?? null,
      outDriverName: r.outDriver ?? null,
    };
    if (r.driveTimeRef && r.source !== "drive_time") {
      p.files.push(r.driveTimeRef.split(":")[0]);
      p.refs.push(r.driveTimeRef);
    }
    for (const x of r.extraRefs ?? []) {
      if (!p.files.includes(x.split(":")[0])) p.files.push(x.split(":")[0]);
      p.refs.push(x);
    }
    p.notes.push(...(r.notes ?? []));
    if (rows.length === 0) {
      p.notes.push("The car has no laps in the laps file (DNS or did not complete lap 1).");
      p.confNotes.push("in_lap_not_completed");
      out.push(p);
      continue;
    }
    // in-lap (D-INLAP), with the AO2 override: a card in-time equal to a line crossing while the B flag is on the next lap.
    let inRow = lapAt(rows, r.inClockS);
    if (inRow && !inRow.crossedInPit && inRow.idx + 1 < rows.length && rows[inRow.idx + 1].crossedInPit && Math.abs(inRow.endT - r.inClockS) < 0.05) {
      inRow = rows[inRow.idx + 1];
      p.reliable = false;
      p.confNotes.push("in_lap_from_b_flag");
      p.notes.push("Card in-time equals a line crossing; the in-lap is the in-pit crossing on the next lap and the card pit-lane time includes about one lap (AO2).");
    }
    if (inRow) {
      p.inIdx = inRow.idx;
      p.inLap = inRow.lap;
      p.inLapCompleted = true;
      if (!explained.has(r.car)) explained.set(r.car, new Set());
      explained.get(r.car)!.add(inRow.idx);
    } else {
      p.inLap = rows[rows.length - 1].lap + 1;
      p.inLapCompleted = false;
      p.confNotes.push("in_lap_not_completed");
    }
    const outRow = r.outClockS !== null ? lapAt(rows, r.outClockS) : null;
    if (outRow && p.inIdx !== null && outRow.idx >= p.inIdx) {
      p.outIdx = outRow.idx;
      p.outLap = outRow.lap;
    }
    if (r.source === "drive_time" && p.outLap === null) {
      p.confNotes.push("pit_out_is_session_end");
      p.notes.push("Drive Time PIT stint runs to the end of the session; the car did not rejoin.");
    }
    out.push(p);
  }
  // B-flag crossings that no official record explains (AO1, AO4).
  for (const car of ctx.cars) {
    const rows = ctx.laps[car] ?? [];
    for (const row of rows) {
      if (!row.crossedInPit) continue;
      if (explained.get(car)?.has(row.idx)) continue;
      const last = row.idx === rows.length - 1;
      const pinEst = row.endT - 1.0;
      const poutEst = last ? lastRace : row.endT + 0.5;
      const outRow = last ? null : lapAt(rows, poutEst);
      const p: Passage = {
        ...blank(car),
        source: "b_flag",
        files: [row.fileId],
        refs: [`${row.fileId}:L${row.row}`],
        pinT: null,
        poutT: null,
        sortT: pinEst,
        rejoinT: last ? null : poutEst,
        official: null,
        inLap: row.lap,
        inLapCompleted: true,
        outLap: outRow ? outRow.lap : null,
        inIdx: row.idx,
        outIdx: outRow ? outRow.idx : null,
        bOnly: true,
      };
      p.reliable = false;
      p.confNotes.push("no_time_card");
      p.notes.push(
        last
          ? "In-pit line crossing on the car's last lap with no time card: the car entered the pit lane and did not rejoin."
          : "In-pit line crossing (CROSSING_FINISH_LINE_IN_PIT) with no time card: pit-in and pit-lane time are unknown.",
      );
      out.push(p);
    }
  }
  if (out.some((p) => p.source === "b_flag")) {
    issues.push({ severity: "note", code: "PASSAGE-FROM-B-FLAG", message: "Some passages come only from the in-pit line-crossing flag (no time card); their pit-lane time is null." });
  }
  return out;
}

/* ------------------------------------------------------------------ RedMist passages */

/** A pit visit read from RedMist's lap pit flags: rows i0 (in-lap) … i1 (out-lap; null = never rejoined, last = last row inside). */
export interface FlagVisit {
  i0: number;
  i1: number | null;
  last: number;
  /** The pit flag sat on the lap after the visit (see redmistFlagVisits). */
  lateFlag?: boolean;
  /** The pit flags stayed set after the car rejoined at racing pace (ignored from the out-lap on). */
  stuckFlags?: boolean;
}

/**
 * RedMist lap pit flags → pit visits. `inPit` = LapIncludedPit (the car was seen in the pit lane during
 * the lap), `crossedInPit` = IsInPit at the line crossing. A visit opens on the first flagged lap and
 * stays open while the car crosses the line in the pit lane; the first crossing made on track is the
 * out-lap (PitStopAnalyzer's rule). A lone LapIncludedPit lap whose crossings on both sides were made
 * on track is a pit flag that landed one lap late (RedMist tags the lap in progress when the pit
 * passing is processed): the visit is the previous lap (in-lap) and the flagged lap (out-lap). On
 * Barber 2026 all 7 such laps sit one lap after Speedhive's In Pit lap; on West Desert 2026 the one
 * case follows a pit-report stop on the previous lap. A lap-1 flag with a crossing on track is
 * pre-race pit-lane staging, not a passage.
 */
/**
 * A lap at racing pace: within RACING_PACE of the car's median lap. A car cannot cross the line in
 * the pit lane on two laps running at that pace, so such a lap's pit flag is stuck (Sebring Sunday
 * 2026, #48: "in pit lane at the line" set from lap 88 to 137 while it lapped at 2:32).
 */
export const RACING_PACE = 1.05;

/** A pit-report row with no lap pit flag and under this many seconds in the pit lane is not a stop. */
export const PHANTOM_STOP_S = 10;

function racingPace(rows: LapRow[]): (i: number) => boolean {
  const xs = rows
    .map((r) => r.lapTimeS)
    .filter((v): v is number => typeof v === "number" && v > 0)
    .sort((a, b) => a - b);
  if (!xs.length) return () => false;
  const med = xs[Math.floor(xs.length / 2)];
  return (i) => {
    const v = rows[i]?.lapTimeS;
    return typeof v === "number" && v > 0 && v <= med * RACING_PACE;
  };
}

export function redmistFlagVisits(rows: LapRow[]): FlagVisit[] {
  const n = rows.length;
  const racing = racingPace(rows);
  const flagged = (i: number) => (rows[i].inPit || rows[i].crossedInPit) && !(i === 0 && rows[0].lap === 1 && !rows[0].crossedInPit);
  const out: FlagVisit[] = [];
  let k = 0;
  let lastEnd = -1;
  while (k < n) {
    if (!flagged(k)) {
      k++;
      continue;
    }
    const i0 = k;
    if (!rows[i0].crossedInPit && i0 - 1 > lastEnd && !flagged(i0 - 1) && !(i0 - 1 === 0 && rows[0].lap === 1)) {
      out.push({ i0: i0 - 1, i1: i0, last: i0, lateFlag: true });
      lastEnd = i0;
      k = i0 + 1;
      continue;
    }
    let j = k;
    while (rows[j].crossedInPit && j + 1 < n && !(j > i0 && racing(j + 1))) j++;
    if (rows[j].crossedInPit && j > i0 && j + 1 < n && racing(j + 1)) {
      // The next lap is at racing pace: the car was back on track; its pit flags from here are stuck.
      out.push({ i0, i1: j, last: j, stuckFlags: true });
      lastEnd = j;
      k = j + 1;
      while (k < n && flagged(k) && racing(k)) k++;
      continue;
    }
    if (rows[j].crossedInPit) {
      out.push({ i0, i1: null, last: j });
      break;
    }
    if (j > i0) {
      out.push({ i0, i1: j, last: j });
      lastEnd = j;
      k = j + 1;
    } else if (i0 + 1 < n && !flagged(i0 + 1)) {
      out.push({ i0, i1: i0 + 1, last: i0 + 1 });
      lastEnd = i0 + 1;
      k = i0 + 2;
    } else {
      out.push({ i0, i1: i0, last: i0 });
      lastEnd = i0;
      k = i0 + 1;
    }
  }
  return out;
}

function lapRange(p: { inIdx: number | null; outIdx: number | null; lastIdx?: number }): [number, number] | null {
  if (p.inIdx === null) return null;
  return [p.inIdx, p.outIdx ?? p.lastIdx ?? p.inIdx];
}

/**
 * D-PIT-PASSAGE for RedMist. With the pit report (Flagtronics): one passage per reported stop, laps
 * from startLap (in-lap) / endLap (out-lap), cross-checked with the lap pit flags; the official
 * pit-lane time is the reported duration; pit-in / pit-out when the equipment clock was set. Lap-flag
 * visits that no reported stop covers are added as passages without a pit-lane time. Without the
 * report: lap-flag visits only (no pit-lane times), as Speedhive.
 */
function redmistPassages(ctx: Ctx): Passage[] {
  const out: Passage[] = [];
  const reportFile = ctx.race.files.find((f) => f.role === "pit_cards_json") ?? null;
  const byCar = new Map<string, CanonPitRecord[]>();
  for (const r of ctx.race.pitRecords) if (r.source === "pit_json") byCar.set(r.car, [...(byCar.get(r.car) ?? []), r]);
  const corrected: string[] = [];
  const noFlags: string[] = [];
  const phantom: string[] = [];
  const extra: string[] = [];
  const clockOff: string[] = [];
  const staging: string[] = [];
  for (const car of ctx.cars) {
    const rows = ctx.laps[car] ?? [];
    const racing = racingPace(rows);
    const n = rows.length;
    const mine: Passage[] = [];
    const recs = [...(byCar.get(car) ?? [])].sort((a, b) => (a.inLap ?? 0) - (b.inLap ?? 0) || (a.nr ?? 0) - (b.nr ?? 0));
    let prevEnd = -1;
    recs.forEach((r, k) => {
      const lapLabel = `${car} L${r.inLap ?? "?"}-${r.outLap ?? "?"}`;
      const p: Passage = {
        ...blank(car),
        source: "pit_json",
        files: [r.fileId],
        refs: [r.ref],
        pinT: r.inClockS,
        poutT: r.inClockS !== null ? r.outClockS : null,
        sortT: r.inClockS ?? 0,
        rejoinT: r.inClockS !== null ? r.outClockS : null,
        official: r.pitTimeS,
        inLap: r.inLap ?? 1,
        inLapCompleted: false,
        outLap: null,
        inIdx: null,
        outIdx: null,
        inDriverName: r.inDriver ?? null,
        outDriverName: r.outDriver ?? null,
      };
      if (r.inClockS !== null) {
        p.notes.push("Pit-in and pit-out from the RedMist pit report (Flagtronics): entry clock to the second, pit-lane time to the millisecond.");
      } else if (r.pitTimeS !== null) {
        p.notes.push(
          r.timePrecision === "s"
            ? "Pit-lane time from the RedMist pit report without an entry clock (in-car equipment clock not set): whole seconds; pit-in and pit-out are unknown."
            : "Pit-lane time from the RedMist pit report without an entry clock; pit-in and pit-out are unknown.",
        );
      } else {
        p.reliable = false;
        p.notes.push("The RedMist pit report lists this stop without a duration (exit never finalised); the pit-lane time is unknown.");
      }
      if (r.entryRenumbered) {
        p.reliable = false;
        p.confNotes.push("pit_entry_renumbered");
        p.notes.push(
          `The in-car equipment reissued the pit entry time during this stop; the reported pit-lane time may cover only part of the stop.${
            r.estimatedVisitS ? ` From the first to the last entry time on the lap records the visit lasted about ${rd(r.estimatedVisitS, 0)} s (estimate).` : ""
          }`,
        );
      }
      if (!n) {
        p.notes.push("The car has no laps in the laps file.");
        p.confNotes.push("in_lap_not_completed");
        mine.push(p);
        return;
      }
      let inIdx = idxOfLap(rows, r.inLap ?? null);
      if (inIdx === null) {
        const after = rows.findIndex((x) => x.lap >= (r.inLap ?? 0));
        if (after < 0) {
          p.inLap = rows[n - 1].lap + 1;
          p.confNotes.push("in_lap_not_completed");
          p.notes.push(`The reported in-lap ${r.inLap} is after the car's last lap row.`);
          mine.push(p);
          return;
        }
        inIdx = after;
        corrected.push(`${lapLabel}: in-lap row missing, lap ${rows[after].lap} used`);
      }
      const next = recs[k + 1];
      const nextIn = next ? (idxOfLap(rows, next.inLap ?? null) ?? n) : n;
      let outIdx: number | null = idxOfLap(rows, r.outLap ?? null) ?? inIdx;
      if (outIdx < inIdx) outIdx = inIdx;
      let lastIdx: number | undefined;
      // (a) the car was already in the pit lane at the previous crossing: the visit began a lap earlier.
      // Not across laps at racing pace: those flags are stuck (see d).
      while (inIdx - 1 > prevEnd && rows[inIdx - 1].crossedInPit && !racing(inIdx - 1)) inIdx--;
      // (b) the reported out-lap was itself crossed in the pit lane: the car rejoined later, or never.
      if (rows[outIdx].crossedInPit) {
        let j = outIdx;
        while (rows[j].crossedInPit && j + 1 < n && j + 1 < nextIn) j++;
        if (rows[j].crossedInPit && j === n - 1) {
          outIdx = null;
          lastIdx = j;
        } else outIdx = j;
      }
      // (c) a one-lap report stop whose next lap carries the pit flag: that lap is the out-lap. When the
      // next reported stop starts there (the equipment split one visit), the two form a pit group (D-PITGROUP).
      if (outIdx !== null && outIdx === inIdx && inIdx + 1 < n && rows[inIdx + 1].inPit) outIdx = inIdx + 1;
      // (d) The pit flags, and the report's laps, can stay set after the car rejoined (Sebring Sunday
      // 2026, #48: laps 87-138 at 2:32): no visit runs on past a lap followed by one at racing pace.
      {
        const end = outIdx ?? lastIdx ?? inIdx;
        for (let j = inIdx + 1; j < end; j++) {
          if (racing(j + 1)) {
            outIdx = j;
            lastIdx = undefined;
            p.confNotes.push("pit_flags_stuck");
            break;
          }
        }
      }
      p.inIdx = inIdx;
      p.outIdx = outIdx;
      if (lastIdx !== undefined) p.lastIdx = lastIdx;
      // A lap-1 stop with the lap-1 crossing on track: the car sat in the pit lane before the start and
      // joined after it. The reported duration is the pre-start wait, not a race pit-lane time.
      if (inIdx === 0 && rows[0].lap === 1 && !rows[0].crossedInPit && outIdx === 0) {
        p.pitLaneStart = true;
        p.notes.push(`Pit-lane start: the car was in the pit lane at the start and joined during lap 1; the reported ${r.pitTimeS !== null ? `${rd(r.pitTimeS, 0)} s ` : ""}is the time spent in the pit lane before it left, not a race pit-lane time.`);
        p.official = null;
        p.reliable = true;
        p.rejoinT = rows[0].startT;
        if (p.pinT === null) p.sortT = rows[0].startT;
      }
      p.inLap = rows[inIdx].lap;
      p.inLapCompleted = true;
      p.outLap = outIdx !== null ? rows[outIdx].lap : null;
      if (p.pinT === null) p.sortT = rows[inIdx].startT;
      if (p.rejoinT === null && outIdx !== null) p.rejoinT = rows[outIdx].endT;
      if (p.inLap !== r.inLap || p.outLap !== (r.outLap ?? null)) {
        p.confNotes.push("pit_report_laps_corrected");
        p.notes.push(
          `The pit report gives laps ${r.inLap ?? "?"}-${r.outLap ?? "?"}; the lap pit flags (in pit lane at the line) give ${p.inLap}-${p.outLap ?? "no rejoin"}, which is used.`,
        );
        corrected.push(`${car} L${r.inLap}-${r.outLap} → L${p.inLap}-${p.outLap ?? "none"}`);
      }
      const range = lapRange(p)!;
      if (!rows.slice(range[0], range[1] + 1).some((x) => x.inPit || x.crossedInPit)) {
        // No lap pit flag and only a few seconds in the pit lane: not a visit (no car passes through a
        // pit lane that fast). The report repeats such rows (Sebring 2026: #120 laps 8, 9, 17, 22, 5 s).
        if (r.pitTimeS !== null && r.pitTimeS < PHANTOM_STOP_S) {
          phantom.push(`${car} L${p.inLap} (${rd(r.pitTimeS, 0)} s)`);
          return;
        }
        noFlags.push(`${car} L${p.inLap}`);
      }
      // Pit-report clocks against the lap axis (in-lap must contain pit-in; pit-out before the out-lap ends).
      if (p.pinT !== null) {
        const a = rows[range[0]].startT;
        const b = rows[range[1]].endT;
        const offIn = p.pinT < a - 30 ? p.pinT - a : p.pinT > rows[range[0]].endT + 30 ? p.pinT - rows[range[0]].endT : 0;
        const offOut = p.poutT !== null && p.poutT > b + 30 ? p.poutT - b : 0;
        if (offIn || offOut) {
          clockOff.push(`${car} L${p.inLap} (${offIn ? `pit-in ${rd(offIn, 1)} s outside the in-lap` : `pit-out ${rd(offOut, 1)} s after the out-lap`})`);
          p.confNotes.push("pit_clock_lap_mismatch");
        }
      }
      // A pit-lane time longer than the whole passage is impossible.
      if (p.official !== null) {
        const el = rows[range[1]].endT - rows[range[0]].startT;
        if (p.official > el + 1) {
          p.reliable = false;
          p.confNotes.push("pit_lane_time_exceeds_passage");
          p.notes.push(`The reported pit-lane time (${rd(p.official, 3)} s) is longer than the passage laps (${rd(el, 3)} s); it is not reliable.`);
        }
      }
      prevEnd = range[1];
      mine.push(p);
    });
    if (n && rows[0].lap === 1 && rows[0].inPit && !rows[0].crossedInPit && !mine.some((p) => p.inIdx === 0)) staging.push(car);
    // Lap-flag visits the report does not cover (or all of them, without a report).
    const claimed = mine.map(lapRange).filter((x): x is [number, number] => x !== null);
    for (const v of redmistFlagVisits(rows)) {
      const hi = v.i1 ?? v.last;
      if (claimed.some(([a, b]) => v.i0 <= b && hi >= a)) continue;
      const inRow = rows[v.i0];
      const outRow = v.i1 === null ? null : rows[v.i1];
      const p: Passage = {
        ...blank(car),
        source: "pit_column",
        files: [inRow.fileId],
        refs: rows.slice(v.i0, hi + 1).map((x) => `${x.fileId}:L${x.row}`),
        pinT: null,
        poutT: null,
        sortT: inRow.startT,
        rejoinT: outRow ? outRow.endT : null,
        official: null,
        inLap: inRow.lap,
        inLapCompleted: true,
        outLap: outRow ? outRow.lap : null,
        inIdx: v.i0,
        outIdx: v.i1,
        ...(v.i1 === null ? { lastIdx: v.last } : {}),
        inDriverName: v.i0 > 0 ? rows[v.i0 - 1].driverName : inRow.driverName,
        outDriverName: (v.i1 !== null && v.i1 + 1 < n ? rows[v.i1 + 1] : rows[hi]).driverName,
        inDriverNumber: v.i0 > 0 ? rows[v.i0 - 1].driver : inRow.driver,
        outDriverNumber: (v.i1 !== null && v.i1 + 1 < n ? rows[v.i1 + 1] : rows[hi]).driver,
      };
      p.reliable = false;
      if (v.lateFlag) {
        p.confNotes.push("pit_flag_lap_late");
        p.notes.push(`Only lap ${outRow!.lap} carries the pit flag and both its crossings were on track: the flag landed one lap late, so the in-lap is lap ${inRow.lap}.`);
      }
      if (reportFile) {
        p.confNotes.push("not_in_pit_report");
        p.notes.push("RedMist lap pit flags show a pit visit that the pit report does not list; pit-in, pit-out and the pit-lane time are unknown.");
        extra.push(`${car} L${p.inLap}-${p.outLap ?? "none"}`);
      } else {
        p.notes.push("No pit report: the passage comes from RedMist's lap pit flags (lap included a pit visit / in pit lane at the line); pit-in, pit-out and the official pit-lane time are unknown (D-PITLANE).");
      }
      mine.push(p);
    }
    out.push(...mine);
  }
  const list = (xs: string[]) => `${xs.slice(0, 12).join("; ")}${xs.length > 12 ? `; … (${xs.length} in all)` : ""}`;
  const files = reportFile ? [reportFile.fileId] : [];
  if (!reportFile) {
    ctx.issues.push({ severity: "note", code: "REDMIST-NO-PIT-REPORT", message: "No RedMist pit report (no Flagtronics pit data): passages come from the lap pit flags only, with no pit-in/pit-out and no official pit-lane time; time lost is still measured over the in-lap and out-lap." });
  }
  if (corrected.length) ctx.issues.push({ severity: "note", code: "PIT-REPORT-LAPS-CORRECTED", message: `${corrected.length} pit-report stop(s) re-anchored on the lap pit flags: ${list(corrected)}.`, files });
  if (phantom.length) ctx.issues.push({ severity: "note", code: "PIT-REPORT-PHANTOM", message: `${phantom.length} pit-report row(s) with no lap pit flag and under ${PHANTOM_STOP_S} s in the pit lane are not counted as stops: ${list(phantom)}.`, files });
  if (noFlags.length) ctx.issues.push({ severity: "note", code: "PIT-REPORT-NO-LAP-FLAG", message: `${noFlags.length} pit-report stop(s) have no lap pit flag on their laps: ${list(noFlags)}.`, files });
  if (extra.length) ctx.issues.push({ severity: "warning", code: "PASSAGE-NOT-IN-PIT-REPORT", message: `${extra.length} pit visit(s) seen in the lap pit flags are missing from the pit report (no pit-lane time): ${list(extra)}.`, files });
  if (clockOff.length) ctx.issues.push({ severity: "warning", code: "PIT-CLOCK-LAP-MISMATCH", message: `${clockOff.length} pit-report clock(s) do not fit the passage laps by more than 30 s: ${list(clockOff)}.`, files });
  if (staging.length) ctx.issues.push({ severity: "note", code: "REDMIST-LAP1-PIT-FLAG", message: `Lap 1 carries the pit flag with a crossing on track for ${staging.length} car(s) (${staging.join(", ")}): pre-race pit-lane staging or a pit-lane start; not counted as a passage.` });
  return out;
}

/* ------------------------------------------------------------------ M7 penalties */

const PEN_RE = /^Car\s+#?(\w+):\s*Penalty\s*-\s*(.+?)\s+-\s+(.+)$/i;
const MULTI_PEN_RE = /^Cars\s+(#?\w+(?:\s*(?:,|&|and)\s*#?\w+)+):\s*Penalty\s*-\s*(.+?)\s+-\s+(.+)$/i;
const SERVED_RE = /^Car\s+#?(\w+):\s*Penalty(\s*#\d+)?\s+Served$/i;
const POST_RE = /^Car\s+#?(\w+)\s*-\s*([0-9.]+)\s*second[s]?\s+(?:post[- ]race\s+)?(?:time|drive[- ]through)\s+penalty\s+for\s+(.+)$/i;
/** "Car #45 - Moved to the back of the field as per Penalty …": a post-race position penalty. */
const BACK_RE = /^Car\s+#?(\w+)\s*-\s*(moved to the (?:back|rear) of (?:the|its) (?:field|class)\b.*)$/i;

export function penaltyType(decision: string): { type: PenaltyType; amount: number | null } {
  const d = decision.trim();
  const num = (re: RegExp) => {
    const m = d.match(re);
    return m ? Number(m[1]) : null;
  };
  if (/warning/i.test(d)) return { type: "warning", amount: null };
  if (/post[- ]race/i.test(d)) return { type: "post_race_time", amount: num(/([0-9.]+)\s*sec/i) };
  if (/drive[ -]?through/i.test(d)) return { type: "drive_through", amount: null };
  if (/stop\s*(and|&|-)\s*go/i.test(d)) return { type: "stop_and_go", amount: null };
  if (/stop\s*(\+|plus)\s*\d+/i.test(d)) return { type: "stop_plus", amount: num(/stop\s*(?:\+|plus)\s*([0-9.]+)/i) };
  if (/stop\s+and\s+hold/i.test(d)) return { type: "stop_plus", amount: num(/([0-9.]+)/) };
  if (/time penalty.*(next eligible|stop)/i.test(d)) return { type: "time_at_stop", amount: num(/([0-9.]+)\s*sec/i) };
  // A black flag calls the car in (WRL: "TEAM REQUEST BLACK FLAG" is the team asking for it); only
  // the word disqualification makes it one.
  if (/disqualif|\bdsq\b/i.test(d)) return { type: "disqualification", amount: null };
  if (/black flag/i.test(d)) return { type: "other", amount: null };
  if (/grid/i.test(d)) return { type: "grid", amount: null };
  if (/position/i.test(d)) return { type: "position", amount: null };
  if (/\blaps?\b/i.test(d) && !/lap time/i.test(d)) return { type: "lap", amount: null };
  return { type: "other", amount: null };
}

/** Match a race-control car token to an entry (D-CAR): exact string, else unique after removing '#' and case. */
export function matchCar(token: string, cars: CarId[]): { car: CarId | null; ambiguous: boolean } {
  if (cars.includes(token)) return { car: token, ambiguous: false };
  const t = token.replace(/^#/, "").toLowerCase();
  const hits = cars.filter((c) => c.toLowerCase() === t);
  if (hits.length === 1) return { car: hits[0], ambiguous: false };
  return { car: null, ambiguous: hits.length > 1 };
}

export interface ServedMsg {
  car: CarId;
  t: number;
  ref: string;
  used: boolean;
}

export function parsePenalties(ctx: Ctx): { penalties: PenaltyDraft[]; served: ServedMsg[] } {
  const penalties: PenaltyDraft[] = [];
  const served: ServedMsg[] = [];
  const count = new Map<string, number>();
  // "Cars 1, 40 & 41: Penalty - … - …" is one penalty per car.
  const msgs = [...ctx.race.raceControl]
    .sort((a, b) => (a.tS ?? 0) - (b.tS ?? 0) || a.row - b.row)
    .flatMap((m) => {
      const mm = m.text.trim().match(MULTI_PEN_RE);
      if (!mm) return [m];
      const cars = mm[1].split(/\s*(?:,|&|\band\b)\s*/i).map((x) => x.replace(/^#/, "").trim()).filter(Boolean);
      return cars.map((c) => ({ ...m, text: `Car ${c}: Penalty - ${mm[2]} - ${mm[3]}` }));
    });
  const nextId = (car: string) => {
    const n = (count.get(car) ?? 0) + 1;
    count.set(car, n);
    return `pen:${car}:${n}`;
  };
  for (const m of msgs) {
    const text = m.text.trim();
    const pm = text.match(PEN_RE);
    if (pm) {
      const { car, ambiguous } = matchCar(pm[1], ctx.cars);
      if (!car) {
        ctx.issues.push({ severity: "warning", code: "RC-CAR-AMBIGUOUS", message: `Race-control message '${text}' names car '${pm[1]}', which ${ambiguous ? "matches more than one entry" : "is not an entry"}; it is attached to no car.`, files: [m.fileId] });
        continue;
      }
      // The same message repeated within a minute is one penalty (race control re-sent it).
      const prev = [...penalties].reverse().find((x) => x.car === car && !x.postRace);
      if (prev && prev.rawText === text && prev.t !== null && m.tS !== null && m.tS - prev.t <= 60) {
        prev.refs.push(`${m.fileId}:L${m.row}`);
        ctx.issues.push({ severity: "note", code: "RC-PENALTY-REPEATED", message: `Race control sent '${text}' twice (${prev.refs.join(", ")}); it is read as one penalty.`, factIds: [prev.id], files: [m.fileId] });
        continue;
      }
      const { type, amount } = penaltyType(pm[3]);
      penalties.push({
        id: nextId(car),
        car,
        t: m.tS,
        reason: pm[2].trim(),
        ptype: type,
        amountS: amount,
        rawText: text,
        files: [m.fileId],
        refs: [`${m.fileId}:L${m.row}`],
        servedBy: null,
        servedMsgT: null,
        servedMsgRef: null,
        status: "issued",
        postRace: type === "post_race_time",
        confidence: "high",
        confNotes: [],
      });
      continue;
    }
    const sm = text.match(SERVED_RE);
    if (sm && m.tS !== null) {
      const { car } = matchCar(sm[1], ctx.cars);
      if (car) served.push({ car, t: m.tS, ref: `${m.fileId}:L${m.row}`, used: false });
    }
  }
  // Post-race decisions printed in the results (IMSA session.report_message).
  for (const line of ctx.race.results?.postRaceLines ?? []) {
    const back = line.text.match(BACK_RE);
    if (back) {
      const { car } = matchCar(back[1], ctx.cars);
      if (car) {
        penalties.push({
          id: nextId(car),
          car,
          t: null,
          reason: back[2].trim(),
          ptype: "position",
          amountS: null,
          rawText: line.text,
          files: [line.fileId],
          refs: [`${line.fileId}:session.report_message`],
          servedBy: null,
          servedMsgT: null,
          servedMsgRef: null,
          status: "applied_post_race",
          postRace: true,
          confidence: "high",
          confNotes: [],
        });
      }
      continue;
    }
    const m = line.text.match(POST_RE);
    if (!m) continue;
    const { car } = matchCar(m[1], ctx.cars);
    if (!car) {
      ctx.issues.push({ severity: "warning", code: "RC-CAR-AMBIGUOUS", message: `Results post-race line '${line.text}' names car '${m[1]}', not matched to one entry.`, files: [line.fileId] });
      continue;
    }
    penalties.push({
      id: nextId(car),
      car,
      t: null,
      reason: m[3].trim(),
      ptype: "post_race_time",
      amountS: Number(m[2]),
      rawText: line.text,
      files: [line.fileId],
      refs: [`${line.fileId}:session.report_message`],
      servedBy: null,
      servedMsgT: null,
      servedMsgRef: null,
      status: "applied_post_race",
      postRace: true,
      confidence: "high",
      confNotes: [],
    });
  }
  return { penalties, served };
}

/* ------------------------------------------------------------------ M8 transit */

export interface Transit {
  valueS: number | null;
  estimated: boolean;
  valid: boolean;
  fromPassageId: string | null;
}

export function estimateTransit(passages: Passage[], configured: number | null | undefined, laps: Ctx["laps"]): Transit {
  if (configured !== null && configured !== undefined) return { valueS: configured, estimated: false, valid: true, fromPassageId: null };
  const pls = passages.filter((p) => p.official !== null && p.reliable && !p.bOnly && !isPitLaneStart(p, laps) && p.outLap !== null);
  if (!pls.length) return { valueS: null, estimated: true, valid: false, fromPassageId: null };
  const best = pls.reduce((a, b) => (b.official! < a.official! ? b : a));
  const med = median(pls.map((p) => p.official!))!;
  return { valueS: best.official, estimated: true, valid: best.official! <= 0.75 * med, fromPassageId: best.id };
}

export function isPitLaneStart(p: Passage, laps: Ctx["laps"]): boolean {
  if (p.pitLaneStart) return true;
  if (p.pinT === null || p.bOnly) return false;
  const rows = laps[p.car] ?? [];
  const l1 = rows.find((r) => r.lap === 1);
  return !!l1 && p.pinT <= l1.startT + 2.0;
}

/* ------------------------------------------------------------------ M9 + M10 (Alkamel kinds and penalty links) */

/**
 * Green-flag seconds between race times a and b: the time minus caution and red-flag periods, when
 * the pit lane is closed or the race neutralised and a penalty can't be served.
 */
export function greenSecondsBetween(periods: { start: number; end: number }[], a: number, b: number): number {
  if (b <= a) return 0;
  const spans = periods
    .map((x) => [Math.max(a, x.start), Math.min(b, x.end)] as [number, number])
    .filter(([lo, hi]) => hi > lo)
    .sort((x, y) => x[0] - y[0]);
  let neutral = 0;
  let upTo = a;
  for (const [lo, hi] of spans) {
    const from = Math.max(lo, upTo);
    if (hi > from) neutral += hi - from;
    upTo = Math.max(upTo, hi);
  }
  return b - a - neutral;
}

/**
 * A drive-through served just before race control's message appears (the team is told on the
 * radio first): linked only when nothing else explains the short visit (D-PENALTY).
 */
export const SERVED_BEFORE_MESSAGE_S = 120;

/**
 * RedMist: when the in-car equipment reissued the pit entry during a visit, the reported time is
 * only the last entry to the exit. A segment this short, after race control issued a drive-through,
 * is that drive-through, served in the same visit as the stop (Sebring 2026 #696, lap 128).
 */
export const REISSUED_DT_SEGMENT_MAX_S = 45;

export function classifyAlkamel(ctx: Ctx, passages: Passage[], pens: PenaltyDraft[], transit: Transit, garageS: number, serveWindowS: number, periods: { start: number; end: number }[] = []): void {
  const T = transit.valueS;
  const holds = redHolds(ctx.race.flagRecords, ctx.raceEndT);
  const sorted = [...passages].sort((a, b) => a.sortT - b.sortT || carOrder(a.car, b.car));
  for (const p of sorted) {
    // RedMist: a duration the report itself flags as partial (entry reissued) is not used for kinds.
    const pl = ctx.race.format === "redmist" && !p.reliable ? null : p.official;
    const pin = p.pinT ?? p.sortT;
    const set = (kind: PassageKind, basis: KindBasis[]) => {
      p.kind = kind;
      p.kindBasis = basis;
    };
    if (isPitLaneStart(p, ctx.laps)) {
      set("pit_lane_start", ["pit_lane_start_time"]);
      continue;
    }
    if (p.outcome === "retired") {
      set("retirement", ["no_later_lap"]);
      continue;
    }
    // Cars called into the pit lane by a red flag wait there until the restart: most of the visit
    // falls inside the red flag. It is not a pit stop (no stop number, no time lost, no pit cycle).
    if (holds.length && p.pinT !== null && p.poutT !== null && !p.bOnly && p.poutT > p.pinT && secondsInHolds(holds, p.pinT, p.poutT) >= 0.5 * (p.poutT - p.pinT)) {
      set("red_flag_hold", ["red_flag_period"]);
      p.notes.push("Held in the pit lane during the red flag; not a pit stop.");
      continue;
    }
    if (p.outcome === "finished_in_pit_lane") {
      set("stop", ["default_stop"]);
      p.notes.push("The car's last crossing (the chequered flag) was made in the pit lane.");
      continue;
    }
    // The serve window counts green-flag time on track only: the pit lane is closed under caution,
    // and a car in the garage can't serve (its own earlier visits are taken out too).
    const ownVisits = passages
      .filter((q) => q.car === p.car && q !== p && q.pinT !== null && q.poutT !== null && q.poutT <= pin)
      .map((q) => ({ start: q.pinT!, end: q.poutT! }));
    const neutral = [...periods, ...ownVisits];
    const cand = pens
      .filter((x) => x.car === p.car && !x.servedBy && x.t !== null && x.t <= pin && greenSecondsBetween(neutral, x.t, pin) <= serveWindowS)
      .sort((a, b) => a.t! - b.t!);
    const short = pl !== null && T !== null && pl <= 1.15 * T;
    // A visit with no penalty before it, and a penalty of its kind announced just after it (the
    // team is told before the message appears): a drive-through for a short visit, a stop penalty
    // for a longer one.
    const early =
      !cand.length && p.pitType !== "PENALTY"
        ? pens.find(
            (x) =>
              x.car === p.car &&
              !x.servedBy &&
              x.t !== null &&
              x.t > pin &&
              x.t - pin <= SERVED_BEFORE_MESSAGE_S &&
              ((x.ptype === "drive_through" && short) || ((x.ptype === "stop_plus" || x.ptype === "stop_and_go") && pl !== null && !short))
          )
        : undefined;
    if (early) {
      cand.push(early);
      early.confidence = "medium";
      early.confNotes.push("served_before_message");
      p.confNotes.push("served_before_message");
    }
    const dt = cand.find((x) => x.ptype === "drive_through");
    const sg = cand.find((x) => x.ptype === "stop_and_go");
    const sp = cand.find((x) => x.ptype === "stop_plus");
    const link = (x: PenaltyDraft) => {
      x.servedBy = p;
      p.penaltiesServed.push(x.id);
    };
    if (dt && short) {
      set("drive_through", p.pitType === "PENALTY" ? ["drive_time_pit_type", "rc_penalty_match", "transit_time"] : ["rc_penalty_match", "transit_time"]);
      link(dt);
    } else if (dt && pl === null && p.bOnly) {
      // No pit-lane time (no time card or pit report): a pit-lane pass right after race control
      // issued a drive-through is that drive-through, not a stop.
      set("drive_through", ["rc_penalty_match"]);
      p.confNotes.push("drive_through_without_pit_time");
      link(dt);
    } else if (p.pitType === "PENALTY" && short) {
      set("drive_through", ["drive_time_pit_type", "transit_time"]);
      p.confNotes.push("no_rc_penalty_text");
    } else if (sg) {
      set("stop_and_go", ["rc_penalty_match"]);
      link(sg);
    } else if (sp && !short) {
      // A Stop + N holds the car for N seconds: a pass at transit speed did not serve it.
      set("penalty_served", ["rc_penalty_match"]);
      link(sp);
    } else if (p.pitType === "PENALTY" && pl !== null && T !== null && pl > 1.15 * T) {
      set("penalty_served", ["drive_time_pit_type"]);
    } else if (
      dt &&
      ctx.race.format === "redmist" &&
      p.confNotes.includes("pit_entry_renumbered") &&
      p.official !== null &&
      p.official > 0 &&
      p.official <= REISSUED_DT_SEGMENT_MAX_S
    ) {
      // The stop stays a stop (its time lost covers both); the drive-through is served in it.
      set("stop", ["default_stop", "rc_penalty_match"]);
      p.confNotes.push("drive_through_in_reissued_visit");
      dt.confidence = "medium";
      dt.confNotes.push("served_in_reissued_visit");
      link(dt);
    } else if (!cand.length && p.pitType !== "PENALTY" && transit.valid && short) {
      // Rule 6, read per passage: no penalty record explains this passage (no matched RC penalty and no
      // Drive Time PENALTY type). DEFINITIONS.md says "no penalty record exists for the race"; read
      // literally, MPC #59 L62 (37.1 s, transit 35.1 s) would become a 37-second "stop".
      set("drive_through", ["duration_only", "transit_time"]);
      p.confNotes.push("drive_through_by_duration");
    } else if (pl !== null && pl > garageS) {
      set("garage", ["garage_threshold"]);
    } else {
      set("stop", ["default_stop"]);
      if (transit.valid && pl !== null && T !== null && pl > 1.15 * T && pl <= 1.5 * T && !cand.length) p.confNotes.push("ambiguous_short_stop");
    }
  }
}

/**
 * time_at_stop penalties ("to be served at next eligible stop"): served by the car's next `stop`
 * after issue, however long the stint (kind stays `stop`).
 */
export function linkTimeAtStop(passages: Passage[], pens: PenaltyDraft[]): void {
  for (const x of pens) {
    if (x.ptype !== "time_at_stop" || x.t === null || x.servedBy) continue;
    const p = passages
      .filter((q) => q.car === x.car && q.kind === "stop" && q.outcome === "rejoined" && (q.pinT ?? q.sortT) >= x.t!)
      .sort((a, b) => a.sortT - b.sortT)[0];
    if (p) {
      x.servedBy = p;
      p.penaltiesServed.push(x.id);
    }
  }
}

export function linkServedMessages(pens: PenaltyDraft[], served: ServedMsg[]): void {
  const linked = pens.filter((x) => x.servedBy && ["drive_through", "stop_and_go", "stop_plus"].includes(x.ptype)).sort((a, b) => a.servedBy!.sortT - b.servedBy!.sortT);
  for (const x of linked) {
    const after = x.servedBy!.poutT ?? x.servedBy!.rejoinT ?? x.servedBy!.sortT;
    const m = served.find((s) => !s.used && s.car === x.car && s.t >= after - 1e-6);
    if (m) {
      m.used = true;
      x.servedMsgT = m.t;
      x.servedMsgRef = m.ref;
    } else {
      x.confidence = "medium";
      x.confNotes.push("served_link_without_message");
    }
  }
}

/* ------------------------------------------------------------------ D-FCY-STOP */

export function fcyContext(ctx: Ctx, p: Passage, periods: Period[]): void {
  const rows = passageRows(ctx.laps[p.car] ?? [], p);
  const pin = p.pinT;
  let under: boolean;
  if (pin !== null && !p.bOnly) under = periods.some((q) => q.start <= pin && pin < q.end);
  else if (p.bOnly) under = periods.some((q) => q.start <= p.sortT && p.sortT < q.end);
  else under = rows.length > 0 && rows[0].fcy >= 1; // WRL: in-lap FCY-affected
  const any = rows.some((r) => r.fcy >= 1);
  p.fcyContext = under ? "fcy" : any ? "mixed" : "green";
  if (ctx.race.format === "speedhive" || ctx.race.format === "wrl-website") {
    // WRL has no pit-in time: any FCY-affected passage lap makes the passage FCY (D-FCY-STOP, WRL fixture rule).
    p.fcyContext = any ? (rows[0].fcy >= 1 ? "fcy" : "mixed") : "green";
  }
  const a = rows.length ? rows[0].startT : p.sortT;
  const b = rows.length ? rows[rows.length - 1].endT : p.rejoinT ?? p.sortT;
  p.fcyPeriodIds = periodIdsTouching(periods, a, b);
  // Reconstructed boundary (D-FCY-RECON edge case): pit-in within 60 s of an end or 10 s of a start.
  const t = p.pinT ?? p.sortT;
  if (periods.some((q) => q.rank === 3 && (Math.abs(t - q.end) < 60 || Math.abs(t - q.start) < 10))) p.confNotes.push("fcy_reconstructed_boundary");
}

export function assignStopNumbers(passages: Passage[]): void {
  const byCar = new Map<string, Passage[]>();
  for (const p of passages) byCar.set(p.car, [...(byCar.get(p.car) ?? []), p]);
  for (const ps of byCar.values()) {
    let n = 0;
    for (const p of [...ps].sort((a, b) => a.sortT - b.sortT)) {
      if (p.kind === "stop" || p.kind === "garage") p.stopNumber = ++n;
      else p.stopNumber = null;
    }
  }
}

export function idxFromLap(rows: LapRow[], lap: number | null): number | null {
  return idxOfLap(rows, lap);
}

export { rd };

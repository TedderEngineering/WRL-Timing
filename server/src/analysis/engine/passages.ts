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
  bOnly: boolean;
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
  const hi = p.outIdx ?? p.inIdx;
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
  const mk = (i0: number, i1: number | null, inferred: boolean): Passage => {
    const inRow = rows[i0];
    const outRow = i1 === null ? null : rows[i1];
    const refs = rows.slice(i0, (i1 ?? i0) + 1).map((r) => `${r.fileId}:L${r.row}`);
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
      out.push(mk(k, outI, false));
      k = outI !== null ? outI + 1 : j + 1;
      continue;
    }
    if (ww && rows[k].lastInPit && k > 0) out.push(mk(k - 1, k, true));
    k++;
  }
  return out;
}

function alkamelPassages(ctx: Ctx): Passage[] {
  const recs: CanonPitRecord[] = ctx.race.pitRecords.map((r) => ({ ...r }));
  const issues = ctx.issues;
  // Drive Time PIT rows: merge into a card within 1.5 s, else a passage of their own.
  for (const d of ctx.race.driveStints) {
    if (d.type !== "PIT" || d.startClockS === null) continue;
    const m = recs.find((r) => r.car === d.car && Math.abs(r.inClockS - d.startClockS!) <= 1.5);
    const ref = `${d.fileId}:L${d.row}`;
    if (m) {
      m.pitType = (d.pitType as "NORMAL" | "PENALTY") || null;
      m.driveTimeRef = ref;
    } else {
      recs.push({
        car: d.car,
        source: "drive_time",
        fileId: d.fileId,
        ref,
        nr: null,
        inClockS: d.startClockS,
        outClockS: d.timeS !== null ? d.startClockS + d.timeS : d.endClockS,
        pitTimeS: d.timeS,
        pitType: (d.pitType as "NORMAL" | "PENALTY") || null,
        driveTimeRef: ref,
      });
    }
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

/* ------------------------------------------------------------------ M7 penalties */

const PEN_RE = /^Car\s+#?(\w+):\s*Penalty\s*-\s*(.+?)\s+-\s+(.+)$/i;
const SERVED_RE = /^Car\s+#?(\w+):\s*Penalty(\s*#\d+)?\s+Served$/i;
const POST_RE = /^Car\s+#?(\w+)\s*-\s*([0-9.]+)\s*second[s]?\s+time\s+penalty\s+for\s+(.+)$/i;

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
  if (/disqualif|\bdsq\b|black flag/i.test(d)) return { type: "disqualification", amount: null };
  if (/grid/i.test(d)) return { type: "grid", amount: null };
  if (/position/i.test(d)) return { type: "position", amount: null };
  if (/\blap\b/i.test(d) && !/lap time/i.test(d)) return { type: "lap", amount: null };
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
  const msgs = [...ctx.race.raceControl].sort((a, b) => (a.tS ?? 0) - (b.tS ?? 0) || a.row - b.row);
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
  const pls = passages.filter((p) => p.official !== null && !p.bOnly && !isPitLaneStart(p, laps) && p.outLap !== null);
  if (!pls.length) return { valueS: null, estimated: true, valid: false, fromPassageId: null };
  const best = pls.reduce((a, b) => (b.official! < a.official! ? b : a));
  const med = median(pls.map((p) => p.official!))!;
  return { valueS: best.official, estimated: true, valid: best.official! <= 0.75 * med, fromPassageId: best.id };
}

export function isPitLaneStart(p: Passage, laps: Ctx["laps"]): boolean {
  if (p.pinT === null || p.bOnly) return false;
  const rows = laps[p.car] ?? [];
  const l1 = rows.find((r) => r.lap === 1);
  return !!l1 && p.pinT <= l1.startT + 2.0;
}

/* ------------------------------------------------------------------ M9 + M10 (Alkamel kinds and penalty links) */

export function classifyAlkamel(ctx: Ctx, passages: Passage[], pens: PenaltyDraft[], transit: Transit, garageS: number, serveWindowS: number): void {
  const hasPenaltyRecords = pens.length > 0 || ctx.race.driveStints.some((d) => d.type === "PIT");
  const T = transit.valueS;
  const sorted = [...passages].sort((a, b) => a.sortT - b.sortT || carOrder(a.car, b.car));
  for (const p of sorted) {
    const pl = p.official;
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
    if (p.outcome === "finished_in_pit_lane") {
      set("stop", ["default_stop"]);
      p.notes.push("The car's last crossing (the chequered flag) was made in the pit lane.");
      continue;
    }
    const cand = pens
      .filter((x) => x.car === p.car && !x.servedBy && x.t !== null && x.t <= pin && pin <= x.t + serveWindowS)
      .sort((a, b) => a.t! - b.t!);
    const dt = cand.find((x) => x.ptype === "drive_through");
    const sg = cand.find((x) => x.ptype === "stop_and_go");
    const sp = cand.find((x) => x.ptype === "stop_plus");
    const short = pl !== null && T !== null && pl <= 1.15 * T;
    const link = (x: PenaltyDraft) => {
      x.servedBy = p;
      p.penaltiesServed.push(x.id);
    };
    if (dt && short) {
      set("drive_through", p.pitType === "PENALTY" ? ["drive_time_pit_type", "rc_penalty_match", "transit_time"] : ["rc_penalty_match", "transit_time"]);
      link(dt);
    } else if (p.pitType === "PENALTY" && short) {
      set("drive_through", ["drive_time_pit_type", "transit_time"]);
      p.confNotes.push("no_rc_penalty_text");
    } else if (sg) {
      set("stop_and_go", ["rc_penalty_match"]);
      link(sg);
    } else if (sp) {
      set("penalty_served", ["rc_penalty_match"]);
      link(sp);
    } else if (p.pitType === "PENALTY" && pl !== null && T !== null && pl > 1.15 * T) {
      set("penalty_served", ["drive_time_pit_type"]);
    } else if (!hasPenaltyRecords && transit.valid && short) {
      set("drive_through", ["duration_only", "transit_time"]);
      p.confNotes.push("drive_through_by_duration");
    } else if (pl !== null && pl > garageS) {
      set("garage", ["garage_threshold"]);
    } else {
      set("stop", ["default_stop"]);
      if (pl !== null && T !== null && pl > 1.15 * T && pl <= 1.5 * T && !cand.length) p.confNotes.push("ambiguous_short_stop");
    }
  }
}

/** time_at_stop penalties: served by the car's next `stop` after issue (kind stays `stop`). */
export function linkTimeAtStop(passages: Passage[], pens: PenaltyDraft[], serveWindowS: number): void {
  for (const x of pens) {
    if (x.ptype !== "time_at_stop" || x.t === null || x.servedBy) continue;
    const p = passages
      .filter((q) => q.car === x.car && q.kind === "stop" && q.outcome === "rejoined" && (q.pinT ?? q.sortT) >= x.t! && (q.pinT ?? q.sortT) <= x.t! + Math.max(serveWindowS, 3600))
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

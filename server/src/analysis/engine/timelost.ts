/**
 * M11: clean laps and reference pace (D-REF-PACE), time lost green (D-LOSS-GREEN) and under caution
 * (D-LOSS-FCY), back-to-back groups (D-PITGROUP). Also the WRL kind rule that needs time lost
 * (D-PIT-KIND rules 7-8, WRL E6).
 */
import type { PitGroup, TimeLost } from "../schema/package-types.js";
import type { CarId } from "../types.js";
import { carOrder, median, rd } from "../util.js";
import { lossLapTime, type Ctx, type LapRow } from "./context.js";
import { passageRows, type Passage } from "./passages.js";

export const REF_WINDOWS = [5, 10, 15, 20] as const;
/** Lap time vs elapsed-difference tolerance for a clean lap. */
export const ELAPSED_TOL_S = 1.0;

/** laps.clean (D-REF-PACE). */
export function markClean(ctx: Ctx, passages: Passage[]): void {
  const inPassage = new Map<string, Set<number>>();
  for (const p of passages) {
    const rows = passageRows(ctx.laps[p.car] ?? [], p);
    if (!inPassage.has(p.car)) inPassage.set(p.car, new Set());
    for (const r of rows) inPassage.get(p.car)!.add(r.idx);
  }
  for (const [car, rows] of Object.entries(ctx.laps)) {
    const own = inPassage.get(car) ?? new Set<number>();
    for (const r of rows) {
      // A row whose elapsed duration disagrees with its lap time by more than 1 s (WRL website export:
      // repeated or shifted Total_Race_Time) is not a trustworthy green lap (spec §5 lap cell, medium).
      const consistent = r.lapTimeS !== null && Math.abs(r.durationS - r.lapTimeS) <= ELAPSED_TOL_S;
      r.clean = r.lap > 1 && r.fcy === 0 && r.lapTimeS !== null && r.span === 1 && consistent && !own.has(r.idx) ? 1 : 0;
    }
  }
}

export function classMedians(ctx: Ctx): Record<string, number | null> {
  const vals = new Map<string, number[]>();
  for (const [car, rows] of Object.entries(ctx.laps)) {
    const c = ctx.classOf[car];
    for (const r of rows) if (r.clean) vals.set(c, [...(vals.get(c) ?? []), r.lapTimeS!]);
  }
  const out: Record<string, number | null> = {};
  for (const k of ctx.classes) out[k.id] = median(vals.get(k.id) ?? []);
  return out;
}

export function refPace(rows: LapRow[], lo: number, hi: number): { ref: number | null; n: number; w: 5 | 10 | 15 | 20 | null } {
  for (const w of REF_WINDOWS) {
    const c = rows.filter((r) => r.clean && r.lap >= lo - w && r.lap <= hi + w).map((r) => r.lapTimeS!);
    if (c.length >= 3) return { ref: median(c), n: c.length, w };
  }
  return { ref: null, n: 0, w: null };
}

interface Span {
  car: CarId;
  i0: number;
  i1: number;
}

function greenLoss(ctx: Ctx, s: Span): TimeLost {
  const rows = ctx.laps[s.car];
  const lo = rows[s.i0].lap;
  const hi = rows[s.i1].lap;
  const { ref, n: nref, w } = refPace(rows, lo, hi);
  const seg = rows.slice(s.i0, s.i1 + 1);
  const lapSum = seg.reduce((a, r) => a + lossLapTime(r), 0);
  const n = seg.reduce((a, r) => a + r.span, 0);
  if (ref === null) {
    return { valueS: null, method: "none", nLaps: n, lapSumS: rd(lapSum), refLapS: null, refLapCount: 0 };
  }
  return { valueS: rd(lapSum - n * ref), method: "green_reference", nLaps: n, lapSumS: rd(lapSum), refLapS: rd(ref, 4), refLapCount: nref, refWindowLaps: w! };
}

interface FcyLoss {
  tl: TimeLost;
  notes: string[];
  conf: "high" | "medium" | "low";
}

/** D-LOSS-FCY: elapsed vs cars that were alongside at T0 and did not pit (neighbours), with the per-lap field fallback. */
function fcyLoss(ctx: Ctx, s: Span, passageIdx: Map<string, Set<number>>, official: number | null): FcyLoss {
  const rows = ctx.laps[s.car];
  const seg = rows.slice(s.i0, s.i1 + 1);
  const n = seg.reduce((a, r) => a + r.span, 0);
  const lap1 = s.i0 === 0 && rows[0].lap === 1;
  const T0 = s.i0 > 0 ? rows[s.i0 - 1].endT : rows[0].startT;
  const elapsed = rows[s.i1].endT - T0;
  const cls = ctx.classOf[s.car];
  let used: { car: string; v: number; same: boolean }[] = [];
  let usedW: 30 | 60 = 30;
  let scope: "class" | "all" = "class";
  let found = false;
  for (const win of [30, 60] as const) {
    const same: { car: string; v: number; same: boolean }[] = [];
    const other: { car: string; v: number; same: boolean }[] = [];
    for (const y of ctx.cars) {
      if (y === s.car) continue;
      const ry = ctx.laps[y];
      if (!ry?.length) continue;
      const pit = passageIdx.get(y) ?? new Set<number>();
      if (lap1) {
        if (ry[0].lap !== 1) continue;
        const s0 = ry[0].startT;
        if (Math.abs(s0 - T0) > win) continue;
        // laps 1..n all present, none a passage lap or a span row
        if (ry.length < n || ry[n - 1].lap !== n) continue;
        let ok = true;
        for (let m = 0; m < n; m++) if (pit.has(m) || ry[m].span !== 1) ok = false;
        if (!ok) continue;
        (ctx.classOf[y] === cls ? same : other).push({ car: y, v: ry[n - 1].endT - s0, same: ctx.classOf[y] === cls });
        continue;
      }
      // first crossing within ±win of T0
      const k = ry.findIndex((r) => Math.abs(r.endT - T0) <= win);
      if (k < 0) continue;
      if (k + n >= ry.length) continue;
      let ok = true;
      for (let m = 1; m <= n; m++) if (pit.has(k + m) || ry[k + m].span !== 1) ok = false;
      if (!ok) continue;
      (ctx.classOf[y] === cls ? same : other).push({ car: y, v: ry[k + n].endT - ry[k].endT, same: ctx.classOf[y] === cls });
    }
    const use = same.length >= 3 ? same : [...same, ...other];
    if (use.length >= 2) {
      used = use;
      usedW = win;
      scope = same.length >= 3 ? "class" : "all";
      found = true;
      break;
    }
    used = use;
  }
  if (found) {
    const med = median(used.map((x) => x.v))!;
    const value = elapsed - med;
    const notes: string[] = [];
    let conf: FcyLoss["conf"] = "high";
    if (used.length < 5) notes.push("neighbours_few");
    if (scope === "all") notes.push("neighbours_all_classes");
    if (usedW === 60) notes.push("neighbours_wide_window");
    if (value < 0 && value >= -10) notes.push("negative_time_lost");
    if (notes.length) conf = "medium";
    if (value < -10) {
      notes.push("fcy_loss_below_minus_10");
      conf = "low";
    }
    if (official !== null && value > official + 5) {
      notes.push("fcy_loss_exceeds_pit_lane");
      conf = "low";
    }
    return {
      tl: {
        valueS: rd(value),
        method: "fcy_neighbours",
        nLaps: n,
        anchorS: rd(T0 - ctx.axis.origin),
        elapsedS: rd(elapsed),
        neighbourMedianS: rd(med),
        neighbourCars: used.map((x) => x.car).sort(carOrder),
        neighbourScope: scope,
        neighbourWindowS: usedW,
      },
      notes,
      conf,
    };
  }
  // Fallback: per-lap field method (Alkamel Stage 1 (c)), confidence low.
  let refSum = 0;
  let ok = true;
  for (const x of seg) {
    let got = false;
    for (const sc of ["class", "all"] as const) {
      const vals: number[] = [];
      for (const y of ctx.cars) {
        if (y === s.car || (sc === "class" && ctx.classOf[y] !== cls)) continue;
        const ry = ctx.laps[y];
        if (!ry?.length) continue;
        let best = ry[0];
        for (const r of ry) if (Math.abs(r.endT - x.endT) < Math.abs(best.endT - x.endT)) best = r;
        const lt = best.lapTimeS;
        if (best.lap === 1 || lt === null || best.span !== 1 || Math.abs(best.endT - x.endT) > lt) continue;
        if ((passageIdx.get(y) ?? new Set()).has(best.idx)) continue;
        vals.push(lt);
      }
      if (vals.length >= 3) {
        refSum += median(vals)!;
        got = true;
        break;
      }
    }
    if (!got) {
      ok = false;
      break;
    }
  }
  const lapSum = seg.reduce((a, r) => a + lossLapTime(r), 0);
  if (ok) {
    return { tl: { valueS: rd(lapSum - refSum), method: "fcy_lap_field", nLaps: n, lapSumS: rd(lapSum) }, notes: ["fcy_lap_field_fallback"], conf: "low" };
  }
  return { tl: { valueS: null, method: "none", nLaps: n, lapSumS: rd(lapSum) }, notes: ["no_reference_pace"], conf: "low" };
}

export interface TimeLostResult {
  groups: PitGroup[];
}

function lowerConf(p: { confidence: "high" | "medium" | "low" }, c: "high" | "medium" | "low"): void {
  const rank = { high: 0, medium: 1, low: 2 };
  if (rank[c] > rank[p.confidence]) p.confidence = c;
}

export function computeTimeLost(ctx: Ctx, passages: Passage[]): TimeLostResult {
  const passageIdx = new Map<string, Set<number>>();
  for (const p of passages) {
    if (!passageIdx.has(p.car)) passageIdx.set(p.car, new Set());
    for (const r of passageRows(ctx.laps[p.car] ?? [], p)) passageIdx.get(p.car)!.add(r.idx);
  }
  // groups (D-PITGROUP): consecutive rejoined passages whose in-lap <= the previous out-lap.
  const groups: PitGroup[] = [];
  const byCar = new Map<string, Passage[]>();
  for (const p of passages) byCar.set(p.car, [...(byCar.get(p.car) ?? []), p]);
  const grouped = new Set<Passage>();
  for (const car of [...byCar.keys()].sort(carOrder)) {
    const ps = byCar.get(car)!.filter((p) => p.inIdx !== null && p.kind !== "red_flag_hold").sort((a, b) => a.sortT - b.sortT);
    let i = 0;
    while (i < ps.length - 1) {
      const g = [ps[i]];
      while (i + g.length < ps.length) {
        const prev = g[g.length - 1];
        const next = ps[i + g.length];
        if (prev.outIdx !== null && next.outIdx !== null && next.inIdx! <= prev.outIdx && prev.kind !== "pit_lane_start") g.push(next);
        else break;
      }
      if (g.length > 1) {
        for (const p of g) grouped.add(p);
        const n = groups.filter((x) => x.car === car).length + 1;
        const gid = `pitgroup:${car}:${n}`;
        const s: Span = { car, i0: g[0].inIdx!, i1: Math.max(...g.map((p) => p.outIdx!)) };
        const rows = ctx.laps[car];
        const anyFcy = rows.slice(s.i0, s.i1 + 1).some((r) => r.fcy >= 1) || g.some((p) => p.fcyContext !== "green");
        let tl: TimeLost;
        let conf: "high" | "medium" | "low" = "high";
        const notes: string[] = [];
        if (anyFcy) {
          const off = g.every((p) => p.official !== null) ? g.reduce((a, p) => a + p.official!, 0) : null;
          const r = fcyLoss(ctx, s, passageIdx, off);
          tl = r.tl;
          conf = r.conf;
          notes.push(...r.notes);
          const gr = greenLoss(ctx, s);
          tl.greenReferenceValueS = gr.valueS;
        } else {
          tl = greenLoss(ctx, s);
          if (tl.refWindowLaps && tl.refWindowLaps > 5) {
            conf = "medium";
            notes.push("ref_window_widened");
          }
          if (tl.valueS === null) {
            conf = "low";
            notes.push("no_reference_pace");
          }
        }
        const pg: PitGroup = {
          id: gid,
          car,
          passageIds: g.map((p) => p.id),
          laps: [rows[s.i0].lap, rows[s.i1].lap],
          timeLost: tl,
          officialPitLaneTimeSumS: g.every((p) => p.official !== null) ? rd(g.reduce((a, p) => a + p.official!, 0)) : null,
          source: { kind: "derived", files: [...new Set(g.flatMap((p) => p.files).concat(rows[s.i0].fileId))], method: anyFcy ? "D-LOSS-FCY" : "D-LOSS-GREEN" },
          confidence: conf,
        };
        if (notes.length) pg.confidenceNotes = [...new Set(notes)];
        groups.push(pg);
        for (const p of g) {
          p.groupId = gid;
          p.timeLost = { valueS: null, method: "see_group", groupId: gid };
          lowerConf(p, conf);
        }
        i += g.length;
      } else i++;
    }
  }
  // per passage
  for (const p of passages) {
    if (grouped.has(p)) continue;
    if (p.kind === "retirement" || p.kind === "pit_lane_start" || p.kind === "red_flag_hold" || p.outcome !== "rejoined" || p.inIdx === null || p.outIdx === null) {
      p.timeLost = { valueS: null, method: "none" };
      continue;
    }
    const s: Span = { car: p.car, i0: p.inIdx, i1: p.outIdx };
    if (p.fcyContext === "green") {
      p.timeLost = greenLoss(ctx, s);
      if (p.timeLost.refWindowLaps && p.timeLost.refWindowLaps > 5) {
        p.confNotes.push("ref_window_widened");
        lowerConf(p, "medium");
      }
      if (p.timeLost.valueS === null) {
        p.confNotes.push("no_reference_pace");
        lowerConf(p, "low");
      }
    } else {
      const r = fcyLoss(ctx, s, passageIdx, p.official);
      p.timeLost = r.tl;
      p.timeLost.greenReferenceValueS = greenLoss(ctx, s).valueS;
      p.confNotes.push(...r.notes);
      lowerConf(p, r.conf);
    }
  }
  // A passage followed by a retirement inside its out-lap keeps its own value (D-PITGROUP).
  for (const ps of byCar.values()) {
    const s = [...ps].sort((a, b) => a.sortT - b.sortT);
    for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i];
      const b = s[i + 1];
      if (a.outIdx !== null && b.outcome !== "rejoined" && b.inIdx !== null && b.inIdx <= a.outIdx && !a.groupId) {
        a.confNotes.push("out_lap_ends_in_pit_lane");
        lowerConf(a, "medium");
      }
    }
  }
  return { groups };
}

/** WRL kinds (no pit-lane times): D-PIT-KIND rules 7-9 on time lost, class median green-stop loss (WRL E6). */
export function classifyWrl(ctx: Ctx, passages: Passage[], groups: PitGroup[], garageS: number): void {
  const valueOf = (p: Passage): number | null => {
    if (p.timeLost.method === "see_group") return groups.find((g) => g.id === p.groupId)?.timeLost.valueS ?? null;
    return p.timeLost.method === "fcy_lap_field" ? null : p.timeLost.valueS;
  };
  const spanInside = (p: Passage) => passageRows(ctx.laps[p.car], p).some((r) => r.span > 1);
  const med: Record<string, number | null> = {};
  for (const c of ctx.classes) {
    const g = passages
      .filter((p) => ctx.classOf[p.car] === c.id && p.fcyContext === "green" && p.outcome === "rejoined" && !spanInside(p))
      .map(valueOf)
      .filter((v): v is number => v !== null && v < garageS);
    med[c.id] = median(g);
  }
  for (const p of passages) {
    if (p.outcome === "retired") {
      p.kind = "retirement";
      p.kindBasis = ["no_later_lap"];
      continue;
    }
    if (p.outcome === "finished_in_pit_lane") {
      p.kind = "stop";
      p.kindBasis = ["default_stop"];
      continue;
    }
    const x = valueOf(p);
    const m = med[ctx.classOf[p.car]];
    const green = p.fcyContext === "green";
    if (x === null) {
      p.kind = "stop";
      p.kindBasis = ["default_stop"];
    } else if (x > garageS) {
      p.kind = "garage";
      p.kindBasis = ["garage_threshold"];
    } else if (m !== null && x > 2 * m) {
      p.kind = "stop";
      p.kindBasis = ["default_stop"];
      p.notes.push("long_stop: time lost is more than twice the class median green-stop time lost.");
    } else if (x < 10 && green) {
      p.kind = "stop";
      p.kindBasis = ["default_stop"];
      p.noLoss = true;
      p.confNotes.push("pit_flag_without_loss");
      p.confidence = "low";
    } else if (m !== null && x < 0.5 * m && green) {
      p.kind = "drive_through";
      p.kindBasis = ["loss_fraction_fallback"];
      p.confNotes.push("drive_through_by_loss_fraction");
      p.confidence = "low";
    } else {
      p.kind = "stop";
      p.kindBasis = ["default_stop"];
    }
  }
}

export function lowerConfidence(p: { confidence: "high" | "medium" | "low" }, c: "high" | "medium" | "low"): void {
  lowerConf(p, c);
}

export function spanRowsIn(ctx: Ctx, p: Passage): LapRow[] {
  return passageRows(ctx.laps[p.car] ?? [], p).filter((r) => r.span > 1);
}

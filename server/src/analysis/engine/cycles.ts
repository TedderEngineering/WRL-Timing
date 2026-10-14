/**
 * M13 class pit cycles (D-CYCLE), M14 swaps (D-SWAP, D-LAPDOWN events), M15 cycle results and
 * position effects (D-CYCLE-POS, D-CAUSE, D-LAPDOWN passage flag).
 */
import type { Counterparty, CycleResult, PitCycle, PositionChangeTable, SwapCause, SwapMechanism } from "../schema/package-types.js";
import type { CarId } from "../types.js";
import { carOrder, mean, median, rd } from "../util.js";
import { tp, type Ctx, type LapRow } from "./context.js";
import type { Period } from "./fcy.js";
import type { Passage } from "./passages.js";
import type { PositionIndex } from "./positions.js";

export type CycleModel = "rounds" | "windows" | "singleton";

export interface CycleDraft {
  cls: string;
  members: Passage[];
  gaps: number[];
  splitGaps: number[];
  model: CycleModel;
  defaulted: boolean;
  fcyIndex: number | null;
  id: string;
  ordinal: number;
  opens: number;
  closes: number;
}

export function isMember(p: Passage): boolean {
  return p.kind === "stop" && p.outcome === "rejoined" && !p.noLoss;
}

export function chooseModel(ctx: Ctx, passages: Passage[], cls: string, configured: CycleModel | undefined): { model: CycleModel; defaulted: boolean } {
  if (configured) return { model: configured, defaulted: false };
  const cars = ctx.cars.filter((c) => ctx.classOf[c] === cls && (ctx.laps[c]?.length ?? 0) > 0 && ctx.laps[c][ctx.laps[c].length - 1].endT >= ctx.chequerT - 1e-6);
  const counts = cars.map((c) => passages.filter((p) => p.car === c && p.kind === "stop").length);
  const m = median(counts) ?? 0;
  return { model: m <= 3 ? "rounds" : "windows", defaulted: true };
}

export function buildPitCycles(ctx: Ctx, passages: Passage[], periods: Period[], classMed: Record<string, number | null>, configured: CycleModel | undefined): CycleDraft[] {
  const all: CycleDraft[] = [];
  for (const c of ctx.classes) {
    const mem = passages.filter((p) => ctx.classOf[p.car] === c.id && isMember(p)).sort((a, b) => a.sortT - b.sortT || carOrder(a.car, b.car));
    if (!mem.length) continue;
    const { model, defaulted } = chooseModel(ctx, passages, c.id, configured);
    const med = classMed[c.id] ?? 120;
    const out: CycleDraft[] = [];
    const mk = (fcyIndex: number | null): CycleDraft => ({ cls: c.id, members: [], gaps: [], splitGaps: [], model, defaulted, fcyIndex, id: "", ordinal: 0, opens: 0, closes: 0 });
    if (model === "singleton") {
      for (const p of mem) {
        const cy = mk(null);
        cy.members.push(p);
        out.push(cy);
      }
    } else if (model === "rounds") {
      const gap = 4 * med;
      let cur: CycleDraft | null = null;
      let last = 0;
      for (const p of mem) {
        if (!cur || p.sortT - last > gap) {
          if (cur) cur.splitGaps.push(p.sortT - last);
          const prev: CycleDraft | null = cur;
          cur = mk(null);
          if (prev) cur.splitGaps.push(p.sortT - last);
          out.push(cur);
        } else cur.gaps.push(p.sortT - last);
        cur.members.push(p);
        last = p.sortT;
      }
    } else {
      // windows: (a) FCY-anchored, (b) green non-chaining window of 3 class median laps.
      const fcyGroups = new Map<number, CycleDraft>();
      const green: Passage[] = [];
      for (const p of mem) {
        const a = p.sortT;
        const b = p.rejoinT ?? p.sortT;
        const k = periods.findIndex((q) => a < q.end && b > q.start);
        if (k >= 0) {
          if (!fcyGroups.has(k)) fcyGroups.set(k, mk(k));
          fcyGroups.get(k)!.members.push(p);
        } else green.push(p);
      }
      out.push(...fcyGroups.values());
      let k = 0;
      while (k < green.length) {
        const t0 = green[k].sortT;
        let j = k;
        while (j + 1 < green.length && green[j + 1].sortT <= t0 + 3 * med) j++;
        const cy = mk(null);
        cy.members.push(...green.slice(k, j + 1));
        const nxt = green[j + 1];
        if (nxt) cy.splitGaps.push(nxt.sortT - t0);
        cy.gaps.push(...green.slice(k + 1, j + 1).map((p) => p.sortT - t0));
        out.push(cy);
        k = j + 1;
      }
    }
    for (const cy of out) {
      cy.opens = Math.min(...cy.members.map((p) => p.sortT));
      cy.closes = Math.max(...cy.members.map((p) => p.rejoinT ?? p.sortT));
    }
    out.sort((a, b) => a.opens - b.opens);
    out.forEach((cy, i) => {
      cy.ordinal = i + 1;
      cy.id = `cycle:${c.id}:${i + 1}`;
      for (const p of cy.members) p.cycleId = cy.id;
    });
    all.push(...out);
  }
  return all;
}

export function toPitCycles(ctx: Ctx, drafts: CycleDraft[], passages: Passage[], classMed: Record<string, number | null>): PitCycle[] {
  const wrl = ctx.race.format === "speedhive" || ctx.race.format === "wrl-website";
  return drafts.map((cy) => {
    const med = classMed[cy.cls] ?? 120;
    const threshold = cy.model === "rounds" ? 4 * med : cy.model === "windows" ? 3 * med : null;
    const gaps = [...cy.gaps, ...cy.splitGaps];
    const margin = threshold && gaps.length ? Math.min(...gaps.map((g) => (Math.abs(threshold - g) / threshold) * 100)) : null;
    const notes: string[] = [];
    let conf: "high" | "medium" | "low" = "high";
    if (margin !== null && margin < 5) {
      notes.push("cycle_split_borderline");
      conf = "medium";
      ctx.issues.push({ severity: "warning", code: "CYCLE-SPLIT-BORDERLINE", message: `${cy.id}: a gap between pit-ins came within ${rd(margin, 1)} % of the split threshold (${rd(threshold!, 1)} s).`, factIds: [cy.id] });
    }
    if (cy.defaulted) {
      notes.push("cycle_model_defaulted");
      conf = "medium";
    }
    const outLapBasis = wrl || (ctx.race.format === "redmist" && cy.members.some((p) => p.poutT === null));
    if (outLapBasis) {
      notes.push("close_basis_out_lap_end");
      conf = "medium";
    }
    if (cy.members.some((p) => p.confidence === "low")) conf = "low";
    const ctxs = cy.members.map((p) => p.fcyContext);
    const trigger = ctxs.every((x) => x !== "green") ? "fcy" : ctxs.every((x) => x === "green") ? "green" : "mixed";
    const vals = cy.members.filter((p) => p.timeLost.valueS !== null);
    const pls = cy.members.filter((p) => p.official !== null);
    const bestTl = vals.length ? vals.reduce((a, b) => (b.timeLost.valueS! < a.timeLost.valueS! ? b : a)) : null;
    const bestPl = pls.length ? pls.reduce((a, b) => (b.official! < a.official! ? b : a)) : null;
    const memberSet = new Set(cy.members);
    const over = passages
      .filter((p) => ctx.classOf[p.car] === cy.cls && !memberSet.has(p) && p.sortT <= cy.closes && (p.rejoinT ?? p.poutT ?? p.sortT) >= cy.opens)
      .map((p) => p.id);
    const fcyIds = [...new Set(cy.members.flatMap((p) => p.fcyPeriodIds))].sort((a, b) => Number(a.split(":")[1]) - Number(b.split(":")[1]));
    const out: PitCycle = {
      id: cy.id,
      class: cy.cls,
      ordinal: cy.ordinal,
      model: cy.model,
      trigger,
      fcyPeriodIds: fcyIds,
      opens: tp(ctx, cy.opens),
      closes: tp(ctx, cy.closes),
      closeBasis: outLapBasis ? "out_lap_end" : "pit_out",
      splitRule: {
        gapThresholdS: cy.model === "rounds" ? rd(threshold) : null,
        windowS: cy.model === "windows" ? rd(threshold) : null,
        maxGapS: cy.gaps.length ? rd(Math.max(...cy.gaps)) : null,
        nearestSplitMarginPct: margin === null ? null : rd(margin, 1),
      },
      members: [...cy.members].sort((a, b) => a.sortT - b.sortT).map((p) => ({ car: p.car, passageId: p.id })),
      overlappingPassageIds: over,
      stats: {
        nMembers: cy.members.length,
        meanTimeLostS: vals.length ? rd(mean(vals.map((p) => p.timeLost.valueS!))) : null,
        medianTimeLostS: vals.length ? rd(median(vals.map((p) => p.timeLost.valueS!))) : null,
        bestTimeLostS: bestTl ? bestTl.timeLost.valueS : null,
        bestTimeLostPassageId: bestTl ? bestTl.id : null,
        meanPitLaneS: pls.length ? rd(mean(pls.map((p) => p.official!))) : null,
        bestPitLaneS: bestPl ? rd(bestPl.official) : null,
        bestPitLanePassageId: bestPl ? bestPl.id : null,
      },
      source: { kind: "derived", method: "D-CYCLE", files: [...new Set(cy.members.flatMap((p) => p.files))] },
      confidence: conf,
    };
    if (notes.length) out.confidenceNotes = notes;
    return out;
  });
}

/* ------------------------------------------------------------------ M14 swaps */

export interface Swap {
  lap: number;
  winner: CarId;
  loser: CarId;
  mech: SwapMechanism;
  fcy: 0 | 1;
}

export function passagesAt(byCar: Map<string, Passage[]>, car: CarId, L: number): Passage[] {
  return (byCar.get(car) ?? []).filter((p) => p.inLap <= L && L <= (p.outLap ?? p.inLap));
}

function rowAtLap(rows: LapRow[], L: number): LapRow | undefined {
  // exact lap row
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (rows[m].lap === L) return rows[m];
    if (rows[m].lap < L) lo = m + 1;
    else hi = m - 1;
  }
  return undefined;
}

export function detectSwaps(ctx: Ctx, pos: PositionIndex, passages: Passage[]): Swap[] {
  const byCar = new Map<string, Passage[]>();
  for (const p of passages) byCar.set(p.car, [...(byCar.get(p.car) ?? []), p]);
  const swaps: Swap[] = [];
  for (const c of ctx.classes) {
    if (!ctx.cars.some((x) => ctx.classOf[x] === c.id && (ctx.laps[x]?.length ?? 0) > 0)) continue;
    for (let L = 2; L <= pos.maxLap; L++) {
      const o0 = pos.classOrder(c.id, L - 1);
      const o1 = pos.classOrder(c.id, L);
      const r1 = new Map(o1.map((x, i) => [x, i]));
      for (let i = 0; i < o0.length; i++) {
        for (let j = i + 1; j < o0.length; j++) {
          const a = o0[i];
          const b = o0[j];
          if (r1.get(b)! < r1.get(a)!) {
            const win = b;
            const lose = a;
            const lw = passagesAt(byCar, win, L);
            const ll = passagesAt(byCar, lose, L);
            const loserLast = pos.lastLap(lose);
            let mech: SwapMechanism;
            if (loserLast < L && (ll.length === 0 || ll.every((p) => p.kind === "retirement"))) mech = "retirement";
            else if (ll.some((p) => p.kind === "drive_through" || p.kind === "stop_and_go" || p.kind === "penalty_served")) mech = "penalty";
            else if (lw.length && ll.length) mech = "both_pitted";
            else if (lw.length) mech = "winner_pitted";
            else if (ll.length) mech = "loser_pitted";
            else mech = "on_track";
            const fw = rowAtLap(ctx.laps[win] ?? [], L);
            const fl = rowAtLap(ctx.laps[lose] ?? [], L);
            swaps.push({ lap: L, winner: win, loser: lose, mech, fcy: (fw && fw.fcy) || (fl && fl.fcy) ? 1 : 0 });
          }
        }
      }
    }
  }
  return swaps;
}

export function causeFor(subject: CarId, sw: Swap, ownMember: boolean): SwapCause {
  const m = sw.mech;
  const won = sw.winner === subject;
  if (m === "on_track") return "on_track";
  if (m === "penalty") return "penalty";
  if (m === "retirement") return "retirement";
  if (m === "both_pitted") return "pit_cycle";
  if ((m === "winner_pitted" && won) || (m === "loser_pitted" && !won)) return ownMember ? "pit_cycle" : "own_pit";
  return "rival_pit";
}

/* ------------------------------------------------------------------ M15 */

interface Effect {
  beforeRow: LapRow | null;
  afterRow: LapRow | null;
  gainedOn: Counterparty[];
  lostTo: Counterparty[];
}

function effectThrough(ctx: Ctx, pos: PositionIndex, swapIdx: Map<string, Swap[]>, p: Passage, closeT: number, member: boolean): Effect {
  const rows = ctx.laps[p.car] ?? [];
  const beforeRow = p.inIdx !== null && p.inIdx > 0 ? rows[p.inIdx - 1] : null;
  let afterRow: LapRow | null = null;
  if (p.outLap !== null) {
    for (const r of rows) {
      if (r.lap >= p.outLap && r.endT >= closeT - 1e-6) {
        afterRow = r;
        break;
      }
    }
  }
  const gainedOn: Counterparty[] = [];
  const lostTo: Counterparty[] = [];
  if (beforeRow && afterRow) {
    const cls = ctx.classOf[p.car];
    const o0 = pos.classOrder(cls, beforeRow.lap);
    const o1 = pos.classOrder(cls, afterRow.lap);
    const a0 = new Set(o0.slice(0, o0.indexOf(p.car)));
    const a1 = new Set(o1.slice(0, o1.indexOf(p.car)));
    const cp = (other: string): Counterparty => {
      const key = p.car < other ? `${p.car}\u0000${other}` : `${other}\u0000${p.car}`;
      const list = (swapIdx.get(key) ?? []).filter((s) => s.lap > beforeRow.lap && s.lap <= afterRow!.lap);
      const sw = list[list.length - 1];
      if (!sw) return { car: other, cause: "on_track" };
      return { car: other, cause: causeFor(p.car, sw, member), passId: `pass:${sw.winner}:${sw.lap}:${sw.loser}` };
    };
    for (const o of [...a0].filter((x) => !a1.has(x)).sort(carOrder)) gainedOn.push(cp(o));
    for (const o of [...a1].filter((x) => !a0.has(x)).sort(carOrder)) lostTo.push(cp(o));
  }
  return { beforeRow, afterRow, gainedOn, lostTo };
}

export function computeCycleResults(ctx: Ctx, pos: PositionIndex, drafts: CycleDraft[], passages: Passage[], swaps: Swap[]): CycleResult[] {
  const swapIdx = new Map<string, Swap[]>();
  for (const s of swaps) {
    const key = s.winner < s.loser ? `${s.winner}\u0000${s.loser}` : `${s.loser}\u0000${s.winner}`;
    if (!swapIdx.has(key)) swapIdx.set(key, []);
    swapIdx.get(key)!.push(s);
  }
  const results: CycleResult[] = [];
  const memberOf = new Map<Passage, CycleDraft>();
  for (const cy of drafts) for (const p of cy.members) memberOf.set(p, cy);
  const cycleConf = new Map<string, "high" | "medium" | "low">();
  for (const cy of drafts) {
    const vals = cy.members.filter((p) => p.timeLost.valueS !== null);
    const mu = vals.length ? mean(vals.map((p) => p.timeLost.valueS!)) : null;
    const ranked = [...vals].sort((a, b) => a.timeLost.valueS! - b.timeLost.valueS! || carOrder(a.car, b.car));
    const seenCar = new Map<string, number>();
    for (const p of [...cy.members].sort((a, b) => a.sortT - b.sortT)) {
      // A car with two stops in one cycle gets ':<k>' on its second and later results (id stays unique).
      const k = (seenCar.get(p.car) ?? 0) + 1;
      seenCar.set(p.car, k);
      const e = effectThrough(ctx, pos, swapIdx, p, cy.closes, true);
      const cb = e.beforeRow?.cpos ?? null;
      const ca = e.afterRow?.cpos ?? null;
      const ldb = e.beforeRow?.lapsDown ?? null;
      const lda = e.afterRow?.lapsDown ?? null;
      p.lapDown = ldb !== null && lda !== null ? lda > ldb : null;
      const notes: string[] = [];
      let conf: "high" | "medium" | "low" = cycleConf.get(cy.id) ?? "high";
      if (!e.afterRow) {
        notes.push("retired_before_cycle_close");
        if (conf === "high") conf = "medium";
      }
      const r: CycleResult = {
        id: `cycres:${cy.cls}:${cy.ordinal}:${p.car}${k > 1 ? `:${k}` : ""}`,
        cycleId: cy.id,
        car: p.car,
        passageId: p.id,
        beforeLap: e.beforeRow?.lap ?? null,
        afterLap: e.afterRow?.lap ?? null,
        classPosBefore: cb,
        classPosAfter: ca,
        netClass: cb !== null && ca !== null ? cb - ca : null,
        overallPosBefore: e.beforeRow?.pos ?? null,
        overallPosAfter: e.afterRow?.pos ?? null,
        netOverall: e.beforeRow && e.afterRow ? e.beforeRow.pos - e.afterRow.pos : null,
        gainedOn: e.gainedOn,
        lostTo: e.lostTo,
        lapsDownBefore: ldb,
        lapsDownAfter: lda,
        lapDown: p.lapDown,
        timeLostRank: ranked.includes(p) ? ranked.indexOf(p) + 1 : null,
        deltaToCycleMeanS: mu !== null && p.timeLost.valueS !== null ? rd(p.timeLost.valueS - mu) : null,
        source: { kind: "derived", method: "D-CYCLE-POS", files: [...new Set([...p.files, ...(ctx.laps[p.car]?.slice(0, 1).map((x) => x.fileId) ?? [])])] },
        confidence: conf,
      };
      if (notes.length) r.confidenceNotes = notes;
      results.push(r);
    }
  }
  // Non-member passages: the passage itself is the cycle (close = its own rejoin).
  for (const p of passages) {
    if (memberOf.has(p)) continue;
    if (p.outcome !== "rejoined" || p.kind === "retirement") {
      p.lapDown = null;
      continue;
    }
    const closeT = p.rejoinT ?? p.poutT ?? p.sortT;
    const e = effectThrough(ctx, pos, swapIdx, p, closeT, false);
    const ldb = e.beforeRow?.lapsDown ?? null;
    const lda = e.afterRow?.lapsDown ?? null;
    p.lapDown = ldb !== null && lda !== null ? lda > ldb : null;
    if (e.beforeRow && e.afterRow) {
      p.positionEffect = {
        beforeLap: e.beforeRow.lap,
        afterLap: e.afterRow.lap,
        classPosBefore: e.beforeRow.cpos,
        classPosAfter: e.afterRow.cpos,
        netClass: e.beforeRow.cpos - e.afterRow.cpos,
        lostTo: e.lostTo,
        gainedOn: e.gainedOn,
      };
    }
  }
  return results;
}

/** positionChanges table with confirmed lap-down events (D-LAPDOWN). */
export function buildPositionChanges(ctx: Ctx, swaps: Swap[], drafts: CycleDraft[], passages: Passage[]): PositionChangeTable {
  const byCar = new Map<string, Passage[]>();
  for (const p of passages) byCar.set(p.car, [...(byCar.get(p.car) ?? []), p]);
  const lapDowns = { car: [] as string[], lap: [] as number[], lapsDown: [] as number[], cause: [] as ("pit" | "on_track" | "fcy_pit" | "unknown")[] };
  for (const car of [...ctx.cars].sort(carOrder)) {
    const rows = ctx.laps[car] ?? [];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      if (b.lapsDown <= a.lapsDown) continue;
      const open = drafts.filter((cy) => cy.cls === ctx.classOf[car] && cy.opens <= b.endT && b.endT <= cy.closes);
      const tS = Math.max(b.endT, ...open.map((cy) => cy.closes));
      const confirm = rows.slice(i).find((r) => r.endT >= tS - 1e-6);
      if (!confirm || confirm.lapsDown < b.lapsDown) continue;
      const pa = passagesAt(byCar, car, b.lap);
      const cause = pa.length ? (pa.some((p) => p.fcyContext !== "green") ? "fcy_pit" : "pit") : "on_track";
      lapDowns.car.push(car);
      lapDowns.lap.push(b.lap);
      lapDowns.lapsDown.push(b.lapsDown);
      lapDowns.cause.push(cause);
    }
  }
  return {
    layout: "columnar/1",
    scope: "class",
    rows: {
      lap: swaps.map((s) => s.lap),
      winner: swaps.map((s) => s.winner),
      loser: swaps.map((s) => s.loser),
      mechanism: swaps.map((s) => s.mech),
      fcy: swaps.map((s) => s.fcy),
    },
    lapDowns,
    source: { kind: "derived", method: "D-SWAP" },
    confidence: "high",
  };
}

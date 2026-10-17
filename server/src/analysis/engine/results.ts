/**
 * M16 entries, results and retirements (D-MAKE, D-FINISH, D-RETIRE) and penalty statuses after the
 * results are known (D-PENALTY).
 */
import type { Entry, Penalty, Result, ResultsStatus, Retirement } from "../schema/package-types.js";
import type { CarId } from "../types.js";
import { carOrder, rd } from "../util.js";
import { tp, type Ctx } from "./context.js";
import { leaderLapFinder } from "./fcy.js";
import type { Passage, PenaltyDraft } from "./passages.js";

export const MAKE_ALIASES: Record<string, string[]> = {
  "Aston Martin": ["aston martin"],
  Audi: ["audi"],
  BMW: ["bmw", "bmw m", "bmw m motorsport"],
  Cupra: ["cupra"],
  Ford: ["ford", "ford performance"],
  Honda: ["honda"],
  Hyundai: ["hyundai", "hyundai n"],
  McLaren: ["mclaren"],
  "Mercedes-AMG": ["mercedes-amg", "mercedes amg", "mercedes amg gmbh", "mercedes"],
  Porsche: ["porsche"],
  Toyota: ["toyota", "toyota gazoo racing", "tgr"],
};
const ALIAS = new Map<string, string>();
for (const [k, vs] of Object.entries(MAKE_ALIASES)) for (const a of vs) ALIAS.set(a, k);

export function normaliseMake(raw: string | null | undefined): { make: string; raw: string | null; mapped: boolean } {
  const s = (raw ?? "").trim();
  if (!s) return { make: "TBD", raw: null, mapped: false };
  const k = ALIAS.get(s.toLowerCase());
  return { make: k ?? s, raw: s, mapped: !!k };
}

export function makeFromVehicle(vehicle: string | null | undefined): string | null {
  const v = (vehicle ?? "").trim().toLowerCase();
  if (!v) return null;
  let best: string | null = null;
  for (const a of ALIAS.keys()) if ((v === a || v.startsWith(a + " ")) && (!best || a.length > best.length)) best = a;
  return best ? ALIAS.get(best)! : null;
}

function mapStatus(raw: string): Result["status"] {
  const s = raw.trim().toLowerCase();
  if (s === "classified" || s === "normal") return "classified";
  if (s === "not started" || s === "dns") return "dns";
  if (s === "retired" || s === "dnf") return "dnf";
  if (s === "disqualified" || s === "dq" || s === "dsq") return "dsq";
  if (s === "excluded") return "excluded";
  return "not_classified";
}

export interface ResultsOut {
  entries: Entry[];
  retirements: Retirement[];
  resultsStatus: ResultsStatus | "none";
  tookFlag: (car: CarId) => boolean;
}

export function buildResults(ctx: Ctx, passages: Passage[]): ResultsOut {
  const res = ctx.race.results;
  const status: ResultsStatus | "none" = !res ? "none" : res.mark === "official" ? "official" : res.mark === "unofficial" ? "unofficial" : "provisional";
  if (!res) ctx.issues.push({ severity: "blocker", code: "RESULTS-MISSING", message: "No results file: finishing positions come only from the results file (D-FINISH)." });
  else if (res.mark === "unknown") {
    ctx.issues.push({ severity: "note", code: "RESULTS-PROVISIONAL", message: "The results file carries no report mark; results are labelled provisional until confirmed (open question Q4).", files: res.fileIds });
  } else if (status !== "official") {
    ctx.issues.push({ severity: "note", code: "RESULTS-PROVISIONAL", message: `Finishing positions come from the ${status} results; replace when official results arrive.`, files: res.fileIds });
  }
  const tookFlag = (car: CarId) => {
    const rows = ctx.laps[car] ?? [];
    return rows.length > 0 && rows[rows.length - 1].endT >= ctx.chequerT - 1e-6;
  };
  const rowsBy = new Map((res?.rows ?? []).map((r) => [r.car, r]));
  const entries: Entry[] = [];
  for (const e of ctx.race.entries) {
    const r = rowsBy.get(e.car);
    let result: Result | null = null;
    if (r) {
      const st = r.rawStatus ? mapStatus(r.rawStatus) : r.position !== null ? "classified" : "not_classified";
      const lastRow = (ctx.laps[e.car] ?? []).slice(-1)[0];
      result = {
        id: `result:${e.car}`,
        status: st,
        rawStatus: r.rawStatus || undefined,
        positionOverall: r.position !== null && r.position >= 1 ? r.position : null,
        positionClass: r.positionClass !== null && r.positionClass >= 1 ? r.positionClass : null,
        laps: r.laps !== null && r.laps >= 0 ? r.laps : lastRow ? lastRow.lap : 0,
        totalTimeS: rd(r.totalTimeS),
        gapFirst: r.gapFirst,
        bestLapS: rd(r.bestLapS),
        bestLapNumber: r.bestLapNumber,
        postRacePenaltyS: null,
        resultsStatus: status === "none" ? "provisional" : status,
        source: { kind: "official", method: "D-FINISH", files: res!.fileIds, refs: r.refs },
        confidence: "high",
      };
      if (result.rawStatus === undefined) delete result.rawStatus;
      if (st === "classified" && r.totalTimeS !== null && lastRow && ctx.race.timeBase === "clock") {
        const pen = r.totalTimeS - (lastRow.endT - ctx.axis.origin);
        if (pen > 0.0015) result.postRacePenaltyS = rd(pen);
      }
    } else if (res) {
      ctx.issues.push({ severity: "warning", code: "CAR-NOT-IN-RESULTS", message: `Car '${e.car}' appears in the laps but not in the results file.`, factIds: [`car:${e.car}`] });
    }
    // class position fallback: rank within class of positionOverall
    // make (D-MAKE)
    let make = "TBD";
    let makeBasis: Entry["makeBasis"] = "none";
    let makeRaw: string | null = null;
    if (e.makeRaw) {
      const n = normaliseMake(e.makeRaw);
      make = n.make;
      makeRaw = n.raw;
      makeBasis = e.makeBasis ?? "make_column";
      if (!n.mapped) ctx.issues.push({ severity: "warning", code: "MAKE-UNMAPPED", message: `Make '${n.raw}' of car '${e.car}' is not in the alias table; kept as written.`, factIds: [`car:${e.car}`] });
      const vm = makeFromVehicle(e.vehicle);
      if (vm && vm !== make && n.mapped) ctx.issues.push({ severity: "warning", code: "MAKE-SOURCE-DISAGREE", message: `Car '${e.car}': make '${make}' from the ${makeBasis} disagrees with vehicle '${e.vehicle}'.`, factIds: [`car:${e.car}`] });
    } else {
      const vm = makeFromVehicle(e.vehicle);
      if (vm) {
        make = vm;
        makeBasis = "vehicle_alias";
      }
    }
    const entry: Entry = {
      id: `car:${e.car}`,
      car: e.car,
      class: ctx.classOf[e.car],
      team: e.team,
      make,
      makeBasis,
      makeRaw,
      vehicle: e.vehicle?.trim() || "TBD",
      drivers: e.drivers,
      result,
      source: { kind: "official", method: "D-MAKE", files: [...new Set([...(res?.fileIds ?? []), ...(ctx.laps[e.car]?.slice(0, 1).map((x) => x.fileId) ?? [])])] },
      confidence: "high",
    };
    entries.push(entry);
  }
  if (entries.some((e) => e.make === "TBD")) {
    const n = entries.filter((e) => e.make === "TBD").length;
    ctx.issues.push({ severity: "note", code: "MAKE-TBD", message: `${n} car(s) have no make in the source files (make TBD; open question Q10).` });
  }
  // class position: by-class file / class column, else rank within class of positionOverall.
  for (const c of ctx.classes) {
    const inCls = entries.filter((e) => e.class === c.id && e.result && e.result.positionOverall !== null).sort((a, b) => a.result!.positionOverall! - b.result!.positionOverall!);
    inCls.forEach((e, i) => {
      if (e.result!.positionClass === null && rowsBy.get(e.car)?.positionClassSource == null) e.result!.positionClass = i + 1;
    });
  }
  // pre-penalty positions (D-FINISH)
  const classified = entries.filter((e) => e.result?.status === "classified" && e.result.totalTimeS !== null && e.result.totalTimeS !== undefined);
  for (const e of entries) {
    const pen = e.result?.postRacePenaltyS;
    if (!pen) continue;
    const key = (x: Entry) => [-(x.result!.laps ?? 0), x.result!.totalTimeS! - (x === e ? pen : 0)] as const;
    const order = [...classified].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return ka[0] - kb[0] || ka[1] - kb[1] || carOrder(a.car, b.car);
    });
    e.result!.prePenaltyPositionOverall = order.indexOf(e) + 1;
    e.result!.prePenaltyPositionClass = order.filter((x) => x.class === e.class).indexOf(e) + 1;
  }

  // retirements (D-RETIRE)
  const retirements: Retirement[] = [];
  for (const e of entries) {
    const rows = ctx.laps[e.car] ?? [];
    if (e.result?.status === "dns" || (!rows.length && !passages.some((p) => p.car === e.car))) {
      if (e.result?.status === "dns" || !rows.length) {
        retirements.push({ id: `ret:${e.car}`, car: e.car, lastCompletedLap: 0, at: null, where: "did_not_start", passageId: null, classPosAtRetirement: null, source: { kind: "official", files: res?.fileIds ?? [] }, confidence: e.result?.status === "dns" ? "high" : "medium", ...(e.result?.status === "dns" ? {} : { confidenceNotes: ["no_laps_no_dns_status"] }) });
      }
      continue;
    }
    if (tookFlag(e.car)) continue;
    const rp = passages.filter((p) => p.car === e.car && p.outcome === "retired").sort((a, b) => a.sortT - b.sortT)[0];
    const last = rows.length ? rows[rows.length - 1] : null;
    const r: Retirement = {
      id: `ret:${e.car}`,
      car: e.car,
      lastCompletedLap: last?.lap ?? 0,
      at: rp?.pinT != null ? tp(ctx, rp.pinT) : last ? tp(ctx, last.endT) : null,
      where: rp ? (rp.kind === "garage" ? "garage" : "pit_lane") : "unknown",
      passageId: rp?.id ?? null,
      classPosAtRetirement: last?.cpos ?? null,
      source: { kind: "derived", method: "D-RETIRE", files: [...new Set([...(rp?.files ?? []), ...(last ? [last.fileId] : [])])] },
      confidence: rp ? "high" : "medium",
    };
    if (!rp) r.confidenceNotes = ["retirement_location_unknown"];
    retirements.push(r);
  }
  return { entries, retirements, resultsStatus: status, tookFlag };
}

/** Final penalty records (D-PENALTY statuses), after results and retirements are known. */
export function finalisePenalties(ctx: Ctx, allPens: PenaltyDraft[], entries: Entry[], tookFlag: (c: CarId) => boolean): Penalty[] {
  const leaderLap = leaderLapFinder(ctx);
  const byCar = new Map(entries.map((e) => [e.car, e]));
  // A post-race time penalty announced by race control ("+10 Seconds Post-Race") and printed again
  // in the results ("10 second time penalty for …") is one decision: the results line joins it.
  const dup = new Set<PenaltyDraft>();
  const joined = new Set<PenaltyDraft>();
  for (const line of allPens.filter((p) => p.postRace && p.t === null)) {
    const rc = allPens.find((x) => x.car === line.car && x.postRace && x.t !== null && x.amountS !== null && x.amountS === line.amountS && !joined.has(x));
    if (!rc) continue;
    dup.add(line);
    joined.add(rc);
    rc.refs.push(...line.refs);
    rc.files = [...new Set([...rc.files, ...line.files])];
    ctx.issues.push({ severity: "note", code: "PEN-RESULTS-SAME", message: `The results line '${line.rawText}' repeats race control's post-race penalty for car ${rc.car}; it is read as one penalty (${rc.id}).`, factIds: [rc.id], files: line.files });
  }
  const pens = allPens.filter((p) => !dup.has(p));
  // Post-race lines: link to the unserved penalty they convert.
  for (const x of pens.filter((p) => p.postRace && p.t === null)) {
    const text = x.reason.toLowerCase();
    const want = /drive[ -]?through/.test(text) ? "drive_through" : /stop\s*\+|stop plus/.test(text) ? "stop_plus" : /stop and go/.test(text) ? "stop_and_go" : null;
    const src = pens.find((p) => p.car === x.car && !p.servedBy && p.ptype === want && !pens.some((q) => q.convertedFromId === p.id && q !== x) && p !== x);
    if (src) x.convertedFromId = src.id;
  }
  const out: Penalty[] = [];
  for (const x of [...pens].sort((a, b) => carOrder(a.car, b.car) || Number(a.id.split(":")[2]) - Number(b.id.split(":")[2]))) {
    const e = byCar.get(x.car);
    let status = x.status;
    let resultsEffectS: number | null = null;
    let appliedInResults: boolean | null = null;
    const confNotes = [...x.confNotes];
    let conf = x.confidence;
    if (x.ptype === "warning") status = "warning_only";
    else if (x.servedBy) status = "served";
    else if (x.postRace) {
      status = "applied_post_race";
      const total = e?.result?.postRacePenaltyS ?? null;
      const siblings = pens.filter((q) => q.car === x.car && q.postRace);
      const sum = siblings.reduce((a, q) => a + (q.amountS ?? 0), 0);
      // Several post-race decisions for one car: each carries its own amount when they add up to the results effect.
      const eff = total !== null && siblings.length > 1 && Math.abs(sum - total) <= 0.0015 ? x.amountS : total;
      resultsEffectS = eff;
      appliedInResults = total !== null && total > 0;
      if (eff !== null && x.amountS !== null && Math.abs(eff - x.amountS) > 0.0015) {
        conf = "medium";
        confNotes.push("amount_differs_from_results");
        ctx.issues.push({
          severity: "warning",
          code: "PEN-AMOUNT-MISMATCH",
          message: `Race control announced ${x.amountS} s for car ${x.car}; the results add ${eff} s (total time minus elapsed at the last crossing). The results value is used for positions.`,
          factIds: [x.id, `result:${x.car}`],
          files: x.files,
        });
      }
    } else if (!tookFlag(x.car)) status = "unserved";
    else if ((e?.result?.postRacePenaltyS ?? 0) > 0 || pens.some((q) => q.convertedFromId === x.id)) status = "converted_post_race";
    else status = "issued";
    const p: Penalty = {
      id: x.id,
      car: x.car,
      issued: x.t !== null ? tp(ctx, x.t) : null,
      issuedLeaderLap: x.t !== null ? leaderLap(x.t) : null,
      reason: x.reason,
      penaltyType: x.ptype,
      amountS: x.amountS,
      status,
      servedByPassageId: x.servedBy?.id ?? null,
      servedConfirmed: x.servedMsgT !== null ? tp(ctx, x.servedMsgT) : null,
      appliedInResults,
      resultsEffectS,
      rawText: x.rawText,
      source: { kind: "official", method: "D-PENALTY", files: x.files, refs: [...x.refs, ...(x.servedMsgRef ? [x.servedMsgRef] : [])] },
      confidence: conf,
    };
    if (x.convertedFromId) p.convertedFromId = x.convertedFromId;
    if (confNotes.length) p.confidenceNotes = [...new Set(confNotes)];
    out.push(p);
  }
  return out;
}

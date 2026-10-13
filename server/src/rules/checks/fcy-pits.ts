/**
 * FCY pit procedure (rule type fcy_pit_procedure): pits closed under FCY, class opening order, Short FCY,
 * Emergency Service obligation, driver change in a closed pit, WRL Code 35.
 *
 * The pit-closure model per class is shared with the pit-window check (earliest legal pit, D-EARLIEST-PIT).
 */
import type { CarId, FcyPeriod, FlagEvent, PitPassage } from "../../analysis/schema/package-types.js";
import type { ResolvedRule, Severity } from "../rulebook-types.js";
import { rulebookClassFor } from "../load-rulebook.js";
import type { CheckHandler, CheckInput, CheckOutput, FindingDraft } from "./common.js";
import { emptyOutput, ev, isTbd, minConf, num, param, passOf, raceControlFor } from "./common.js";
import type { RaceCtx } from "./context.js";
import { r3 } from "./context.js";

const CLOSED_PIT_PENALTY =
  /clos|emergency|pit (lane )?(entry|entrance)|under (fcy|yellow|caution)|code ?35/i;

export type ClosureReason = "closed" | "short" | "class_order";

export interface ClosedInterval {
  fromS: number;
  toS: number;
  period: FcyPeriod;
  reason: ClosureReason;
  /** The start of the closure depends on a TBD rule value. */
  ambiguous: boolean;
  flagIds: string[];
  ruleId: string;
}

export interface PeriodInfo {
  period: FcyPeriod;
  endS: number;
  short: boolean;
  shortFlagIds: string[];
  standardAllowed: boolean;
}

function findRule(rules: Map<string, ResolvedRule>, key: string): ResolvedRule | null {
  for (const r of rules.values()) {
    if (r.type === "fcy_pit_procedure" && !r.disabled && param(r, key) !== undefined)
      return r;
  }
  return null;
}

export function coreClosureRule(rules: Map<string, ResolvedRule>) {
  return findRule(rules, "pits_closed_on");
}

/** Classify every FCY period: Short FCY (RC "SHORT YELLOW" or outside the Standard-FCY time) or standard. */
export function classifyPeriods(
  ctx: RaceCtx,
  rules: Map<string, ResolvedRule>
): PeriodInfo[] {
  const noStd = findRule(rules, "no_standard_fcy_within_s_of_start");
  const withinStart = noStd ? num(noStd, "no_standard_fcy_within_s_of_start") : null;
  const withinFinish = noStd ? num(noStd, "no_standard_fcy_within_s_of_finish") : null;
  const dur = ctx.publishedDurationS;
  return ctx.fcy.map((f) => {
    const endS = f.endsAtFinish ? Infinity : f.end.raceTimeS;
    const msgs = ctx
      .flagsIn("message", f.start.raceTimeS, Math.min(endS, ctx.chequeredS + 600))
      .filter((m) => /short\s*(yellow|fcy)/i.test(m.message ?? ""));
    let standardAllowed = true;
    if (withinStart !== null && f.start.raceTimeS < withinStart) standardAllowed = false;
    if (withinFinish !== null && dur !== null && f.start.raceTimeS > dur - withinFinish)
      standardAllowed = false;
    return {
      period: f,
      endS,
      short: msgs.length > 0 || !standardAllowed,
      shortFlagIds: msgs.map((m) => m.id),
      standardAllowed,
    };
  });
}

function scopeMatches(ctx: RaceCtx, flag: FlagEvent, pkgClass: string | null): boolean {
  const cl = (flag.classes ?? []).filter((c) => !/^all( cars)?$/i.test(c));
  if (!cl.length) return true;
  if (!pkgClass) return false;
  const want = rulebookClassFor(ctx.rulebook, pkgClass) ?? pkgClass;
  return cl.some(
    (c) => (rulebookClassFor(ctx.rulebook, c) ?? c).toLowerCase() === want.toLowerCase()
  );
}

function isAllScope(flag: FlagEvent): boolean {
  return !(flag.classes ?? []).some((c) => !/^all( cars)?$/i.test(c));
}

/** Pits-open announcements inside a period (after its start, up to its end). */
function opensIn(ctx: RaceCtx, p: PeriodInfo): FlagEvent[] {
  return ctx.flagsIn("pits_open", p.period.start.raceTimeS + 1e-6, p.endS);
}

/** Opening sequence groups (e.g. [GS], [TCR], all) with their open time inside a period. */
function sequenceTimes(ctx: RaceCtx, seqRule: ResolvedRule, p: PeriodInfo) {
  const seq = (param<unknown[]>(seqRule, "opening_sequence") ?? []) as {
    classes: string[] | "all";
  }[];
  const opens = opensIn(ctx, p);
  return seq.map((g) => {
    const all =
      g.classes === "all" ||
      (Array.isArray(g.classes) && g.classes.some((c) => /^all$/i.test(c)));
    const f = opens.find((o) =>
      all
        ? isAllScope(o)
        : !isAllScope(o) &&
          (o.classes ?? []).some((c) =>
            (g.classes as string[]).some(
              (gc) =>
                (rulebookClassFor(ctx.rulebook, c) ?? c).toLowerCase() ===
                gc.toLowerCase()
            )
          )
    );
    return { classes: all ? ("all" as const) : (g.classes as string[]), flag: f ?? null };
  });
}

/**
 * Pit-closure intervals for one class (D-EARLIEST-PIT): pits closed from the FCY announcement (or the RC
 * message, per `pits_closed_on`) until opened for the class; Short FCY closed until the restart; class order.
 */
export function closureIntervals(
  ctx: RaceCtx,
  rules: Map<string, ResolvedRule>,
  pkgClass: string | null
): { intervals: ClosedInterval[]; notes: string[] } {
  const core = coreClosureRule(rules);
  const shortRule = findRule(rules, "short_fcy_if");
  const seqRule = findRule(rules, "opening_sequence");
  const out: ClosedInterval[] = [];
  const notes: string[] = [];
  const rbClass = pkgClass ? rulebookClassFor(ctx.rulebook, pkgClass) : null;
  for (const p of classifyPeriods(ctx, rules)) {
    const f = p.period;
    const start = f.start.raceTimeS;
    if (p.short && shortRule) {
      const open = opensIn(ctx, p).find(isAllScope);
      out.push({
        fromS: start,
        toS: open ? open.at.raceTimeS : p.endS,
        period: f,
        reason: "short",
        ambiguous: false,
        flagIds: [...p.shortFlagIds, ...(open ? [open.id] : [])],
        ruleId: shortRule.id,
      });
      continue;
    }
    if (!core) continue;
    const on = param(core, "pits_closed_on");
    const closedMsg =
      ctx
        .flagsIn("pits_closed", start - 1e-6, p.endS)
        .find((m) => scopeMatches(ctx, m, pkgClass)) ?? null;
    const opens = opensIn(ctx, p);
    // With a class opening sequence the core closure ends at the first opening of any scope; the sequence rule
    // covers the class-specific laps after it. Without one, the closure ends when the car's class is opened.
    const open = seqRule
      ? (opens[0] ?? null)
      : (opens.find((o) => scopeMatches(ctx, o, pkgClass)) ?? null);
    const toS = open ? open.at.raceTimeS : p.endS;
    const flagIds = [...(closedMsg ? [closedMsg.id] : []), ...(open ? [open.id] : [])];
    if (on === "fcy_announcement") {
      out.push({
        fromS: start,
        toS,
        period: f,
        reason: "closed",
        ambiguous: false,
        flagIds,
        ruleId: core.id,
      });
    } else if (isTbd(on)) {
      const certainFrom = closedMsg ? Math.max(start, closedMsg.at.raceTimeS) : toS;
      if (certainFrom > start)
        out.push({
          fromS: start,
          toS: Math.min(certainFrom, toS),
          period: f,
          reason: "closed",
          ambiguous: true,
          flagIds,
          ruleId: core.id,
        });
      if (certainFrom < toS)
        out.push({
          fromS: certainFrom,
          toS,
          period: f,
          reason: "closed",
          ambiguous: false,
          flagIds,
          ruleId: core.id,
        });
    } else if (closedMsg) {
      out.push({
        fromS: closedMsg.at.raceTimeS,
        toS,
        period: f,
        reason: "closed",
        ambiguous: false,
        flagIds,
        ruleId: core.id,
      });
    }
    if (seqRule && !p.short) {
      const seq = sequenceTimes(ctx, seqRule, p);
      if (seq.some((g) => !g.flag)) {
        notes.push(`opening_sequence_incomplete:${f.id}`);
        continue;
      }
      const mine = seq.findIndex(
        (g) =>
          g.classes === "all" ||
          (rbClass !== null &&
            g.classes.some((c) => c.toLowerCase() === rbClass.toLowerCase()))
      );
      for (let j = 0; j < seq.length - 1; j++) {
        if (j === mine) continue;
        const a = seq[j].flag!.at.raceTimeS;
        const b = seq[j + 1].flag!.at.raceTimeS;
        // before this class's own opening the core closure already applies (it ends at the first opening)
        if (b > a)
          out.push({
            fromS: a,
            toS: b,
            period: f,
            reason: "class_order",
            ambiguous: false,
            flagIds: [seq[j].flag!.id, seq[j + 1].flag!.id],
            ruleId: seqRule.id,
          });
      }
    }
  }
  return { intervals: out, notes };
}

/** Pit passages that can be judged against FCY pit closure. */
function candidatePassages(ctx: RaceCtx, car: CarId): PitPassage[] {
  return (ctx.passages.get(car) ?? []).filter(
    (p) => p.pitIn !== null && p.kind !== "pit_lane_start"
  );
}

export interface ClosedEntry {
  passage: PitPassage;
  interval: ClosedInterval;
}

export function closedPitEntries(
  ctx: RaceCtx,
  rules: Map<string, ResolvedRule>,
  cars: CarId[],
  reasons: ClosureReason[]
) {
  const entries: ClosedEntry[] = [];
  const notes = new Set<string>();
  /** Every race pit entry judged, with the closure interval it fell in (null = pits open for the car). */
  const considered: { passage: PitPassage; interval: ClosedInterval | null }[] = [];
  for (const car of cars) {
    const { intervals, notes: n } = closureIntervals(ctx, rules, ctx.classOf(car));
    n.forEach((x) => notes.add(x));
    for (const p of candidatePassages(ctx, car)) {
      const t = p.pitIn!.raceTimeS;
      if (t >= ctx.chequeredS) continue; // entered after the chequered flag: not a race pit entry
      const hit = intervals.find(
        (iv) => reasons.includes(iv.reason) && iv.fromS <= t && t < iv.toS
      );
      considered.push({ passage: p, interval: hit ?? null });
      if (hit) entries.push({ passage: p, interval: hit });
    }
  }
  return { entries, notes: [...notes], considered };
}

function didNotRejoin(p: PitPassage): boolean {
  return (
    p.kind === "retirement" ||
    (p.kind === "garage" && p.outcome !== "rejoined") ||
    p.outcome === "retired"
  );
}

function entryFinding(
  ctx: RaceCtx,
  rule: ResolvedRule,
  e: ClosedEntry,
  extraNotes: string[] = []
): FindingDraft {
  const p = e.passage;
  const t = p.pitIn!.raceTimeS;
  const notes = [...extraNotes, `closure_${e.interval.reason}`];
  let severity: Severity = rule.severity;
  const sevNotes: string[] = [];
  if (didNotRejoin(p)) {
    severity = "info";
    sevNotes.push("car_did_not_rejoin");
  }
  if (e.interval.ambiguous) {
    severity = "info";
    sevNotes.push("pit_closure_start_unknown");
  }
  const grace = num(rule, "grace_s_for_committed_cars");
  if (grace !== null && t - e.interval.period.start.raceTimeS <= grace)
    notes.push("within_grace_of_fcy_announcement");
  return {
    car: p.car,
    severity,
    severityNotes: sevNotes,
    lap: p.inLap,
    clock: p.pitIn!.clock ?? ctx.clock(t),
    raceTimeS: t,
    measured: r3(t),
    measuredRange: null,
    limit: Number.isFinite(e.interval.toS) ? r3(e.interval.toS) : null,
    margin: Number.isFinite(e.interval.toS) ? r3(t - e.interval.toS) : null,
    unit: "s",
    evidence: [
      ...ev("passage", p.id),
      ...ev("fcy_period", e.interval.period.id),
      ...e.interval.flagIds.map((id) => ({ label: "race_control_flag", factId: id })),
    ],
    raceControl: raceControlFor(ctx, p.car, CLOSED_PIT_PENALTY, t - 1),
    confidence: minConf(p.confidence, e.interval.period.confidence),
    notes,
  };
}

function requireFlagsFile(ctx: RaceCtx) {
  if (!ctx.fcyFromFlags)
    return {
      notCheckable: {
        reason: "data_missing" as const,
        detail: "fcy_periods_not_from_flags_file",
      },
    };
  return null;
}

function runEntries(
  input: CheckInput,
  reasons: ClosureReason[],
  extra: (o: CheckOutput) => void = () => {}
): CheckOutput {
  const { ctx, rule, rules, cars } = input;
  const out = emptyOutput();
  const { notes, considered } = closedPitEntries(ctx, rules, cars, reasons);
  out.notes.push(...notes);
  for (const c of considered) {
    const p = c.passage;
    if (c.interval) out.results.push(entryFinding(ctx, rule, { passage: p, interval: c.interval }));
    else
      out.results.push(
        passOf({
          car: p.car,
          lap: p.inLap,
          clock: p.pitIn!.clock ?? ctx.clock(p.pitIn!.raceTimeS),
          raceTimeS: p.pitIn!.raceTimeS,
          evidence: ev("passage", p.id),
          confidence: minConf(p.confidence),
          notes: ["pit_lane_open_at_entry"],
        })
      );
  }
  extra(out);
  return out;
}

export const pitsClosedHandler: CheckHandler = {
  name: "fcy_pits_closed",
  required: () => [],
  run: (input) => {
    const nc = requireFlagsFile(input.ctx);
    if (nc) return nc;
    return runEntries(input, ["closed"], (o) => {
      if (findRule(input.rules, "short_fcy_if"))
        o.notes.push("short_fcy_periods_evaluated_by_short_fcy_rule");
      if (isTbd(param(input.rule, "pits_closed_on")))
        o.notes.push("pits_closed_on_tbd_entries_before_rc_message_are_info");
    });
  },
};

export const classOrderHandler: CheckHandler = {
  name: "fcy_class_opening_order",
  required: () => ["opening_sequence"],
  run: (input) => requireFlagsFile(input.ctx) ?? runEntries(input, ["class_order"]),
};

export const shortFcyHandler: CheckHandler = {
  name: "fcy_short_closed_until_restart",
  required: () => [],
  run: (input) =>
    requireFlagsFile(input.ctx) ??
    runEntries(input, ["short"], (o) =>
      o.notes.push("short_fcy_if_restart_window_not_parsed_rc_short_yellow_used")
    ),
};

/** No finding of its own: classifies FCY periods for the Short FCY rule. */
export const standardFcyClassifier: CheckHandler = {
  name: "fcy_standard_classifier",
  required: () => [
    "no_standard_fcy_within_s_of_start",
    "no_standard_fcy_within_s_of_finish",
  ],
  run: ({ ctx, rules }) => {
    const out = emptyOutput();
    const ps = classifyPeriods(ctx, rules);
    // writes no rule checks: its classification feeds the Short FCY rule and the pit-closure model
    out.notes.push(
      "classifier_only",
      ...ps.map(
        (p) =>
          `${p.period.id}:${p.standardAllowed ? "standard_allowed" : "standard_not_in_effect"}`
      )
    );
    return out;
  },
};

/** ISR 46.3.1.A.ii: a car serviced in a closed pit owes a drive-through after the pits open. */
export const emergencyServiceHandler: CheckHandler = {
  name: "fcy_emergency_service_obligation",
  required: () => ["obligation_met_if_in_pit_lane_leader_laps"],
  run: (input) => {
    const { ctx, rule, rules, cars } = input;
    const nc = requireFlagsFile(ctx);
    if (nc) return nc;
    const out = emptyOutput();
    const needLaps = num(rule, "obligation_met_if_in_pit_lane_leader_laps") ?? 2;
    const { entries } = closedPitEntries(ctx, rules, cars, [
      "closed",
      "short",
      "class_order",
    ]);
    for (const e of entries) {
      const p = e.passage;
      if (didNotRejoin(p) || !p.pitOut) continue;
      const inT = p.pitIn!.raceTimeS;
      const outT = p.pitOut.raceTimeS;
      const leaderLapsInPit = ctx.leaderCrossings.filter(
        (t) => t > inT && t < outT
      ).length;
      const base = {
        car: p.car,
        lap: p.inLap,
        clock: p.pitIn!.clock ?? ctx.clock(inT),
        raceTimeS: inT,
        confidence: minConf(p.confidence),
      };
      if (leaderLapsInPit >= needLaps) {
        out.results.push(
          passOf({
            ...base,
            measured: leaderLapsInPit,
            limit: needLaps,
            margin: leaderLapsInPit - needLaps,
            unit: "laps",
            evidence: [
              ...ev("closed_pit_passage", p.id),
              ...ev("fcy_period", e.interval.period.id),
            ],
            notes: ["obligation_met_in_pit_lane_leader_laps"],
          })
        );
        continue;
      }
      // obligation window opens when the pits are open to every class group but "all" (TCR at IMSA), or the restart
      const opens = ctx.flagsIn(
        "pits_open",
        e.interval.period.start.raceTimeS,
        e.interval.period.endsAtFinish ? Infinity : e.interval.period.end.raceTimeS
      );
      const classOpens = opens.filter((o) => !isAllScope(o));
      const from = classOpens.length
        ? classOpens[classOpens.length - 1].at.raceTimeS
        : (opens[0]?.at.raceTimeS ?? e.interval.toS);
      const restart = e.interval.period.endsAtFinish
        ? null
        : e.interval.period.end.raceTimeS;
      if (restart === null) {
        out.notEvaluated.push({ car: p.car, factId: p.id, reason: "fcy_ran_to_finish" });
        continue;
      }
      const after = ctx.leaderCrossings.filter((t) => t >= restart);
      const deadline = after.length >= 2 ? after[1] : null;
      if (deadline === null) {
        out.notEvaluated.push({
          car: p.car,
          factId: p.id,
          reason: "no_leader_crossings_after_restart",
        });
        continue;
      }
      const nxt = (ctx.passages.get(p.car) ?? []).find(
        (q) => q.ordinal > p.ordinal && q.pitIn && q.pitIn.raceTimeS >= from
      );
      const evidence = [
        ...ev("closed_pit_passage", p.id),
        ...ev("follow_up_passage", nxt?.id),
        ...ev("fcy_period", e.interval.period.id),
      ];
      if (nxt && nxt.pitIn!.raceTimeS <= deadline) {
        out.results.push(
          passOf({
            ...base,
            measured: r3(nxt.pitIn!.raceTimeS),
            limit: r3(deadline),
            margin: r3(deadline - nxt.pitIn!.raceTimeS),
            unit: "s",
            evidence,
            notes: ["follow_up_passage_before_deadline"],
          })
        );
        continue;
      }
      out.results.push({
        ...base,
        severity: rule.severity,
        severityNotes: [],
        measured: nxt ? r3(nxt.pitIn!.raceTimeS) : null,
        measuredRange: null,
        limit: r3(deadline),
        margin: nxt ? r3(deadline - nxt.pitIn!.raceTimeS) : null,
        unit: "s",
        evidence,
        raceControl: raceControlFor(ctx, p.car, CLOSED_PIT_PENALTY, inT - 1),
        notes: [
          "applies_only_if_closed_pit_entry_was_emergency_service",
          ...(nxt ? [] : ["no_follow_up_passage"]),
        ],
      });
    }
    return out;
  },
};

/** ISR 12.11.2: driver change in a closed pit that is not Emergency Service. */
export const closedPitDriverChangeHandler: CheckHandler = {
  name: "fcy_closed_pit_driver_change",
  required: () => [],
  run: (input) => {
    const { ctx, rule, rules, cars } = input;
    const nc = requireFlagsFile(ctx);
    if (nc) return nc;
    const out = emptyOutput();
    const { entries } = closedPitEntries(ctx, rules, cars, [
      "closed",
      "short",
      "class_order",
    ]);
    for (const e of entries) {
      const p = e.passage;
      if (p.driverIn == null || p.driverOut == null) {
        out.notEvaluated.push({
          car: p.car,
          factId: p.id,
          reason: "driver_in_out_unknown",
        });
        continue;
      }
      if (p.driverIn === p.driverOut) {
        out.results.push(
          passOf({
            car: p.car,
            lap: p.inLap,
            clock: p.pitIn!.clock ?? ctx.clock(p.pitIn!.raceTimeS),
            raceTimeS: p.pitIn!.raceTimeS,
            evidence: [
              ...ev("passage", p.id),
              ...ev("fcy_period", e.interval.period.id),
            ],
            confidence: minConf(p.confidence),
            notes: [`no_driver_change_driver_${p.driverIn}`],
          })
        );
        continue;
      }
      const f = entryFinding(ctx, rule, e, [
        "driver_change_in_closed_pit",
        `driver_change_${p.driverIn}_to_${p.driverOut}`,
      ]);
      f.measured = null;
      f.limit = null;
      f.margin = null;
      f.unit = null;
      out.results.push(f);
    }
    return out;
  },
};

/** WRL Code 35: if pits are closed under Code 35, any passage whose in-lap overlaps an FCY period. */
export const code35Handler: CheckHandler = {
  name: "fcy_code35_pits",
  required: () => ["pits_open_under_code35"],
  run: ({ ctx, rule, cars }) => {
    const out = emptyOutput();
    const open = param(rule, "pits_open_under_code35");
    for (const car of cars) {
      for (const p of ctx.passages.get(car) ?? []) {
        if (p.kind === "pit_lane_start") continue;
        const lap = ctx.lap(car, p.inLap);
        const base = {
          car,
          lap: p.inLap,
          clock: p.pitIn?.clock ?? (lap ? ctx.clock(lap.endS) : null),
          raceTimeS: p.pitIn?.raceTimeS ?? lap?.endS ?? null,
          evidence: [
            ...ev("passage", p.id),
            ...(p.fcyPeriodIds ?? []).map((id) => ({ label: "fcy_period", factId: id })),
            ...ev("in_lap", `lap:${car}:${p.inLap}`),
          ],
          confidence: minConf(p.confidence, ctx.fcyFromFlags ? "high" : "medium"),
        };
        const notes = [
          `in_lap_${p.fcyContext}`,
          ...(ctx.fcyFromFlags
            ? []
            : ["fcy_periods_reconstructed_boundaries_plus_minus_one_lap"]),
        ];
        if (open === true || p.fcyContext === "green") {
          out.results.push(passOf({ ...base, notes }));
          continue;
        }
        out.results.push({
          ...base,
          severity: rule.severity,
          severityNotes: [],
          measured: null,
          measuredRange: null,
          limit: null,
          margin: null,
          unit: null,
          raceControl: raceControlFor(ctx, car, CLOSED_PIT_PENALTY),
          notes,
        });
      }
    }
    return out;
  },
};

export type { PitPassage };

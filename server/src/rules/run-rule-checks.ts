/**
 * runRuleChecks(factsPackage, rulebook) -> { ruleChecks[], ruleMarkers[], ruleCoverage, rulebook }
 *
 * Code computes facts, the rulebook states the rules (stage2/rules/RULEBOOK_FORMAT.md), and this module runs
 * every rule the rulebook defines a check for against the facts. It writes one `RuleCheck` (schema 1.1.0) per
 * rule and subject evaluated, passes included: numbers, subject fact ids, the citation, the severity ceiling and
 * the race-control linkage, never prose. `ruleFindings[]` are written later by the Claude pass from these checks.
 *
 * Every rule is either run (`ruleCoverage.run`) or listed in `ruleCoverage.notCheckable` with the reason (TBD
 * value, data the timing format does not carry, context-only rule, or not implemented in v1). Nothing is evaluated
 * against a guessed value (R4).
 */
import type {
  CarId,
  FactId,
  RaceAnalysisPackage,
  RuleCheck,
  RuleCoverageRun,
  RuleMarker,
  RuleNotCheckable,
} from "../analysis/schema/package-types.js";
import type { ResolvedRule, Rulebook } from "./rulebook-types.js";
import {
  resolveRulebook,
  resolveRulesForClass,
  selectEvent,
  selectSession,
} from "./load-rulebook.js";
import type { CheckStatus, Citation, RuleCheckResult, SubjectDraft } from "./types.js";
import type {
  CheckHandler,
  CheckInput,
  CheckOutput,
  NotCheckableOut,
} from "./checks/common.js";
import { capSeverity, citations, isTbd, param } from "./checks/common.js";
import { carOrder, RaceCtx } from "./checks/context.js";
import { maxDriveTimeHandler, minDriveTimeHandler } from "./checks/drive-time.js";
import {
  classOrderHandler,
  closedPitDriverChangeHandler,
  code35Handler,
  emergencyServiceHandler,
  pitsClosedHandler,
  shortFcyHandler,
  standardFcyClassifier,
} from "./checks/fcy-pits.js";
import { maxStintHandler, minBreakHandler } from "./checks/max-stint.js";
import {
  greenCrossingsHandler,
  incompleteRaceHandler,
  minDistanceHandler,
  resultsOrderHandler,
} from "./checks/penalty-classification.js";
import { minPitTimeHandler, pitWindowHandler } from "./checks/pit-stops.js";

export interface RunOptions {
  /** Event key in the rulebook; when omitted it is matched from the package's track and race date. */
  eventKey?: string | null;
  /** Session key in the event (published duration, scheduled start); matched by race date when omitted. */
  sessionKey?: string | null;
  /** Skip the event layer even when one matches. */
  noEvent?: boolean;
}

/** Rules whose params do not say which check they are; their semantics are specific to the rule. */
const ID_HANDLERS: Record<string, CheckHandler> = {
  "mpc.fcy.driver_change_in_closed_pit": closedPitDriverChangeHandler,
};

/** Pick the check for a resolved rule, by type and the params that define it. */
function handlerFor(rule: ResolvedRule): CheckHandler | null {
  if (ID_HANDLERS[rule.id]) return ID_HANDLERS[rule.id];
  const has = (k: string) => param(rule, k) !== undefined;
  switch (rule.type) {
    case "pit_window":
      return pitWindowHandler;
    case "min_pit_time":
      return minPitTimeHandler;
    case "min_drive_time_per_driver":
      return minDriveTimeHandler;
    case "max_drive_time_per_driver":
      return maxDriveTimeHandler;
    case "max_stint":
      if (has("min_break_s")) return minBreakHandler;
      if (has("value_s") || has("value_laps")) return maxStintHandler;
      return null;
    case "fcy_pit_procedure":
      if (has("pits_closed_on")) return pitsClosedHandler;
      if (has("opening_sequence")) return classOrderHandler;
      if (has("short_fcy_if")) return shortFcyHandler;
      if (has("no_standard_fcy_within_s_of_start")) return standardFcyClassifier;
      if (has("obligation_met_if_in_pit_lane_leader_laps"))
        return emergencyServiceHandler;
      if (has("pits_open_under_code35")) return code35Handler;
      return null;
    case "penalty_service":
      return has("max_green_crossings") ? greenCrossingsHandler : null;
    case "classification": {
      const mf = param(rule, "min_fraction");
      if (mf === "none") return has("order_by") ? resultsOrderHandler : null;
      if (mf && typeof mf === "object" && (mf as { of?: string }).of === "scheduled")
        return incompleteRaceHandler;
      return has("min_fraction") ? minDistanceHandler : null;
    }
    default:
      return null;
  }
}

/** Severity notes that leave the outcome in doubt (measurement bounds, unknown rule value or attribution). */
const UNKNOWN_CODES = new Set([
  "only_upper_bound_exceeds",
  "only_lower_bound_below_minimum",
  "within_measurement_tolerance",
  "pit_closure_start_unknown",
  "fcy_effect_on_window_unknown",
  "driver_attribution_low_confidence",
]);
/** Severity notes that say the rule does not bind this subject. */
const NOT_APPLICABLE_CODES = new Set([
  "car_below_race_time_fraction_exempt",
  "car_did_not_rejoin",
]);

/** Status of a subject: pass, or for a non-pass outcome fail / unknown / not_applicable from its severity notes. */
export function statusOf(d: Pick<SubjectDraft, "status" | "severityNotes">): CheckStatus {
  if (d.status) return d.status;
  if (d.severityNotes.some((n) => NOT_APPLICABLE_CODES.has(n))) return "not_applicable";
  if (d.severityNotes.some((n) => UNKNOWN_CODES.has(n))) return "unknown";
  return "fail";
}

/** Why a rule with no handler is not checked, read from the rule's own check text. */
function noHandlerReason(rule: ResolvedRule): {
  reason: RuleNotCheckable["reason"];
  detail: string;
} {
  const c = rule.check.trim();
  if (/^not_evaluated\(/.test(c))
    return {
      reason: "data_missing",
      detail: c.split("\n")[0].replace(/^not_evaluated\("?|"?\).*$/g, ""),
    };
  if (/^Evaluated inside\s+([\w.]+)/.test(c))
    return {
      reason: "evaluated_by_other_rule",
      detail: /^Evaluated inside\s+([\w.]+)/.exec(c)![1],
    };
  // A check that can EMIT something but has no v1 implementation is reported as such, not as context.
  if (/\bEMIT\(/.test(c))
    return {
      reason: "not_implemented",
      detail: `rule_type_${rule.type}_not_in_v1_checks`,
    };
  if (/no finding|^context|classification aid/i.test(c) || rule.type === "advisory")
    return { reason: "context_only", detail: "no_finding_by_design" };
  return { reason: "not_implemented", detail: `rule_type_${rule.type}_not_in_v1_checks` };
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

function requiredPaths(h: CheckHandler, rule: ResolvedRule): { missing: string[] } {
  const req = h.required(rule);
  if (Array.isArray(req)) {
    const missing = req.filter(
      (p) => param(rule, p) === undefined || isTbd(param(rule, p))
    );
    // report a TBD parent once, not every field under it
    return {
      missing: missing.filter((p) => !missing.some((q) => p.startsWith(`${q}.`))),
    };
  }
  const ok = req.anyOf.some(
    (p) => param(rule, p) !== undefined && !isTbd(param(rule, p))
  );
  return { missing: ok ? [] : req.anyOf };
}

/** A value used by the check that comes from a layer whose quote is TBD (document not obtained), R4 / §4. */
function unsourcedPaths(rule: ResolvedRule, used: string[]): string[] {
  const out: string[] = [];
  for (const p of used) {
    const full = `params.${p}`;
    const setter = [...rule.provenance]
      .reverse()
      .find((l) =>
        l.setsParams.some(
          (s) => s === full || s.startsWith(`${full}.`) || full.startsWith(`${s}.`)
        )
      );
    if (setter && setter.quote === "TBD" && !isTbd(param(rule, p))) out.push(full);
  }
  return out;
}

function inScope(rule: ResolvedRule, ctx: RaceCtx, car: CarId): boolean {
  const cl = rule.appliesTo.classes;
  if (!cl || cl === "all") return true;
  const rb = ctx.rbClassOf(car);
  const raw = ctx.classOf(car);
  return cl.some((c) => c === rb || c === raw);
}

/**
 * Run every rule of the rulebook against a facts package.
 * The rulebook is resolved per class (series -> class -> event -> event-class); classes whose resolved rule
 * is identical are checked together.
 */
export function runRuleChecks(
  pkg: RaceAnalysisPackage,
  rulebook: Rulebook,
  opts: RunOptions = {}
): RuleCheckResult {
  const md = pkg.metadata;
  const eventKey = opts.noEvent
    ? null
    : selectEvent(rulebook, {
        eventKey: opts.eventKey ?? null,
        track: md.track?.id ?? null,
        date: md.raceDate ?? null,
        eventName: md.event ?? null,
      });
  const ev = eventKey ? rulebook.events?.[eventKey] : undefined;
  const session = selectSession(ev, {
    sessionKey: opts.sessionKey ?? null,
    date: md.raceDate ?? null,
  });
  const resolved = resolveRulebook(rulebook, {
    eventKey,
    sessionKey: session?.key ?? null,
  });
  const ctx = new RaceCtx(pkg, rulebook, {
    publishedDurationS:
      typeof session?.duration_s === "number" ? session.duration_s : null,
    scheduledStart:
      session?.scheduled_start && session.scheduled_start !== "TBD"
        ? session.scheduled_start
        : null,
  });
  const docs = new Map(
    [...resolved.documents].map(([id, d]) => [
      id,
      { title: d.title, version: d.version, date: d.date, obtained: d.obtained },
    ])
  );

  // Group cars by rulebook class; cars whose class the rulebook does not list get the series (+ event) layers.
  const cars = ctx.allCars();
  const classRules = new Map<string, Map<string, ResolvedRule>>();
  const carsByClass = new Map<string, CarId[]>();
  for (const car of cars) {
    const rb = ctx.rbClassOf(car) ?? "";
    if (!classRules.has(rb))
      classRules.set(
        rb,
        rb ? resolved.byClass.get(rb)! : resolveRulesForClass(rulebook, eventKey, null)
      );
    carsByClass.set(rb, [...(carsByClass.get(rb) ?? []), car]);
  }

  const drafts: {
    ruleId: string;
    rule: ResolvedRule;
    handler: string;
    order: number;
    group: number;
    citation: Citation;
    field: string;
    draft: SubjectDraft;
  }[] = [];
  const markerDrafts: {
    ruleId: string;
    car: CarId;
    lap: number | null;
    raceTimeS: number;
  }[] = [];
  const run: (RuleCoverageRun & { _group: number })[] = [];
  const notCheckable: RuleNotCheckable[] = [];
  const ruleIds = [
    ...new Set([
      ...rulebook.rules.map((r) => r.id),
      ...[...classRules.values()].flatMap((m) => [...m.keys()]),
    ]),
  ];
  const nc0 = (
    ruleId: string,
    classes: string[],
    reason: RuleNotCheckable["reason"],
    detail: string,
    tbd: { field: string; question: string }[]
  ) =>
    notCheckable.push({
      ruleId,
      reason,
      detail,
      ...(classes.length ? { classes } : {}),
      ...(tbd.length ? { tbd: tbd.map((x) => ({ field: x.field, question: x.question })) } : {}),
    });

  ruleIds.forEach((ruleId, ruleOrder) => {
    // class groups with an identical resolved rule
    const groups = new Map<
      string,
      {
        rule: ResolvedRule;
        rules: Map<string, ResolvedRule>;
        classes: string[];
        cars: CarId[];
      }
    >();
    for (const [cls, rules] of classRules) {
      const rule = rules.get(ruleId);
      if (!rule) continue;
      const key = canonical(rule);
      const g = groups.get(key) ?? { rule, rules, classes: [], cars: [] };
      g.classes.push(cls || "(unlisted)");
      g.cars.push(...(carsByClass.get(cls) ?? []).filter((c) => inScope(rule, ctx, c)));
      groups.set(key, g);
    }
    if (!groups.size) {
      if (rulebook.rules.some((x) => x.id === ruleId))
        nc0(ruleId, [], "no_cars_in_scope", "no_cars_in_race", []);
      return;
    }
    for (const g of groups.values()) {
      const { rule } = g;
      g.cars.sort(carOrder);
      const nc = (reason: RuleNotCheckable["reason"], detail: string, tbd = rule.tbd) =>
        nc0(ruleId, g.classes, reason, detail, tbd);
      if (rule.disabled) {
        nc("disabled", "disabled_by_override", []);
        continue;
      }
      if (!g.cars.length) {
        nc("no_cars_in_scope", "applies_to_classes_not_in_race", []);
        continue;
      }
      const fmt = ctx.format;
      const fields = fmt ? rule.checkableWith[fmt] : undefined;
      if (!fmt || !fields || !fields.length) {
        nc(
          "format_not_checkable",
          `checkable_with.${fmt ?? md.sourceFormat ?? "unknown"}`,
          []
        );
        continue;
      }
      const h = handlerFor(rule);
      if (!h) {
        const tbdParams = rule.tbd.filter((t) => t.field.startsWith("params."));
        if (tbdParams.length)
          nc(
            "tbd_value",
            [...new Set(tbdParams.map((t) => t.field))].join(","),
            tbdParams
          );
        else {
          const why = noHandlerReason(rule);
          nc(why.reason, why.detail, []);
        }
        continue;
      }
      const { missing } = requiredPaths(h, rule);
      if (missing.length) {
        const fieldsMissing = missing.map((m) => `params.${m}`);
        const qs = rule.tbd.filter((t) =>
          fieldsMissing.some(
            (f) => f === t.field || f.startsWith(`${t.field}.`) || t.field.startsWith(f)
          )
        );
        nc("tbd_value", fieldsMissing.join(","), qs.length ? qs : rule.tbd);
        continue;
      }
      const req = h.required(rule);
      const unsourced = unsourcedPaths(rule, Array.isArray(req) ? req : req.anyOf);
      if (unsourced.length) {
        nc(
          "unsourced_value",
          unsourced.join(","),
          rule.tbd.filter((t) => t.field === "quote")
        );
        continue;
      }
      const input: CheckInput = {
        ctx,
        rule,
        rules: g.rules,
        cars: g.cars,
        classes: g.classes,
      };
      const res: CheckOutput | NotCheckableOut = h.run(input);
      if ("notCheckable" in res) {
        nc(res.notCheckable.reason, res.notCheckable.detail, res.notCheckable.tbd ?? []);
        continue;
      }
      const { citation } = citations(ctx, rule, docs);
      const reqPaths = Array.isArray(req) ? req : req.anyOf.filter((p) => param(rule, p) !== undefined);
      const field = `rules[${ruleId}]${reqPaths.length ? `.params.${reqPaths[0]}` : ""}`;
      const group = run.length;
      for (const d of res.results)
        drafts.push({ ruleId, rule, handler: h.name, order: ruleOrder, group, citation, field, draft: d });
      for (const m of res.markers ?? []) markerDrafts.push({ ruleId, ...m });
      run.push({
        ruleId,
        checks: 0,
        classes: g.classes,
        verified: rule.verified,
        ...(res.notEvaluated.length
          ? {
              notEvaluated: res.notEvaluated.map((n) => ({
                car: n.car,
                ...(n.factId ? { factId: n.factId } : {}),
                reason: n.reason,
              })),
            }
          : {}),
        ...(res.notes.length ? { notes: res.notes } : {}),
        _group: group,
      });
    }
  });

  // ── checks: rule order, then car order; emission (race) order inside a car ──────────────────────
  const sorted = drafts
    .map((d, i) => ({ ...d, i }))
    .sort(
      (a, b) => a.order - b.order || carOrder(a.draft.car ?? "", b.draft.car ?? "") || a.i - b.i
    );
  const seq = new Map<string, number>();
  const ruleChecks: RuleCheck[] = [];
  for (const x of sorted) {
    const d = x.draft;
    const status = statusOf(d);
    const carKey = d.car ?? "_race";
    const subjects = [...new Set(d.evidence.map((e) => e.factId))];
    if (!subjects.length && d.car && ctx.entries.has(d.car)) subjects.push(`car:${d.car}`);
    if (!subjects.length) {
      run[x.group].notEvaluated = [
        ...(run[x.group].notEvaluated ?? []),
        { car: d.car, reason: "no_subject_fact" },
      ];
      continue;
    }
    const n = (seq.get(`${x.ruleId}|${carKey}`) ?? 0) + 1;
    seq.set(`${x.ruleId}|${carKey}`, n);
    // ceiling: the rule's severity after overrides, doubt and the unverified / other-season cap; info when
    // the subject passed or the rule does not bind it
    const sev = capSeverity(x.rule, d);
    const ceiling = status === "pass" || status === "not_applicable" ? "info" : sev.severity;
    const severityNotes = status === "pass" ? [] : sev.notes;
    const official: FactId[] = d.raceControl?.penaltyIds ?? [];
    const notes = [
      ...d.notes,
      ...(d.raceControl ? [`race_control_${d.raceControl.status}`] : []),
      ...(status !== "pass" && !x.rule.seasonConfirmed ? ["rule_season_not_confirmed"] : []),
    ];
    const c = x.citation;
    const check: RuleCheck = {
      id: `rule:${x.ruleId}:${carKey}:${n}`,
      ruleKey: x.ruleId,
      rulebookRef: {
        field: x.field,
        section: String(c.section),
        ...(c.eventKey && (c.layer === "event" || c.layer === "event-class")
          ? { eventOverride: c.eventKey }
          : {}),
        doc: c.doc,
        page: c.page,
        quote: c.quote,
      },
      car: d.car,
      subjectFactIds: subjects,
      status,
      measured: d.measured,
      ...(d.measuredRange ? { measuredRange: d.measuredRange } : {}),
      limit: d.limit,
      ...(d.unit ? { unit: d.unit } : {}),
      margin: d.margin,
      ...(official.length ? { officialAction: official } : {}),
      lap: d.lap,
      ...(d.raceTimeS !== null
        ? { at: { raceTimeS: d.raceTimeS, ...(d.clock ? { clock: d.clock } : {}) } }
        : {}),
      verified: x.rule.verified,
      severityCeiling: ceiling,
      ...(severityNotes.length ? { severityNotes } : {}),
      ...(notes.length ? { notes } : {}),
      source: { kind: "derived", method: `rule-check:${x.handler}` },
      confidence: d.confidence,
    };
    ruleChecks.push(check);
    run[x.group].checks++;
  }

  // ── markers: earliest legal pit per car, linked to the car's check of the same rule ────────────
  const perCar = new Map<string, number>();
  const ruleMarkers: RuleMarker[] = markerDrafts
    .map((m, i) => ({ ...m, i }))
    .sort((a, b) => carOrder(a.car, b.car) || a.i - b.i)
    .map((m) => {
      const n = (perCar.get(m.car) ?? 0) + 1;
      perCar.set(m.car, n);
      const mine = ruleChecks.filter((c) => c.ruleKey === m.ruleId && c.car === m.car);
      const link = mine.find((c) => c.status !== "pass") ?? mine[0] ?? null;
      return {
        id: `marker:${m.car}:${n}`,
        kind: "earliest_legal_pit" as const,
        car: m.car,
        lap: m.lap,
        clock: ctx.clock(m.raceTimeS),
        raceTimeS: m.raceTimeS,
        ruleCheckId: link?.id ?? null,
        ruleKey: m.ruleId,
      };
    });

  const all = [...classRules.values()].flatMap((m) => [...m.values()]);
  const ids = new Map(all.map((r) => [r.id, r.verified]));
  return {
    ruleChecks,
    ruleMarkers,
    ruleCoverage: {
      rulebookId: rulebook.id,
      rulebookHash: resolved.hash,
      event: eventKey,
      session: session?.key ?? null,
      run: run.map(({ _group, ...r }) => r),
      notCheckable,
    },
    rulebook: {
      id: rulebook.id,
      status: rulebook.status,
      eventKey,
      sessionKey: session?.key ?? null,
      sha256: resolved.hash,
      verifiedRuleCount: [...ids.values()].filter(Boolean).length,
      unverifiedRuleCount: [...ids.values()].filter((v) => !v).length,
    },
  };
}

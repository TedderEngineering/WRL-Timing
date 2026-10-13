/**
 * runRuleChecks(factsPackage, rulebook) -> { ruleFindings[], ruleMarkers[], checksRun[], notCheckable[] }
 *
 * Code computes facts, the rulebook states the rules (stage2/rules/RULEBOOK_FORMAT.md), and this module runs
 * every rule the rulebook defines a check for against the facts. Findings carry numbers, evidence fact ids,
 * citations and severities, never prose: the Claude pass writes `statement` later.
 *
 * Every rule is either run (`checksRun`) or listed in `notCheckable` with the reason (TBD value, data the
 * timing format does not carry, context-only rule, or not implemented in v1). Nothing is evaluated against a
 * guessed value (R4).
 */
import type { CarId, RaceAnalysisPackage } from "./package-types.js";
import type { ResolvedRule, Rulebook } from "./rulebook-types.js";
import {
  resolveRulebook,
  resolveRulesForClass,
  selectEvent,
  selectSession,
} from "./load-rulebook.js";
import type {
  CheckRun,
  EngineRuleFinding,
  NotCheckable,
  RuleCheckResult,
  RuleMarker,
} from "./types.js";
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

/** Why a rule with no handler is not checked, read from the rule's own check text. */
function noHandlerReason(rule: ResolvedRule): {
  reason: NotCheckable["reason"];
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

  const findings: (EngineRuleFinding & { _order: number })[] = [];
  const markerDrafts: {
    ruleId: string;
    rule: ResolvedRule;
    car: CarId;
    lap: number | null;
    raceTimeS: number;
  }[] = [];
  const checksRun: CheckRun[] = [];
  const notCheckable: NotCheckable[] = [];
  const ruleIds = [
    ...new Set([
      ...rulebook.rules.map((r) => r.id),
      ...[...classRules.values()].flatMap((m) => [...m.keys()]),
    ]),
  ];

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
      const r = rulebook.rules.find((x) => x.id === ruleId);
      if (r)
        notCheckable.push({
          ruleId,
          ruleType: r.type,
          classes: [],
          reason: "no_cars_in_scope",
          detail: "no_cars_in_race",
          tbd: [],
        });
      return;
    }
    for (const g of groups.values()) {
      const { rule } = g;
      g.cars.sort(carOrder);
      const nc = (reason: NotCheckable["reason"], detail: string, tbd = rule.tbd) =>
        notCheckable.push({
          ruleId,
          ruleType: rule.type,
          classes: g.classes,
          reason,
          detail,
          tbd,
        });
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
      const { citation, provenance } = citations(ctx, rule, docs);
      for (const d of res.findings) {
        const { severity, notes } = capSeverity(rule, d);
        findings.push({
          id: "",
          ruleId,
          ruleType: rule.type,
          title: rule.title,
          car: d.car,
          class: d.class ?? (d.car ? ctx.classOf(d.car) : null),
          severity,
          severityNotes: notes,
          lap: d.lap,
          clock: d.clock,
          raceTimeS: d.raceTimeS,
          measured: d.measured,
          measuredRange: d.measuredRange,
          threshold: d.threshold,
          marginS: d.marginS,
          unit: d.unit,
          evidence: d.evidence,
          citation,
          provenance,
          verified: rule.verified,
          seasonConfirmed: rule.seasonConfirmed,
          raceControl: d.raceControl,
          confidence: d.confidence,
          notes: d.notes,
          statement: null,
          _order: ruleOrder,
        });
      }
      for (const m of res.markers ?? []) markerDrafts.push({ ruleId, rule, ...m });
      checksRun.push({
        ruleId,
        ruleType: rule.type,
        classes: g.classes,
        evaluated: res.evaluated,
        passed: res.passed,
        findings: res.findings.length,
        notEvaluated: res.notEvaluated,
        verified: rule.verified,
        notes: res.notes,
      });
    }
  });

  findings.sort(
    (a, b) =>
      a._order - b._order ||
      carOrder(a.car ?? "", b.car ?? "") ||
      (a.raceTimeS ?? 0) - (b.raceTimeS ?? 0)
  );
  const ruleFindings: EngineRuleFinding[] = findings.map(({ _order, ...f }, i) => ({
    ...f,
    id: `finding:${i + 1}`,
  }));

  const ruleMarkers: RuleMarker[] = markerDrafts
    .sort((a, b) => carOrder(a.car, b.car))
    .map((m) => ({
      car: m.car,
      kind: "earliest_legal_pit",
      lap: m.lap,
      clock: ctx.clock(m.raceTimeS),
      raceTimeS: m.raceTimeS,
      ruleId: m.ruleId,
      findingId:
        ruleFindings.find((f) => f.ruleId === m.ruleId && f.car === m.car)?.id ?? null,
      citation: citations(ctx, m.rule, docs).citation,
    }));

  const all = [...classRules.values()].flatMap((m) => [...m.values()]);
  const ids = new Map(all.map((r) => [r.id, r.verified]));
  return {
    ruleFindings,
    ruleMarkers,
    checksRun,
    notCheckable,
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

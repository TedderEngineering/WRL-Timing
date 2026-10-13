/**
 * Merge rule-check results into a Race Analysis Package (schema 1.1 decisions, 12 Oct 2026).
 *
 * Writes `ruleFindings[]` (engine findings, `statement: null`), `ruleMarkers[]`, `ruleChecksRun[]`,
 * `rulesNotCheckable[]`, `rulebook`, `rulebookVersion` and `completeness.ruleChecks`. Any earlier rule-check
 * output in the package is replaced. Facts are never touched.
 */
import type { RaceAnalysisPackage, RulebookRef } from "./package-types.js";
import type { Rulebook } from "./rulebook-types.js";
import type { RuleCheckResult } from "./types.js";

export type PackageWithRuleChecks = RaceAnalysisPackage & {
  ruleMarkers?: RuleCheckResult["ruleMarkers"];
  ruleChecksRun?: RuleCheckResult["checksRun"];
  rulesNotCheckable?: RuleCheckResult["notCheckable"];
};

const BLOCKING = new Set(["tbd_value", "unsourced_value", "data_missing"]);

/** A series with no v1 rulebook (BRIEF D2): facts and stories, no rule checks. */
export function markRuleChecksAbsent(pkg: PackageWithRuleChecks): PackageWithRuleChecks {
  pkg.rulebook = { status: "absent" };
  pkg.rulebookVersion = null;
  pkg.ruleFindings = [];
  pkg.ruleMarkers = [];
  pkg.ruleChecksRun = [];
  pkg.rulesNotCheckable = [];
  if (pkg.completeness) pkg.completeness.ruleChecks = "absent";
  return pkg;
}

export function mergeRuleChecks(
  pkg: PackageWithRuleChecks,
  res: RuleCheckResult,
  rb: Rulebook
): PackageWithRuleChecks {
  const blocking = res.notCheckable.some((n) => BLOCKING.has(n.reason));
  const missingFields = [
    ...new Set(
      res.notCheckable
        .filter((n) => n.reason === "tbd_value" || n.reason === "unsourced_value")
        .flatMap((n) => n.detail.split(",").map((f) => `${n.ruleId}:${f}`))
    ),
  ];
  const ref: RulebookRef = {
    status: blocking ? "partial" : "applied",
    fileId: rb.id,
    version: rb.status,
    sha256: res.rulebook.sha256,
    eventOverrides: res.rulebook.eventKey ? [res.rulebook.eventKey] : [],
    missingFields,
  };
  // Engine findings (schema 1.1) replace the 1.0 Claude-only shape; `statement` is written by the Claude pass.
  pkg.ruleFindings = res.ruleFindings as unknown as RaceAnalysisPackage["ruleFindings"];
  pkg.ruleMarkers = res.ruleMarkers;
  pkg.ruleChecksRun = res.checksRun;
  pkg.rulesNotCheckable = res.notCheckable;
  pkg.rulebook = ref;
  pkg.rulebookVersion = `${rb.id}@sha256:${res.rulebook.sha256.slice(0, 12)}`;
  if (pkg.completeness) pkg.completeness.ruleChecks = blocking ? "partial" : "complete";
  return pkg;
}

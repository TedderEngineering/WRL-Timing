/**
 * Merge rule-check results into a Race Analysis Package (schema 1.1.0 rule-check contract).
 *
 * Writes `ruleChecks[]` (every rule × subject evaluated, passes included), `ruleMarkers[]`, `ruleCoverage`,
 * `rulebook`, `rulebookVersion` and `completeness.ruleChecks`. Any earlier rule-check output in the package is
 * replaced. Facts are never touched, and `ruleFindings[]` are not written: the Claude pass (/analyze-race)
 * writes them from the checks, within each check's severityCeiling (validator A21).
 */
import type { RaceAnalysisPackage, RulebookRef } from "../analysis/schema/package-types.js";
import type { Rulebook } from "./rulebook-types.js";
import type { RuleCheckResult } from "./types.js";

/** Pre-contract G3 sections; removed when a package is re-merged. */
const LEGACY_KEYS = ["ruleChecksRun", "rulesNotCheckable"] as const;

const BLOCKING = new Set(["tbd_value", "unsourced_value", "data_missing"]);

function dropLegacy(pkg: RaceAnalysisPackage): void {
  const p = pkg as unknown as Record<string, unknown>;
  for (const k of LEGACY_KEYS) delete p[k];
}

/** A series with no v1 rulebook (BRIEF D2): facts and stories, no rule checks. */
export function markRuleChecksAbsent(pkg: RaceAnalysisPackage): RaceAnalysisPackage {
  dropLegacy(pkg);
  pkg.rulebook = { status: "absent" };
  pkg.rulebookVersion = null;
  pkg.ruleChecks = [];
  delete pkg.ruleMarkers;
  delete pkg.ruleCoverage;
  if (pkg.completeness) pkg.completeness.ruleChecks = "absent";
  return pkg;
}

export function mergeRuleChecks(
  pkg: RaceAnalysisPackage,
  res: RuleCheckResult,
  rb: Rulebook
): RaceAnalysisPackage {
  dropLegacy(pkg);
  const nc = res.ruleCoverage.notCheckable;
  const blocking = nc.some((n) => BLOCKING.has(n.reason));
  const missingFields = [
    ...new Set(
      nc
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
  pkg.ruleChecks = res.ruleChecks;
  pkg.ruleMarkers = res.ruleMarkers;
  pkg.ruleCoverage = res.ruleCoverage;
  pkg.rulebook = ref;
  pkg.rulebookVersion = `${rb.id}@sha256:${res.rulebook.sha256.slice(0, 12)}`;
  if (pkg.completeness) pkg.completeness.ruleChecks = blocking ? "partial" : "complete";
  return pkg;
}

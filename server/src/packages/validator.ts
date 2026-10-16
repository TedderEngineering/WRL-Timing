/**
 * Race Analysis Package validation hook (RaceTrace 2.0, G5 + G2).
 *
 * Wraps the full validator in ../analysis/validate-package.ts (V1 JSON Schema 2020-12,
 * V2–V8 fact references, A1–A20 prose and coverage rules) and maps its result onto
 * `ValidatorReport`, the shape the admin UI, the stored `validatorReport` column and
 * the 422 body use. The schema is bundled with the server (analysis/schema), so the
 * server no longer reads ../shared at runtime. `asPublished` applies the publish gate.
 */
import { validatePackage as fullValidate, PACKAGE_SCHEMA } from "../analysis/validate-package.js";

export const VALIDATOR_ID = "racetrace-validate-package/1.1";
const MAX_ISSUES = 200;

export interface ValidatorIssue {
  /** Machine code, e.g. SCHEMA, UNSUPPORTED_SCHEMA_VERSION, SOURCE_HASH_MISMATCH. */
  code: string;
  /** JSON pointer into the package ("" = root), or a file id for source checks. */
  path: string;
  message: string;
}

export interface SourceFileCheck {
  fileId: string;
  name: string;
  sha256: string;
  /** match: same bytes as the race's archive; mismatch: archived file differs; not_archived: no archived file found. */
  status: "match" | "mismatch" | "not_archived" | "unchecked";
  archivePath?: string;
}

export interface ValidatorReport {
  passed: boolean;
  validator: string;
  schemaVersion: string | null;
  checkedAt: string;
  errors: ValidatorIssue[];
  warnings: ValidatorIssue[];
  /** Number of errors before truncation to MAX_ISSUES. */
  errorCount: number;
  sourceFiles?: SourceFileCheck[];
}

/** Schema versions this server can validate, e.g. ["1.0.0"]. */
export function supportedSchemaVersions(): string[] {
  const v = (PACKAGE_SCHEMA as { properties?: { schemaVersion?: { const?: unknown } } }).properties?.schemaVersion?.const;
  return typeof v === "string" ? [v] : [];
}

export function emptyReport(schemaVersion: string | null): ValidatorReport {
  return {
    passed: true,
    validator: VALIDATOR_ID,
    schemaVersion,
    checkedAt: new Date().toISOString(),
    errors: [],
    warnings: [],
    errorCount: 0,
  };
}

/** Add an error, keeping `errorCount` right when the list is truncated. */
export function addError(report: ValidatorReport, issue: ValidatorIssue): void {
  report.errors.push(issue);
  report.errorCount += 1;
}

/** Recompute `passed` and `errorCount` and truncate long issue lists. */
export function finaliseReport(report: ValidatorReport): ValidatorReport {
  report.errorCount = Math.max(report.errorCount, report.errors.length);
  report.errors = report.errors.slice(0, MAX_ISSUES);
  report.warnings = report.warnings.slice(0, MAX_ISSUES);
  report.passed = report.errorCount === 0;
  return report;
}

/**
 * Validate a parsed package.
 *
 * `asPublished`: check the package as if its `status` were "published", so the
 * schema's publish gate applies (every completeness section complete except ruleChecks, a
 * non-null raceSummary, no blocker data-quality note). Used by the publish
 * endpoint; the stored bytes are never rewritten.
 */
export function validatePackage(pkg: unknown, opts: { asPublished?: boolean } = {}): ValidatorReport {
  const isObject = typeof pkg === "object" && pkg !== null && !Array.isArray(pkg);
  const schemaVersion =
    isObject && typeof (pkg as Record<string, unknown>).schemaVersion === "string"
      ? ((pkg as Record<string, unknown>).schemaVersion as string)
      : null;
  const report = emptyReport(schemaVersion);

  if (!isObject) {
    addError(report, { code: "NOT_AN_OBJECT", path: "", message: "A package must be a JSON object" });
    return finaliseReport(report);
  }

  if (!supportedSchemaVersions().includes(schemaVersion ?? "")) {
    addError(report, {
      code: "UNSUPPORTED_SCHEMA_VERSION",
      path: "/schemaVersion",
      message: `schemaVersion ${JSON.stringify(schemaVersion)} is not supported; this server validates ${supportedSchemaVersions().join(", ")}`,
    });
    return finaliseReport(report);
  }

  // Full validator (G2): V1 schema, V2–V8 fact references, A1–A20 prose and coverage rules.
  // `publish` applies the schema's publish gate and the analysis-stage rules.
  const subject = opts.asPublished ? { ...(pkg as Record<string, unknown>), status: "published" } : pkg;
  const full = fullValidate(subject, { publish: !!opts.asPublished });
  const toIssue = (line: string, gate: boolean): ValidatorIssue => {
    const m = /^(\S+)\s+(.*)$/s.exec(line);
    const rule = m ? m[1] : "VALIDATOR";
    const message = m ? m[2] : line;
    const pathMatch = /^schema (\/\S*):/.exec(message);
    const code = rule === "V1" ? (gate ? "PUBLISH_GATE" : "SCHEMA") : rule;
    const p = pathMatch ? pathMatch[1] : "";
    return { code, path: p === "/" ? "" : p, message };
  };
  for (const e of full.errors) addError(report, toIssue(e, !!opts.asPublished));
  for (const w of full.warnings) report.warnings.push(toIssue(w, false));
  return finaliseReport(report);
}

/** Test hook: forget loaded schemas (e.g. after changing RACETRACE_SCHEMA_DIR). */
export function resetSchemaCache(): void {
  /* schemas are bundled with the server (analysis/schema); nothing to reset */
}

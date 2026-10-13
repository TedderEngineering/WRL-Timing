/**
 * Race Analysis Package validation hook (RaceTrace 2.0, G5).
 *
 * This is the SCHEMA-ONLY stage (validator rule V1): Ajv 2020-12 + ajv-formats
 * against the JSON Schema copied into shared/race-analysis-package/ from
 * stage2/core/schema/. Every `*.schema.json` in that folder is loaded and
 * keyed by its `schemaVersion` const, so adding a schema version (e.g. 1.1.0
 * with raceSummary.keyMoments) needs a file, not a code change.
 *
 * TODO(G2 merge): branch racetrace2/g2-* provides the full validator
 * (V1–V8: fact references resolve, every number in prose matches its fact,
 * every car has a story, lexicon, confidence judgements, prose rules). At
 * merge, make `validatePackage` call it and map its result onto
 * `ValidatorReport` (keep the shape: the admin UI, the stored
 * `validatorReport` column and the 422 body depend on it). Keep the
 * `asPublished` publish-gate behaviour.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

export const VALIDATOR_ID = "g5-schema-only/1";
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

interface LoadedSchemas {
  dir: string | null;
  byVersion: Map<string, ValidateFunction>;
  loadError: string | null;
}

let loaded: LoadedSchemas | null = null;

function candidateDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dirs = [
    process.env.RACETRACE_SCHEMA_DIR,
    // src/packages or dist/packages → <repo>/shared/race-analysis-package
    path.resolve(here, "../../../shared/race-analysis-package"),
    path.resolve(process.cwd(), "../shared/race-analysis-package"),
    path.resolve(process.cwd(), "shared/race-analysis-package"),
  ];
  return dirs.filter((d): d is string => typeof d === "string" && d.length > 0);
}

function loadSchemas(): LoadedSchemas {
  if (loaded) return loaded;
  const byVersion = new Map<string, ValidateFunction>();
  let dir: string | null = null;
  let loadError: string | null = null;
  try {
    dir = candidateDirs().find((d) => fs.existsSync(d) && fs.statSync(d).isDirectory()) ?? null;
    if (!dir) {
      loadError = `Package schema folder not found (looked in: ${candidateDirs().join(", ")})`;
    } else {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".schema.json")).sort();
      for (const f of files) {
        const schema = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const version: unknown = schema?.properties?.schemaVersion?.const;
        if (typeof version !== "string") continue;
        // One Ajv instance per schema: each declares the same $defs names.
        const ajv = new Ajv2020({ allErrors: true, strict: false });
        addFormats(ajv);
        byVersion.set(version, ajv.compile(schema));
      }
      if (byVersion.size === 0) loadError = `No *.schema.json with a schemaVersion const in ${dir}`;
    }
  } catch (e: unknown) {
    loadError = `Could not load package schemas: ${e instanceof Error ? e.message : String(e)}`;
  }
  loaded = { dir, byVersion, loadError };
  return loaded;
}

/** Schema versions this server can validate, e.g. ["1.0.0"]. */
export function supportedSchemaVersions(): string[] {
  return [...loadSchemas().byVersion.keys()].sort();
}

function describe(e: ErrorObject): string {
  const params = e.params as Record<string, unknown>;
  if (e.keyword === "additionalProperties") return `unknown property "${String(params.additionalProperty)}"`;
  if (e.keyword === "enum") return `${e.message}: ${JSON.stringify(params.allowedValues)}`;
  if (e.keyword === "const") return `${e.message}: ${JSON.stringify(params.allowedValue)}`;
  return e.message ?? e.keyword;
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
 * schema's publish gate applies (every completeness section complete, a
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

  const schemas = loadSchemas();
  if (schemas.loadError) {
    addError(report, { code: "SCHEMA_UNAVAILABLE", path: "", message: schemas.loadError });
    return finaliseReport(report);
  }

  const validate = schemaVersion ? schemas.byVersion.get(schemaVersion) : undefined;
  if (!validate) {
    addError(report, {
      code: "UNSUPPORTED_SCHEMA_VERSION",
      path: "/schemaVersion",
      message: `schemaVersion ${JSON.stringify(schemaVersion)} is not supported; this server validates ${supportedSchemaVersions().join(", ")}`,
    });
    return finaliseReport(report);
  }

  const subject = opts.asPublished ? { ...(pkg as Record<string, unknown>), status: "published" } : pkg;
  if (!validate(subject)) {
    const errs = validate.errors ?? [];
    report.errorCount = errs.length;
    for (const e of errs.slice(0, MAX_ISSUES)) {
      report.errors.push({
        code: opts.asPublished ? "PUBLISH_GATE" : "SCHEMA",
        path: e.instancePath || "",
        message: describe(e),
      });
    }
  }
  return finaliseReport(report);
}

/** Test hook: forget loaded schemas (e.g. after changing RACETRACE_SCHEMA_DIR). */
export function resetSchemaCache(): void {
  loaded = null;
}

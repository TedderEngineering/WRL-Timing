/**
 * HTTP contract for Race Analysis Packages (RaceTrace 2.0, G5).
 * Server side: server/src/routes/packages.ts, server/src/packages/*.ts
 * (the server keeps its own copy of these shapes; keep the two in step).
 */
import type { RaceAnalysisPackage } from "./types";

export type PackageStatus = "draft" | "published" | "superseded" | "rejected";
export type DataQualityGrade = "good" | "check_notes" | "limited";
export type PackageResultsStatus = "official" | "provisional";

export interface ValidatorIssue {
  code: string;
  path: string;
  message: string;
}

export interface SourceFileCheck {
  fileId: string;
  name: string;
  sha256: string;
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
  errorCount: number;
  sourceFiles?: SourceFileCheck[];
}

export interface PackageSummary {
  id: string;
  version: number;
  status: PackageStatus;
  isCurrent: boolean;
  schemaVersion: string;
  engineVersion: string;
  rulebookVersion: string | null;
  sha256: string;
  sizeBytes: number;
  dataQualityGrade: DataQualityGrade | null;
  resultsStatus: PackageResultsStatus | null;
  createdById: string | null;
  createdAt: string;
  publishedById: string | null;
  publishedAt: string | null;
  notes: string | null;
  validatorReport: ValidatorReport;
}

/** GET /api/admin/races/:id/packages */
export interface PackageListResponse {
  raceId: string;
  currentPackageId: string | null;
  currentVersion: number | null;
  flags: { global: "on" | "off"; raceDisabled: boolean; servedToUsers: boolean };
  packages: PackageSummary[];
}

/** POST /api/admin/races/:id/packages (201) */
export interface PackageUploadResponse {
  package: PackageSummary;
  report: ValidatorReport;
}

/** 422 body from upload (PACKAGE_INVALID) or publish (PACKAGE_NOT_PUBLISHABLE). */
export interface PackageRejectedBody {
  error: string;
  code: "PACKAGE_INVALID" | "PACKAGE_NOT_PUBLISHABLE";
  report: ValidatorReport;
}

/** POST .../packages/:version/publish and .../rollback */
export interface PackagePublishResponse {
  package: PackageSummary;
  previousVersion: number | null;
}

/** Package fields on GET /api/races/:id. */
export interface RacePackageFields {
  /** True when the race page should read the package instead of /chart-data. */
  hasPackage: boolean;
  packageVersion: number | null;
  resultsStatus: PackageResultsStatus | null;
  dataQualityGrade: DataQualityGrade | null;
  packagePublishedAt: string | null;
  /** Admins only. */
  packageAdmin?: {
    currentPackageId: string | null;
    currentVersion: number | null;
    raceDisabled: boolean;
    flag: "on" | "off";
  };
}

/** Response headers of GET /api/races/:id/package, parsed. */
export interface PackageMeta {
  version: number;
  status: PackageStatus;
  publishedAt: string | null;
  etag: string | null;
  /** "hidden": ruleChecks and ruleFindings were emptied, ruleMarkers and ruleCoverage removed, for this viewer (Rule Flags stage). */
  ruleFlags: "included" | "hidden";
}

export interface FetchedPackage {
  pkg: RaceAnalysisPackage;
  meta: PackageMeta;
}

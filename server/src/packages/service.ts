/**
 * Race Analysis Package lifecycle (RaceTrace 2.0, G5): upload as draft,
 * publish (superseding the previous version), roll back, reject.
 *
 * Invariants:
 *  - A row exists only for a package that passed validation; its blob is at
 *    packages/<raceId>/v<version>.json.gz and its sha256 is of the
 *    uncompressed JSON bytes exactly as uploaded.
 *  - At most one PUBLISHED row per race, and Race.currentPackageId points to it.
 *    Every state change runs in one transaction holding the race row lock.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../models/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import {
  addError,
  finaliseReport,
  validatePackage,
  type SourceFileCheck,
  type ValidatorReport,
} from "./validator.js";
import {
  decodeUpload,
  downloadBlob,
  gunzip,
  gzip,
  packageStoragePath,
  sha256Hex,
  uploadBlob,
} from "./store.js";

// The generated Prisma client is not available in every environment this code
// is checked in, so the row shape is declared here.
export type PackageStatusDb = "DRAFT" | "PUBLISHED" | "SUPERSEDED" | "REJECTED";
export type ResultsStatusDb = "OFFICIAL" | "PROVISIONAL";

export interface PackageRow {
  id: string;
  raceId: string;
  version: number;
  schemaVersion: string;
  engineVersion: string;
  rulebookVersion: string | null;
  status: PackageStatusDb;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  validatorReport: unknown;
  dataQualityGrade: string | null;
  resultsStatus: ResultsStatusDb | null;
  createdById: string | null;
  publishedById: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  notes: string | null;
}

export type DataQualityGrade = "good" | "check_notes" | "limited";

export interface PackageSummary {
  id: string;
  version: number;
  status: "draft" | "published" | "superseded" | "rejected";
  isCurrent: boolean;
  schemaVersion: string;
  engineVersion: string;
  rulebookVersion: string | null;
  sha256: string;
  sizeBytes: number;
  dataQualityGrade: DataQualityGrade | null;
  resultsStatus: "official" | "provisional" | null;
  createdById: string | null;
  createdAt: string;
  publishedById: string | null;
  publishedAt: string | null;
  notes: string | null;
  validatorReport: ValidatorReport;
}

type Tx = Prisma.TransactionClient;

export function toSummary(row: PackageRow, currentPackageId: string | null): PackageSummary {
  return {
    id: row.id,
    version: row.version,
    status: row.status.toLowerCase() as PackageSummary["status"],
    isCurrent: row.id === currentPackageId,
    schemaVersion: row.schemaVersion,
    engineVersion: row.engineVersion,
    rulebookVersion: row.rulebookVersion,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    dataQualityGrade: (row.dataQualityGrade as DataQualityGrade | null) ?? null,
    resultsStatus: row.resultsStatus ? (row.resultsStatus.toLowerCase() as "official" | "provisional") : null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    publishedById: row.publishedById,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    notes: row.notes,
    validatorReport: row.validatorReport as ValidatorReport,
  };
}

// ─── Derived columns ─────────────────────────────────────────────────────────

/**
 * Data badge grade (GUI_SYSTEM_SPEC §2.1). Provisional rule until the schema
 * carries its own grade: any blocker note or incomplete section → limited;
 * any warning note → check_notes; otherwise good.
 */
export function deriveDataQualityGrade(pkg: Record<string, any>): DataQualityGrade {
  const notes: Array<{ severity?: string }> = Array.isArray(pkg.dataQuality) ? pkg.dataQuality : [];
  const completeness: Record<string, unknown> =
    pkg.completeness && typeof pkg.completeness === "object" ? pkg.completeness : {};
  if (
    notes.some((n) => n?.severity === "blocker") ||
    Object.values(completeness).some((v) => v !== "complete")
  ) {
    return "limited";
  }
  if (notes.some((n) => n?.severity === "warning")) return "check_notes";
  return "good";
}

/** metadata.resultsStatus → column. "unofficial" shows as Provisional; "none" → null. */
export function deriveResultsStatus(pkg: Record<string, any>): ResultsStatusDb | null {
  const s = pkg?.metadata?.resultsStatus;
  if (s === "official") return "OFFICIAL";
  if (s === "provisional" || s === "unofficial") return "PROVISIONAL";
  return null;
}

// ─── Source-file hash check ──────────────────────────────────────────────────

function normPath(p: unknown): string {
  return typeof p === "string" ? p.replace(/^\/+/, "").replace(/^race-files\//, "") : "";
}

/** sha256 of an archived file, plus of its decoded bytes when it was archived as a data URL (PDFs). */
function archivedHashes(buf: Buffer): Set<string> {
  const out = new Set([sha256Hex(buf)]);
  const head = buf.subarray(0, 100).toString("utf8");
  if (head.startsWith("data:")) {
    const text = buf.toString("utf8");
    const comma = text.indexOf(",");
    if (comma > 0 && text.slice(0, comma).includes(";base64")) {
      out.add(sha256Hex(Buffer.from(text.slice(comma + 1), "base64")));
    }
  }
  return out;
}

/**
 * Compare the package's sourceFiles[].sha256 with the race's archived raw
 * files (Race.sourceFiles, G1). A file whose archive path matches but whose
 * bytes differ is an error: the package was built from other files. A file
 * with no archived counterpart is a warning.
 */
export async function checkSourceFiles(
  pkg: Record<string, any>,
  raceSourceFiles: unknown,
  report: ValidatorReport,
  download: (path: string) => Promise<Buffer> = downloadBlob
): Promise<void> {
  const files: Array<Record<string, any>> = Array.isArray(pkg.sourceFiles) ? pkg.sourceFiles : [];
  if (files.length === 0) return;

  const archived =
    raceSourceFiles && typeof raceSourceFiles === "object" && !Array.isArray(raceSourceFiles)
      ? Object.values(raceSourceFiles as Record<string, unknown>).filter(
          (p): p is string => typeof p === "string" && p.length > 0
        )
      : [];

  const checks: SourceFileCheck[] = [];
  if (archived.length === 0) {
    report.warnings.push({
      code: "RACE_NOT_ARCHIVED",
      path: "/sourceFiles",
      message: "This race has no archived raw files, so source-file hashes were not checked.",
    });
    for (const f of files) checks.push({ fileId: f.fileId, name: f.name, sha256: f.sha256, status: "unchecked" });
    report.sourceFiles = checks;
    return;
  }

  const byPath = new Map<string, Set<string>>();
  const failed = new Set<string>();
  for (const p of archived) {
    try {
      byPath.set(normPath(p), archivedHashes(await download(p)));
    } catch (e: unknown) {
      failed.add(normPath(p));
      report.warnings.push({
        code: "SOURCE_CHECK_FAILED",
        path: p,
        message: `Could not read archived file ${p}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  files.forEach((f, i) => {
    const ap = normPath(f.archive?.path);
    const base = { fileId: f.fileId, name: f.name, sha256: f.sha256 };
    const exact = byPath.get(ap);
    if (exact) {
      if (exact.has(f.sha256)) {
        checks.push({ ...base, status: "match", archivePath: ap });
      } else {
        checks.push({ ...base, status: "mismatch", archivePath: ap });
        addError(report, {
          code: "SOURCE_HASH_MISMATCH",
          path: `/sourceFiles/${i}/sha256`,
          message: `${f.fileId} "${f.name}": sha256 differs from the race's archived file ${ap}`,
        });
      }
      return;
    }
    if (failed.has(ap)) {
      checks.push({ ...base, status: "unchecked", archivePath: ap });
      return;
    }
    const other = [...byPath.entries()].find(([, hashes]) => hashes.has(f.sha256));
    if (other) {
      checks.push({ ...base, status: "match", archivePath: other[0] });
      return;
    }
    checks.push({ ...base, status: "not_archived" });
    report.warnings.push({
      code: "SOURCE_NOT_ARCHIVED",
      path: `/sourceFiles/${i}`,
      message: `${f.fileId} "${f.name}" matches none of the race's archived files`,
    });
  });
  report.sourceFiles = checks;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function lockRace(tx: Tx, raceId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM races WHERE id = ${raceId} FOR UPDATE`;
}

const TX_OPTS = { maxWait: 10_000, timeout: 60_000 };

async function findRace(raceId: string) {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    select: { id: true, date: true, sourceFiles: true, currentPackageId: true, packagesDisabled: true },
  });
  if (!race) throw new AppError(404, "Race not found", "RACE_NOT_FOUND");
  return race as {
    id: string;
    date: Date;
    sourceFiles: unknown;
    currentPackageId: string | null;
    packagesDisabled: boolean;
  };
}

async function findPackage(raceId: string, version: number): Promise<PackageRow> {
  const row = (await prisma.raceAnalysisPackage.findUnique({
    where: { raceId_version: { raceId, version } },
  })) as PackageRow | null;
  if (!row) throw new AppError(404, `Package v${version} not found for this race`, "PACKAGE_NOT_FOUND");
  return row;
}

export function parseVersion(raw: unknown): number {
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) throw new AppError(400, "Version must be a positive integer", "INVALID_VERSION");
  return v;
}

function parseJson(bytes: Buffer): unknown {
  let text = bytes.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (e: unknown) {
    throw new AppError(400, `Body is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, "INVALID_JSON");
  }
}

// ─── Upload ──────────────────────────────────────────────────────────────────

export type UploadResult =
  | { ok: true; row: PackageRow; report: ValidatorReport; currentPackageId: string | null }
  | { ok: false; report: ValidatorReport };

export async function uploadPackage(args: {
  raceId: string;
  body: Buffer;
  userId: string;
  notes?: string | null;
}): Promise<UploadResult> {
  const race = await findRace(args.raceId);
  if (!args.body || args.body.length === 0) {
    throw new AppError(400, "Request body is empty: send the package JSON (plain or gzip)", "EMPTY_BODY");
  }

  const json = decodeUpload(args.body);
  const pkg = parseJson(json);
  const report = validatePackage(pkg);

  if (report.passed) {
    const p = pkg as Record<string, any>;
    await checkSourceFiles(p, race.sourceFiles, report);
    const raceDate = race.date instanceof Date ? race.date.toISOString().slice(0, 10) : null;
    const pkgDate = p.metadata?.raceDate;
    if (raceDate && typeof pkgDate === "string" && pkgDate !== raceDate) {
      report.warnings.push({
        code: "RACE_DATE_MISMATCH",
        path: "/metadata/raceDate",
        message: `Package raceDate ${pkgDate} differs from the race record's date ${raceDate}`,
      });
    }
    finaliseReport(report);
  }
  if (!report.passed) return { ok: false, report };

  const p = pkg as Record<string, any>;
  const sha256 = sha256Hex(json);
  const duplicate = await prisma.raceAnalysisPackage.findFirst({
    where: { raceId: race.id, sha256, status: { not: "REJECTED" } },
    select: { version: true },
  });
  if (duplicate) {
    throw new AppError(
      409,
      `This exact package is already stored as v${duplicate.version} for this race`,
      "DUPLICATE_PACKAGE"
    );
  }

  const gz = gzip(json);
  const row = (await prisma.$transaction(async (tx: Tx) => {
    await lockRace(tx, race.id);
    const last = await tx.raceAnalysisPackage.findFirst({
      where: { raceId: race.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    const storagePath = packageStoragePath(race.id, version);
    await uploadBlob(storagePath, gz);
    return tx.raceAnalysisPackage.create({
      data: {
        raceId: race.id,
        version,
        schemaVersion: p.schemaVersion,
        engineVersion: p.engineVersion,
        rulebookVersion: p.rulebookVersion ?? null,
        status: "DRAFT",
        storagePath,
        sha256,
        sizeBytes: json.length,
        validatorReport: JSON.parse(JSON.stringify(report)), // plain JSON for the Json column
        dataQualityGrade: deriveDataQualityGrade(p),
        resultsStatus: deriveResultsStatus(p),
        createdById: args.userId,
        notes: args.notes ?? null,
      },
    });
  }, TX_OPTS)) as PackageRow;

  return { ok: true, row, report, currentPackageId: race.currentPackageId };
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listPackages(raceId: string) {
  const race = await findRace(raceId);
  const rows = (await prisma.raceAnalysisPackage.findMany({
    where: { raceId },
    orderBy: { version: "desc" },
  })) as PackageRow[];
  return {
    race,
    packages: rows.map((r: PackageRow) => toSummary(r, race.currentPackageId)),
  };
}

// ─── Publish ─────────────────────────────────────────────────────────────────

export type PublishResult =
  | { ok: true; row: PackageRow; previousVersion: number | null }
  | { ok: false; report: ValidatorReport };

export async function publishPackage(raceId: string, version: number, userId: string): Promise<PublishResult> {
  await findRace(raceId);
  const row = await findPackage(raceId, version);
  if (row.status === "PUBLISHED") throw new AppError(409, `v${version} is already published`, "ALREADY_PUBLISHED");
  if (row.status === "SUPERSEDED") {
    throw new AppError(409, `v${version} was published before; use rollback to restore it`, "USE_ROLLBACK");
  }
  if (row.status === "REJECTED") throw new AppError(409, `v${version} was rejected`, "PACKAGE_REJECTED");
  if ((row.validatorReport as ValidatorReport | null)?.passed !== true) {
    throw new AppError(409, `v${version} did not pass validation`, "VALIDATION_FAILED");
  }

  // Publish gate (SCHEMA_NOTES §2 #16): the package must validate as "published".
  const plain = gunzip(await downloadBlob(row.storagePath));
  if (sha256Hex(plain) !== row.sha256) {
    throw new AppError(500, `Stored package ${row.storagePath} does not match its sha256`, "PACKAGE_CORRUPT");
  }
  const pkg = parseJson(plain);
  const gate = validatePackage(pkg, { asPublished: true });
  if (!gate.passed) return { ok: false, report: gate };

  return prisma.$transaction(async (tx: Tx) => {
    await lockRace(tx, raceId);
    const fresh = (await tx.raceAnalysisPackage.findUnique({ where: { id: row.id } })) as PackageRow | null;
    if (!fresh || fresh.status !== "DRAFT") {
      throw new AppError(409, `v${version} changed state while publishing; reload and retry`, "STATE_CHANGED");
    }
    const previous = (await tx.raceAnalysisPackage.findFirst({
      where: { raceId, status: "PUBLISHED" },
      select: { version: true },
    })) as { version: number } | null;
    await tx.raceAnalysisPackage.updateMany({
      where: { raceId, status: "PUBLISHED", NOT: { id: row.id } },
      data: { status: "SUPERSEDED" },
    });
    const published = (await tx.raceAnalysisPackage.update({
      where: { id: row.id },
      data: { status: "PUBLISHED", publishedAt: new Date(), publishedById: userId },
    })) as PackageRow;
    await tx.race.update({ where: { id: raceId }, data: { currentPackageId: row.id } });
    return { ok: true as const, row: published, previousVersion: previous?.version ?? null };
  }, TX_OPTS);
}

// ─── Rollback: make an earlier published version current again ──────────────

export async function rollbackPackage(raceId: string, version: number, userId: string) {
  await findRace(raceId);
  const row = await findPackage(raceId, version);
  if (row.status === "PUBLISHED") throw new AppError(409, `v${version} is already the current package`, "ALREADY_CURRENT");
  if (row.status !== "SUPERSEDED") {
    throw new AppError(
      409,
      `Only a previously published (superseded) version can be restored; v${version} is ${row.status.toLowerCase()}`,
      "NOT_ROLLBACKABLE"
    );
  }

  return prisma.$transaction(async (tx: Tx) => {
    await lockRace(tx, raceId);
    const fresh = (await tx.raceAnalysisPackage.findUnique({ where: { id: row.id } })) as PackageRow | null;
    if (!fresh || fresh.status !== "SUPERSEDED") {
      throw new AppError(409, `v${version} changed state; reload and retry`, "STATE_CHANGED");
    }
    const previous = (await tx.raceAnalysisPackage.findFirst({
      where: { raceId, status: "PUBLISHED" },
      select: { version: true },
    })) as { version: number } | null;
    await tx.raceAnalysisPackage.updateMany({
      where: { raceId, status: "PUBLISHED", NOT: { id: row.id } },
      data: { status: "SUPERSEDED" },
    });
    const restored = (await tx.raceAnalysisPackage.update({
      where: { id: row.id },
      data: { status: "PUBLISHED", publishedAt: new Date(), publishedById: userId },
    })) as PackageRow;
    await tx.race.update({ where: { id: raceId }, data: { currentPackageId: row.id } });
    return { row: restored, previousVersion: previous?.version ?? null };
  }, TX_OPTS);
}

// ─── Reject ──────────────────────────────────────────────────────────────────

export async function rejectPackage(raceId: string, version: number, reason: string | null) {
  await findRace(raceId);
  const row = await findPackage(raceId, version);
  if (row.status === "PUBLISHED") {
    throw new AppError(
      409,
      `v${version} is the current package; publish or restore another version first`,
      "CANNOT_REJECT_CURRENT"
    );
  }
  if (row.status === "REJECTED") throw new AppError(409, `v${version} is already rejected`, "ALREADY_REJECTED");

  const note = `Rejected${reason ? `: ${reason}` : ""}`;
  return (await prisma.raceAnalysisPackage.update({
    where: { id: row.id },
    data: { status: "REJECTED", notes: row.notes ? `${row.notes}\n${note}` : note },
  })) as PackageRow;
}

// ─── Per-race override ───────────────────────────────────────────────────────

export async function setPackagesDisabled(raceId: string, disabled: boolean) {
  await findRace(raceId);
  await prisma.race.update({ where: { id: raceId }, data: { packagesDisabled: disabled } });
}

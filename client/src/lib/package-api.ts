/**
 * Race Analysis Package API (RaceTrace 2.0, G5). Typed fetch helpers only;
 * no UI. Server: server/src/routes/packages.ts.
 *
 * The race page decides between the package and the legacy chart data with
 * `RaceDetail.hasPackage` (GET /api/races/:id): when false, keep using
 * /chart-data. A 404 with code PACKAGES_DISABLED from fetchRacePackage means
 * the switch was turned off since the page loaded: fall back the same way.
 */
import { api, ApiClientError } from "./api";
import type { RaceAnalysisPackage } from "@shared/race-analysis-package/types";
import type {
  FetchedPackage,
  PackageListResponse,
  PackageMeta,
  PackagePublishResponse,
  PackageRejectedBody,
  PackageStatus,
  PackageSummary,
  PackageUploadResponse,
  RacePackageFields,
  ValidatorReport,
} from "@shared/race-analysis-package/api";

export type {
  FetchedPackage,
  PackageListResponse,
  PackageMeta,
  PackagePublishResponse,
  PackageSummary,
  PackageUploadResponse,
  RacePackageFields,
  ValidatorReport,
};

const enc = encodeURIComponent;

// Last good response per URL, so a 304 can be answered from memory.
const cache = new Map<string, FetchedPackage>();

function readMeta(res: Response): PackageMeta {
  return {
    version: Number(res.headers.get("X-RaceTrace-Package-Version") ?? 0),
    status: (res.headers.get("X-RaceTrace-Package-Status") ?? "published") as PackageStatus,
    publishedAt: res.headers.get("X-RaceTrace-Published-At"),
    etag: res.headers.get("ETag"),
    ruleFlags: res.headers.get("X-RaceTrace-Rule-Flags") === "included" ? "included" : "hidden",
  };
}

/**
 * GET /api/races/:id/package — the current published package, or (admins
 * only) a specific version, e.g. a draft under review. Revalidates with the
 * ETag, so repeat calls cost a 304.
 */
export async function fetchRacePackage(
  raceId: string,
  opts: { version?: number; signal?: AbortSignal } = {}
): Promise<FetchedPackage> {
  const path = `/races/${enc(raceId)}/package${opts.version ? `?version=${opts.version}` : ""}`;
  const cached = cache.get(path);
  const headers: Record<string, string> = {};
  if (cached?.meta.etag) headers["If-None-Match"] = cached.meta.etag;

  const res = await api.fetchResponse(path, { headers, signal: opts.signal });
  if (res.status === 304 && cached) return cached;

  const result: FetchedPackage = { pkg: (await res.json()) as RaceAnalysisPackage, meta: readMeta(res) };
  cache.set(path, result);
  return result;
}

/** True when the error means "use the legacy chart data instead". */
export function isPackageUnavailable(err: unknown): boolean {
  return (
    err instanceof ApiClientError &&
    err.status === 404 &&
    (err.code === "PACKAGES_DISABLED" || err.code === "NO_PACKAGE")
  );
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export function listRacePackages(raceId: string): Promise<PackageListResponse> {
  return api.get<PackageListResponse>(`/admin/races/${enc(raceId)}/packages`);
}

/**
 * Upload a package file (plain JSON or .json.gz). Resolves with the stored
 * draft. A package that fails validation rejects with ApiClientError 422 whose
 * `payload` is a PackageRejectedBody (see validatorReportOf).
 */
export async function uploadRacePackage(
  raceId: string,
  file: Blob,
  opts: { notes?: string } = {}
): Promise<PackageUploadResponse> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  const query = opts.notes ? `?notes=${enc(opts.notes)}` : "";
  const res = await api.fetchResponse(`/admin/races/${enc(raceId)}/packages${query}`, {
    method: "POST",
    headers: { "Content-Type": gz ? "application/gzip" : "application/json" },
    body: file,
  });
  return (await res.json()) as PackageUploadResponse;
}

export function publishRacePackage(raceId: string, version: number): Promise<PackagePublishResponse> {
  return api.post<PackagePublishResponse>(`/admin/races/${enc(raceId)}/packages/${version}/publish`);
}

/** Make an earlier published (now superseded) version current again. */
export function rollbackRacePackage(raceId: string, version: number): Promise<PackagePublishResponse> {
  return api.post<PackagePublishResponse>(`/admin/races/${enc(raceId)}/packages/${version}/rollback`);
}

export function rejectRacePackage(
  raceId: string,
  version: number,
  reason?: string
): Promise<{ package: PackageSummary }> {
  return api.post<{ package: PackageSummary }>(
    `/admin/races/${enc(raceId)}/packages/${version}/reject`,
    reason ? { reason } : undefined
  );
}

/** Keep one race on the legacy chart data (true) or let it follow RACETRACE_PACKAGES (false). */
export function setRacePackagesDisabled(
  raceId: string,
  disabled: boolean
): Promise<{ raceId: string; packagesDisabled: boolean }> {
  return api.put(`/admin/races/${enc(raceId)}/packages/override`, { disabled });
}

/** The validator report carried by a 422 from upload or publish, if any. */
export function validatorReportOf(err: unknown): ValidatorReport | null {
  if (!(err instanceof ApiClientError) || err.status !== 422) return null;
  const body = err.payload as Partial<PackageRejectedBody> | undefined;
  return body?.report ?? null;
}

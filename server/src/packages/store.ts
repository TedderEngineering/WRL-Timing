/**
 * Package blob storage (RaceTrace 2.0, G5).
 *
 * The gzipped package JSON lives in Supabase Storage, bucket "race-files", at
 * packages/<raceId>/v<version>.json.gz. Postgres keeps only the row with its
 * sha256. A blob is immutable once its row exists, so decoded copies are
 * cached in memory by sha256.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { supabase, STORAGE_BUCKET } from "../lib/supabase.js";
import { AppError } from "../middleware/error-handler.js";

/** Largest upload accepted, compressed or not. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Largest decompressed package accepted (gzip-bomb guard). A 75-car 8 h race is about 3.7 MB. */
export const MAX_JSON_BYTES = 128 * 1024 * 1024;

export function packageStoragePath(raceId: string, version: number): string {
  return `packages/${raceId}/v${version}.json.gz`;
}

export function sha256Hex(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function isGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

/** Plain JSON bytes from an upload that may be gzip. */
export function decodeUpload(body: Buffer): Buffer {
  if (!isGzip(body)) return body;
  try {
    return gunzipSync(body, { maxOutputLength: MAX_JSON_BYTES });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/maxOutputLength|buffer/i.test(msg)) {
      throw new AppError(413, `Decompressed package exceeds ${MAX_JSON_BYTES / 1024 / 1024} MB`, "PACKAGE_TOO_LARGE");
    }
    throw new AppError(400, `Upload looks like gzip but could not be decompressed: ${msg}`, "INVALID_GZIP");
  }
}

export function gzip(buf: Buffer): Buffer {
  return gzipSync(buf, { level: 9 });
}

export function gunzip(buf: Buffer): Buffer {
  return gunzipSync(buf, { maxOutputLength: MAX_JSON_BYTES });
}

// ─── Bucket access ───────────────────────────────────────────────────────────

function bucket() {
  if (!supabase) {
    throw new AppError(
      503,
      "Package storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
      "STORAGE_NOT_CONFIGURED"
    );
  }
  return supabase.storage.from(STORAGE_BUCKET);
}

export async function uploadBlob(path: string, gz: Buffer): Promise<void> {
  // upsert: callers hold the race row lock and no package row exists for this
  // path yet, so anything already there is an orphan from a failed attempt.
  const { error } = await bucket().upload(path, gz, { contentType: "application/gzip", upsert: true });
  if (error) {
    throw new AppError(502, `Could not store the package at ${path}: ${error.message}`, "STORAGE_UPLOAD_FAILED");
  }
}

export async function downloadBlob(path: string): Promise<Buffer> {
  const { data, error } = await bucket().download(path);
  if (error || !data) {
    throw new AppError(502, `Could not read ${path} from storage: ${error?.message ?? "no data"}`, "STORAGE_DOWNLOAD_FAILED");
  }
  return Buffer.from(await data.arrayBuffer());
}

// ─── Cache of served bodies, keyed by sha256 + variant ───────────────────────

const CACHE_LIMIT_BYTES = 64 * 1024 * 1024;
const cache = new Map<string, Buffer>();
let cacheBytes = 0;

function cacheGet(key: string): Buffer | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // most recently used last
  }
  return hit;
}

function cachePut(key: string, buf: Buffer): void {
  if (buf.length > CACHE_LIMIT_BYTES) return;
  if (cache.has(key)) return;
  cache.set(key, buf);
  cacheBytes += buf.length;
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_LIMIT_BYTES) break;
    cache.delete(k);
    cacheBytes -= v.length;
  }
}

export function clearPackageCache(): void {
  cache.clear();
  cacheBytes = 0;
}

export type PackageVariant = "full" | "norules";

/**
 * The gzipped body to serve for a stored package. "norules" has `ruleChecks`
 * and `ruleFindings` emptied for viewers below the Rule Flags stage.
 */
export async function getServedGzip(
  row: { storagePath: string; sha256: string },
  variant: PackageVariant
): Promise<Buffer> {
  const key = `${row.sha256}:${variant}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  let full = cacheGet(`${row.sha256}:full`);
  if (!full) {
    full = await downloadBlob(row.storagePath);
    const plain = gunzip(full);
    if (sha256Hex(plain) !== row.sha256) {
      throw new AppError(500, `Stored package ${row.storagePath} does not match its sha256`, "PACKAGE_CORRUPT");
    }
    cachePut(`${row.sha256}:full`, full);
  }
  if (variant === "full") return full;

  const pkg = JSON.parse(gunzip(full).toString("utf8")) as Record<string, unknown>;
  const stripped = gzip(Buffer.from(JSON.stringify(stripRuleFlags(pkg)), "utf8"));
  cachePut(key, stripped);
  return stripped;
}

/** Remove Rule Flags content (stage R0 = admins only). */
export function stripRuleFlags<T extends Record<string, unknown>>(pkg: T): T {
  return { ...pkg, ruleChecks: [], ruleFindings: [] };
}

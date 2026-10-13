/**
 * Raw race-file archive (RaceTrace 2.0, G1 / finding F7).
 *
 * Every import must keep its original timing files so the race can be
 * re-analysed later. Before this module, `uploadRaceFiles` ran AFTER the race
 * was written to the database and swallowed upload failures with a
 * console.error, so 131 of 144 production races ended up with no archive.
 *
 * Rules enforced here:
 *  - Archive runs BEFORE any database write. Callers parse first (so garbage
 *    is never archived), then archive, then ingest.
 *  - Any failed upload, after one retry, aborts the import with a 502 that
 *    names each file and the storage error. Nothing partial is recorded.
 *  - In production, a missing storage configuration is an error, never a
 *    silent skip. In development and test it is allowed and reported as a
 *    warning so local work does not need Supabase.
 */
import { randomUUID } from "node:crypto";
import { AppError } from "../middleware/error-handler.js";

/** The subset of the Supabase storage client this module needs. */
export interface StorageBucketClient {
  upload(
    path: string,
    body: Buffer,
    opts: { contentType: string; upsert: boolean }
  ): Promise<{ error: { message: string } | null }>;
}

export interface ArchiveOptions {
  /** Bucket client, e.g. `supabase.storage.from("race-files")`; null when storage is not configured. */
  bucket: StorageBucketClient | null;
  /** NODE_ENV of the running server. */
  nodeEnv: string | undefined;
  /** Folder id; a random UUID by default. Exposed for tests. */
  archiveId?: string;
  /** Upload attempts per file (default 2: one retry). */
  attempts?: number;
}

export interface ArchiveResult {
  /** fileKey → storage path, in the shape `Race.sourceFiles` already uses. */
  paths: Record<string, string>;
  /** Non-fatal notes, e.g. storage disabled in development. */
  warnings: string[];
}

export interface ArchiveFailure {
  key: string;
  path: string;
  bytes: number;
  error: string;
}

/** Extension and content type for a parser file-slot key. */
export function fileTypeForKey(key: string): { ext: string; contentType: string } {
  const k = key.toLowerCase();
  if (k.includes("pdf")) return { ext: "pdf", contentType: "application/pdf" };
  if (k.includes("json")) return { ext: "json", contentType: "application/json" };
  return { ext: "csv", contentType: "text/csv" };
}

export async function archiveRaceFiles(
  files: Record<string, unknown>,
  opts: ArchiveOptions
): Promise<ArchiveResult> {
  const entries = Object.entries(files).filter(
    (e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0
  );

  if (!opts.bucket) {
    if (opts.nodeEnv === "production") {
      throw new AppError(
        500,
        "Raw-file archive is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). " +
          "Imports are refused in production until it is, so every race can be re-analysed later.",
        "ARCHIVE_NOT_CONFIGURED"
      );
    }
    return {
      paths: {},
      warnings: ["Raw files were not archived: storage is not configured in this environment."],
    };
  }

  const archiveId = opts.archiveId ?? randomUUID();
  const attempts = Math.max(1, opts.attempts ?? 2);
  const paths: Record<string, string> = {};
  const failures: ArchiveFailure[] = [];

  for (const [key, content] of entries) {
    const { ext, contentType } = fileTypeForKey(key);
    const path = `imports/${archiveId}/${key}.${ext}`;
    const body = Buffer.from(content, "utf-8");

    let lastError = "unknown error";
    let ok = false;
    for (let i = 0; i < attempts && !ok; i++) {
      try {
        const { error } = await opts.bucket.upload(path, body, { contentType, upsert: true });
        if (error) lastError = error.message;
        else ok = true;
      } catch (e: unknown) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    if (ok) paths[key] = path;
    else failures.push({ key, path, bytes: body.length, error: lastError });
  }

  if (failures.length > 0) {
    const list = failures
      .map((f) => `${f.key} (${(f.bytes / 1024).toFixed(0)} KB): ${f.error}`)
      .join("; ");
    const err = new AppError(
      502,
      `Import stopped: ${failures.length} of ${entries.length} raw file(s) could not be archived, ` +
        `so nothing was saved. ${list}`,
      "ARCHIVE_FAILED"
    );
    (err as AppError & { failures?: ArchiveFailure[] }).failures = failures;
    throw err;
  }

  return { paths, warnings: [] };
}

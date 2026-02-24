import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("⚠ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — storage uploads disabled");
}

export const supabase =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

export const STORAGE_BUCKET = "race-files";

/**
 * Upload raw race files (CSV/PDF content) to Supabase Storage.
 * Files are stored under: {raceId}/{fileKey}.{ext}
 * Returns a map of fileKey → storage path.
 */
export async function uploadRaceFiles(
  raceId: string,
  files: Record<string, string>,
  format: string
): Promise<Record<string, string>> {
  if (!supabase) return {};

  const paths: Record<string, string> = {};

  for (const [key, content] of Object.entries(files)) {
    if (!content) continue;

    const ext = key.toLowerCase().includes("pdf") ? "pdf" : "csv";
    const storagePath = `${raceId}/${key}.${ext}`;

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, Buffer.from(content, "utf-8"), {
        contentType: ext === "pdf" ? "application/pdf" : "text/csv",
        upsert: true,
      });

    if (error) {
      console.error(`Failed to upload ${storagePath}:`, error.message);
    } else {
      paths[key] = storagePath;
    }
  }

  return paths;
}

/**
 * Download raw race files from Supabase Storage.
 * Returns a map of fileKey → file content (string).
 */
export async function downloadRaceFiles(
  sourceFiles: Record<string, string>
): Promise<Record<string, string>> {
  if (!supabase) throw new Error("Storage not configured");

  const files: Record<string, string> = {};

  for (const [key, storagePath] of Object.entries(sourceFiles)) {
    if (!storagePath) continue;

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);

    if (error) throw new Error(`Failed to download ${storagePath}: ${error.message}`);
    if (!data) throw new Error(`No data for ${storagePath}`);

    files[key] = await data.text();
  }

  return files;
}

/**
 * File loading for the fact engine (the only I/O, kept outside the pure engine): reads a file,
 * computes its sha256, and extracts PDF text items with coordinates.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { SourceFileRole } from "./schema/package-types.js";
import type { InputFile } from "./types.js";
import { detectRole } from "./adapters/index.js";
import { loadPdfPages } from "./adapters/pdf.js";

export async function loadInputFile(path: string, opts: { role?: SourceFileRole; name?: string; archivedAt?: string } = {}): Promise<InputFile> {
  const buf = await readFile(path);
  const name = opts.name ?? basename(path);
  const role = opts.role ?? detectRole(name);
  const isPdf = buf.subarray(0, 5).toString("ascii") === "%PDF-";
  const archivedAt = opts.archivedAt ?? (await stat(path)).mtime.toISOString().replace(/\.\d{3}Z$/, "Z");
  const f: InputFile = {
    name,
    role,
    sha256: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
    archive: { path, archivedAt },
  };
  if (isPdf) f.pdf = await loadPdfPages(buf);
  else f.text = buf.toString("utf8");
  return f;
}

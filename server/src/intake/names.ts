/**
 * Windows-safe file and folder names, and content hashes.
 *
 * Work folders are created on the owner's Windows laptop, so names must avoid
 * the characters Windows forbids (< > : " / \ | ? * and control characters),
 * reserved device names (CON, NUL, COM1 …) and trailing dots or spaces, and
 * stay well under the 260-character MAX_PATH.
 */
import { createHash } from "node:crypto";

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** A file name that is legal on Windows and POSIX. Spaces are kept. */
export function safeFileName(name: string, maxLength = 120): string {
  let s = name
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!s) s = "file";
  if (RESERVED.test(s)) s = `_${s}`;
  if (s.length > maxLength) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : "";
    s = s.slice(0, maxLength - ext.length - 9) + "_" + shortHash(name) + ext;
  }
  return s;
}

/**
 * Folder slug for a source key: ASCII letters, digits, "-", "_" and ".",
 * with "__" between key segments. Long keys are cut and given a hash suffix
 * so two different keys never share a folder.
 */
export function slugForSourceKey(sourceKey: string, maxLength = 100): string {
  let s = sourceKey
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[:/\\]+/g, "__")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_{3,}/g, "__")
    .replace(/^[._]+|[._ ]+$/g, "");
  if (!s) s = "race";
  if (RESERVED.test(s)) s = `_${s}`;
  if (s.length > maxLength) s = `${s.slice(0, maxLength - 9)}_${shortHash(sourceKey)}`;
  return s;
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function shortHash(s: string): string {
  return sha256(s).slice(0, 8);
}

/** "02_Road Atlanta" → "Road Atlanta" (Alkamel folder number prefix). */
export function stripNumberPrefix(name: string): string {
  return name.replace(/^\d+_/, "").trim();
}

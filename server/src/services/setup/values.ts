/**
 * Setup Sheet — sheet values and their changes. Pure functions, no database.
 *
 * A sheet's data is an object of text keyed by parameter:
 *   { "lf.rebound": "8", "car.brake_bias": "56.5", "meta.driver_name": "…" }
 * Values are kept exactly as typed ("1 IN", "Stiff", "-4.8"). An empty value
 * means "not set" and is removed rather than stored.
 */
import { z } from "zod";

export const MAX_SHEET_KEYS = 300;
export const MAX_VALUE_LENGTH = 200;
export const MAX_NOTES_LENGTH = 10_000;
export const MAX_NAME_LENGTH = 120;

/** "lf.rebound", "car.brake_bias", "meta.setup_date" … */
export const SHEET_KEY = /^[a-z][a-z0-9]{0,15}\.[a-z0-9_]{1,48}$/;

export type SheetValues = Record<string, string>;
export interface SheetChange {
  key: string;
  from: string | null;
  to: string | null;
}

const sheetKey = z.string().regex(SHEET_KEY, "Not a setup parameter key");
const sheetValue = z.string().max(MAX_VALUE_LENGTH, `Values are at most ${MAX_VALUE_LENGTH} characters`);

/** A complete sheet, as sent when importing or creating. */
export const sheetValuesSchema = z
  .record(sheetKey, sheetValue)
  .refine((v) => Object.keys(v).length <= MAX_SHEET_KEYS, `At most ${MAX_SHEET_KEYS} values per sheet`);

/** Changes to some keys; null or "" clears a key. */
export const sheetPatchSchema = z
  .record(sheetKey, sheetValue.nullable())
  .refine((v) => Object.keys(v).length <= MAX_SHEET_KEYS, `At most ${MAX_SHEET_KEYS} values per change`);

/** Drop empty values and trim surrounding spaces. */
export function cleanValues(values: Record<string, string | null | undefined>): SheetValues {
  const out: SheetValues = {};
  for (const [key, raw] of Object.entries(values)) {
    const value = (raw ?? "").trim();
    if (value !== "") out[key] = value;
  }
  return out;
}

/** Read stored JSON defensively: anything that isn't a string value is ignored. */
export function readValues(stored: unknown): SheetValues {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out: SheetValues = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
}

/** Every key whose value differs, sorted by key. */
export function diffValues(before: SheetValues, after: SheetValues): SheetChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: SheetChange[] = [];
  for (const key of keys) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (from !== to) changes.push({ key, from, to });
  }
  return changes;
}

/** Apply a patch: set the given keys, clear the empty ones, leave the rest alone. */
export function applyPatch(
  current: SheetValues,
  patch: Record<string, string | null>
): { next: SheetValues; changes: SheetChange[] } {
  const next: SheetValues = { ...current };
  for (const [key, raw] of Object.entries(patch)) {
    const value = (raw ?? "").trim();
    if (value === "") delete next[key];
    else next[key] = value;
  }
  if (Object.keys(next).length > MAX_SHEET_KEYS) {
    throw new RangeError(`At most ${MAX_SHEET_KEYS} values per sheet`);
  }
  return { next, changes: diffValues(current, next) };
}

/** Values that describe one particular sheet and shouldn't carry into the next session. */
const NOT_CARRIED = new Set(["meta.setup_date", "meta.setup_people"]);

/** Start a new session's target from a previous sheet. */
export function carryForward(values: SheetValues): SheetValues {
  const out: SheetValues = {};
  for (const [key, value] of Object.entries(values)) if (!NOT_CARRIED.has(key)) out[key] = value;
  return out;
}

// ─── Dates without a time of day ─────────────────────────────────────────────

/** "2026-10-09" (or "", null) for a date-only column. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Not a real date")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

export function toDateOnly(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

export function fromDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

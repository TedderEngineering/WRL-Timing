/**
 * Setup Sheet — car library specs. A spec describes one car model's setup
 * sheet as data: which values each corner and the car carry, their choices
 * and ranges, the limits a sheet is checked against, the factory baseline,
 * and reference material from the owner's manual.
 *
 * The client renders and checks sheets from the spec; the server only
 * validates its shape and uses the baseline to start a session.
 * Specs are data in the database, never committed: they come from
 * manufacturers' manuals.
 */
import { z } from "zod";
import { SHEET_KEY, cleanValues, sheetValuesSchema, type SheetValues } from "./values.js";

export const MAX_SPEC_BYTES = 300_000;

const text = (max: number) => z.string().trim().max(max);
const page = text(20).optional();

const option = z.object({ value: text(40).min(1), label: text(80).min(1) });

const limit = z.object({
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  text: text(200).min(1),
  page,
});

/** What a value is: shared by corner and car fields, and by per-axle overrides. */
const fieldShape = {
  label: text(60).min(1),
  unit: text(20).optional(),
  type: z.enum(["choice", "number", "text"]),
  options: z.array(option).max(60).optional(),
  /** The adjuster's physical range for a number (outside it is an error, not a warning). */
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  hint: text(80).optional(),
  about: text(1000).optional(),
  page,
  limits: z.array(limit).max(10).optional(),
  /** Shown instead of an input where this corner has no such adjustment. */
  fixed: text(60).optional(),
};
const fieldOverride = z.object(fieldShape).partial();

const cornerField = z.object({
  ...fieldShape,
  id: z.string().regex(/^[a-z0-9_]{1,48}$/),
  front: fieldOverride.optional(),
  rear: fieldOverride.optional(),
});

const carField = z.object({ ...fieldShape, key: z.string().regex(SHEET_KEY) });

const axleLimit = z.object({ min: z.number().finite().optional(), max: z.number().finite().optional() });

/** A limit set by the series rather than the manual, e.g. SRO's minimum inspection heights. */
const seriesRule = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,48}$/),
  label: text(80).min(1),
  body: text(40).min(1),
  page,
  note: text(300).optional(),
  fields: z.array(z.string().regex(/^[a-z0-9_]{1,48}$/)).min(1).max(10),
  front: axleLimit.optional(),
  rear: axleLimit.optional(),
});

export const specSchema = z
  .object({
    format: z.literal(1),
    make: text(60).min(1),
    model: text(80).min(1),
    series: text(80).optional(),
    source: z.object({ title: text(200).min(1), version: text(40).optional(), date: text(40).optional() }),
    corner: z.array(cornerField).min(1).max(40),
    car: z.array(carField).max(40).default([]),
    seriesRules: z.array(seriesRule).max(20).default([]),
    baseline: z
      .object({
        label: text(80).min(1),
        page,
        conditions: text(300).optional(),
        values: sheetValuesSchema,
      })
      .optional(),
  })
  // Torques, helpers, reference tables and notes are shown as they are.
  .passthrough()
  .superRefine((spec, ctx) => {
    const ids = new Set<string>();
    for (const f of spec.corner) {
      if (ids.has(f.id)) ctx.addIssue({ code: "custom", message: `Corner field "${f.id}" is listed twice` });
      ids.add(f.id);
    }
    for (const f of spec.car) {
      if (ids.has(f.key)) ctx.addIssue({ code: "custom", message: `Car field "${f.key}" is listed twice` });
      ids.add(f.key);
    }
  });

export type CarSpec = z.infer<typeof specSchema>;

/** Validate a spec sent by an admin, including its size. */
export function parseSpec(input: unknown): CarSpec {
  const size = Buffer.byteLength(JSON.stringify(input ?? null), "utf8");
  if (size > MAX_SPEC_BYTES) throw new z.ZodError([{ code: "custom", path: [], message: `A spec is at most ${MAX_SPEC_BYTES / 1000} KB` }]);
  return specSchema.parse(input);
}

/** The values a session starts from when it starts from the factory baseline. */
export function baselineValues(spec: unknown): SheetValues | null {
  const parsed = specSchema.safeParse(spec);
  if (!parsed.success || !parsed.data.baseline) return null;
  return cleanValues(parsed.data.baseline.values);
}

/** "toyota-gr86-cup": lower case, words joined by "-". */
export const modelSlug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80);

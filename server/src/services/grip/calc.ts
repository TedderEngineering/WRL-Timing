/**
 * Finding Grip — cold tire pressure calculation engine.
 *
 * This file is deliberately generic. It evaluates a "calculation model": a
 * base value plus a weighted sum of differences between named inputs, with an
 * optional blend toward the target for wet conditions. The model itself (which
 * inputs, which weights) is proprietary to Tedder Engineering and is NOT in
 * this repository. It is supplied at runtime through the GRIP_CALC_MODEL
 * environment variable as JSON.
 *
 * Never add real coefficients here, in tests, in fixtures or in comments.
 * Tests use made-up models.
 */
import { z } from "zod";

/** Inputs available to a model, per corner. Pressures in PSI, temps in °F, durations in minutes. */
export const CALC_VARIABLES = [
  "refCold",
  "refHot",
  "targetHot",
  "refTrackTemp",
  "trackTemp",
  "refAmbientTemp",
  "ambientTemp",
  "refWheelTemp",
  "wheelTemp",
  "refDuration",
  "duration",
] as const;

export type CalcVariable = (typeof CALC_VARIABLES)[number];
export type CalcInputs = Record<CalcVariable, number>;

const variable = z.enum(CALC_VARIABLES);

export const calcModelSchema = z.object({
  /** Free-form label so a deployed model can be identified in logs and admin stats. */
  version: z.union([z.string(), z.number()]).optional(),
  /** Starting value. */
  base: variable,
  /** Each term adds weight × (plus − minus). */
  terms: z
    .array(z.object({ weight: z.number().finite(), plus: variable, minus: variable }))
    .min(1)
    .max(32),
  /** Durations above this are treated as this value. */
  durationCap: z.number().positive().optional(),
  /** Wet result = dry + wetBlend × (wetToward − dry). */
  wetBlend: z.number().min(0).max(1).optional(),
  wetToward: variable.optional(),
  /** Decimal places in the returned value. */
  decimals: z.number().int().min(0).max(3).default(1),
});

export type CalcModel = z.infer<typeof calcModelSchema>;

export class CalcModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalcModelError";
  }
}

/** Parse a model from its JSON text. Throws CalcModelError with a safe message. */
export function parseCalcModel(json: string | undefined | null): CalcModel {
  if (!json || !json.trim()) {
    throw new CalcModelError("Calculation model is not configured");
  }
  // The value may be the JSON itself or base64 of it. The encoded form has no
  // quotes or braces, so it survives being pasted into a hosting dashboard.
  let text = json.trim();
  if (!text.startsWith("{") && /^[A-Za-z0-9+/=_\-\s]+$/.test(text)) {
    text = Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8").trim();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CalcModelError("Calculation model is not valid JSON");
  }
  const parsed = calcModelSchema.safeParse(raw);
  if (!parsed.success) {
    // Report which fields are wrong, never their values.
    const fields = parsed.error.errors
      .map((e) => e.path.join(".") || "(root)")
      .join(", ");
    throw new CalcModelError(`Calculation model is invalid at: ${fields}`);
  }
  if (parsed.data.wetBlend !== undefined && !parsed.data.wetToward) {
    throw new CalcModelError("Calculation model is invalid at: wetToward");
  }
  return parsed.data;
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Evaluate the model for one corner. */
export function evaluateCorner(
  model: CalcModel,
  inputs: CalcInputs,
  wet: boolean
): number {
  const v: CalcInputs = { ...inputs };
  if (model.durationCap !== undefined) {
    v.duration = Math.min(v.duration, model.durationCap);
    v.refDuration = Math.min(v.refDuration, model.durationCap);
  }

  let result = v[model.base];
  for (const term of model.terms) {
    result += term.weight * (v[term.plus] - v[term.minus]);
  }

  if (wet && model.wetBlend !== undefined && model.wetToward) {
    result = result + model.wetBlend * (v[model.wetToward] - result);
  }

  if (!Number.isFinite(result)) {
    throw new CalcModelError("Calculation produced a non-finite result");
  }
  return roundTo(result, model.decimals);
}

export const CORNERS = ["Lf", "Rf", "Lr", "Rr"] as const;
export type Corner = (typeof CORNERS)[number];
export type PerCorner = Record<Corner, number>;

export interface CalcRequest {
  wet: boolean;
  trackTemp: number;
  ambientTemp: number;
  duration: number;
  wheel: PerCorner;
  target: PerCorner;
  reference: {
    trackTemp: number;
    ambientTemp: number;
    duration: number;
    cold: PerCorner;
    hot: PerCorner;
    wheel: PerCorner;
  };
}

/** Evaluate all four corners independently. */
export function calculateColdPressures(model: CalcModel, req: CalcRequest): PerCorner {
  const out = {} as PerCorner;
  for (const c of CORNERS) {
    out[c] = evaluateCorner(
      model,
      {
        refCold: req.reference.cold[c],
        refHot: req.reference.hot[c],
        targetHot: req.target[c],
        refTrackTemp: req.reference.trackTemp,
        trackTemp: req.trackTemp,
        refAmbientTemp: req.reference.ambientTemp,
        ambientTemp: req.ambientTemp,
        refWheelTemp: req.reference.wheel[c],
        wheelTemp: req.wheel[c],
        refDuration: req.reference.duration,
        duration: req.duration,
      },
      req.wet
    );
  }
  return out;
}

// ─── Runtime model (from environment) ────────────────────────────────────────

let cached: {
  source: string | undefined;
  model: CalcModel | null;
  error: string | null;
} | null = null;

/** Load and cache the deployed model. Returns null (with a reason) when it is missing or invalid. */
export function getDeployedModel(): { model: CalcModel | null; error: string | null } {
  const source = process.env.GRIP_CALC_MODEL;
  if (!cached || cached.source !== source) {
    try {
      cached = { source, model: parseCalcModel(source), error: null };
    } catch (err) {
      cached = { source, model: null, error: (err as Error).message };
    }
  }
  return { model: cached.model, error: cached.error };
}

import { CORNER_KEYS, type Corners } from "./api";
import {
  displayToF,
  displayToPsi,
  parseNumber,
  pressureUnit,
  tempUnit,
  DURATION_RANGE_MIN,
  PRESSURE_RANGE_PSI,
  TEMP_RANGE_F,
  type Units,
} from "./units";

export interface Checked {
  /** Value in storage units (PSI, °F, minutes), or null when blank. */
  value: number | null;
  error?: string;
}

export function checkPressure(text: string, units: Units, required: boolean): Checked {
  const n = parseNumber(text);
  if (n === null)
    return text.trim() === ""
      ? { value: null, error: required ? "Required" : undefined }
      : { value: null, error: "Not a number" };
  const psi = displayToPsi(n, units);
  if (psi < PRESSURE_RANGE_PSI.min || psi > PRESSURE_RANGE_PSI.max) {
    return { value: null, error: `Out of range for ${pressureUnit(units)}` };
  }
  return { value: psi };
}

export function checkTemp(text: string, units: Units, required: boolean): Checked {
  const n = parseNumber(text);
  if (n === null)
    return text.trim() === ""
      ? { value: null, error: required ? "Required" : undefined }
      : { value: null, error: "Not a number" };
  const f = displayToF(n, units);
  if (f < TEMP_RANGE_F.min || f > TEMP_RANGE_F.max) {
    return { value: null, error: `Out of range for ${tempUnit(units)}` };
  }
  return { value: f };
}

export function checkDuration(text: string): Checked {
  const n = parseNumber(text);
  if (n === null)
    return { value: null, error: text.trim() === "" ? "Required" : "Not a number" };
  if (!Number.isInteger(n)) return { value: null, error: "Whole minutes only" };
  if (n < DURATION_RANGE_MIN.min || n > DURATION_RANGE_MIN.max)
    return { value: null, error: "Out of range" };
  return { value: n };
}

/** Check four corner fields at once. `values` is null if any corner failed. */
export function checkCorners(
  texts: Corners<string>,
  check: (text: string) => Checked
): {
  values: Corners<number | null>;
  errors: Partial<Corners<string>>;
  ok: boolean;
  allFilled: boolean;
} {
  const values = {} as Corners<number | null>;
  const errors: Partial<Corners<string>> = {};
  for (const c of CORNER_KEYS) {
    const r = check(texts[c]);
    values[c] = r.value;
    if (r.error) errors[c] = r.error;
  }
  return {
    values,
    errors,
    ok: Object.keys(errors).length === 0,
    allFilled: CORNER_KEYS.every((c) => values[c] !== null),
  };
}

export const emptyCorners = (): Corners<string> => ({ lf: "", rf: "", lr: "", rr: "" });

export function mapCorners<A, B>(c: Corners<A>, fn: (v: A) => B): Corners<B> {
  return { lf: fn(c.lf), rf: fn(c.rf), lr: fn(c.lr), rr: fn(c.rr) };
}

/**
 * Finding Grip unit handling. The API and database always use PSI and °F;
 * conversion happens only here, at the edge of the screen.
 */
export type Units = "STANDARD" | "METRIC";

const BAR_PER_PSI = 0.0689476;

export const pressureUnit = (u: Units) => (u === "METRIC" ? "bar" : "PSI");
export const tempUnit = (u: Units) => (u === "METRIC" ? "°C" : "°F");

export const psiToDisplay = (psi: number, u: Units) =>
  u === "METRIC" ? psi * BAR_PER_PSI : psi;
export const displayToPsi = (v: number, u: Units) =>
  u === "METRIC" ? v / BAR_PER_PSI : v;
export const fToDisplay = (f: number, u: Units) =>
  u === "METRIC" ? ((f - 32) * 5) / 9 : f;
export const displayToF = (v: number, u: Units) =>
  u === "METRIC" ? (v * 9) / 5 + 32 : v;

/** Pressure for display: 1 decimal in PSI, 2 in bar. */
export function formatPressure(psi: number | null | undefined, u: Units): string {
  if (psi === null || psi === undefined) return "—";
  return psiToDisplay(psi, u).toFixed(u === "METRIC" ? 2 : 1);
}

export function formatTemp(f: number | null | undefined, u: Units): string {
  if (f === null || f === undefined) return "—";
  return fToDisplay(f, u).toFixed(1);
}

/** Signed pressure difference, e.g. "+3.0" or "−0.21". */
export function formatPressureDelta(psi: number, u: Units): string {
  const v = psiToDisplay(Math.abs(psi), u).toFixed(u === "METRIC" ? 2 : 1);
  return `${psi < 0 ? "−" : "+"}${v}`;
}

/** Text for an input field (no trailing zeros forced on the user). */
export function pressureInput(psi: number | null | undefined, u: Units): string {
  if (psi === null || psi === undefined) return "";
  return String(Number(psiToDisplay(psi, u).toFixed(u === "METRIC" ? 2 : 1)));
}

export function tempInput(f: number | null | undefined, u: Units): string {
  if (f === null || f === undefined) return "";
  return String(Number(fToDisplay(f, u).toFixed(1)));
}

/** Parse a typed number; returns null for blank or non-numeric text. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Accepted ranges, in storage units. They mirror the server's validation and
// exist to catch a value typed in the wrong unit (2.1 in a PSI field).
export const PRESSURE_RANGE_PSI = { min: 5, max: 60 };
export const TEMP_RANGE_F = { min: -40, max: 250 };
export const DURATION_RANGE_MIN = { min: 1, max: 600 };

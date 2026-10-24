/**
 * The phone's x axis (mobile redesign): race time by default, as a phone viewer thinks in "two
 * hours in", not "lap 87". A change on the chart is remembered on this phone. Laptops keep the
 * Settings → Preferences chart default.
 */
export type AxisMode = "laps" | "hours" | "both";

const KEY = "rt.phoneAxis";
export const PHONE_AXIS_DEFAULT: AxisMode = "hours";

export function readPhoneAxis(): AxisMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "laps" || v === "hours" || v === "both" ? v : PHONE_AXIS_DEFAULT;
  } catch {
    return PHONE_AXIS_DEFAULT;
  }
}

export function writePhoneAxis(m: AxisMode) {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* private window: the choice lasts for this visit */
  }
}

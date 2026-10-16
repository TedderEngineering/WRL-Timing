/**
 * RaceTrace's per-browser dashboard memory ("racetrace.ui.v1"): the install hint's and the
 * first-use checklist's "Not now" / "Hide". Storage can be missing or blocked; the cards then
 * simply show again next time.
 */
const KEY = "racetrace.ui.v1";

export interface UiState {
  installDismissedAt?: number;
  checklistHidden?: boolean;
  /** The race-email ask after a follow was answered (never asked again here). */
  alertAskDone?: boolean;
  /** Season recaps hidden with "Hide", by recap key. */
  recapsHidden?: string[];
  /** Cars or drivers shown first on the Dashboard, when the user follows both. */
  yoursTab?: "cars" | "drivers";
}

export function readUi(): UiState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function writeUi(patch: UiState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readUi(), ...patch }));
  } catch {
    // private window or blocked storage
  }
}

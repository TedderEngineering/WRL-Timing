/**
 * Per-browser memory for the support ask (RaceTrace 2.0, F9/F10):
 *  - the contextual ask shows at most once every 30 days;
 *  - never again for a year once someone came back from checkout;
 *  - "Not now" counts as an answer for 30 days.
 * Storage can be missing or blocked; then the ask simply shows when eligible.
 */
const KEY = "racetrace.support.v1";
const DAY = 86_400_000;
export const ASK_EVERY_DAYS = 30;
export const THANKED_QUIET_DAYS = 365;
export const THANKS_VISIBLE_DAYS = 14;

interface State {
  askedAt?: number;
  dismissedAt?: number;
  thankedAt?: number;
}

function read(): State {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function write(patch: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    // private window or blocked storage
  }
}

export function canAsk(now = Date.now()): boolean {
  const s = read();
  if (s.thankedAt && now - s.thankedAt < THANKED_QUIET_DAYS * DAY) return false;
  const last = Math.max(s.askedAt ?? 0, s.dismissedAt ?? 0);
  return !last || now - last >= ASK_EVERY_DAYS * DAY;
}

export function recentlyThanked(now = Date.now()): boolean {
  const s = read();
  return !!s.thankedAt && now - s.thankedAt < THANKS_VISIBLE_DAYS * DAY;
}

export function isSupporter(now = Date.now()): boolean {
  const s = read();
  return !!s.thankedAt && now - s.thankedAt < THANKED_QUIET_DAYS * DAY;
}

export const markAsked = (now = Date.now()) => write({ askedAt: now });
export const markDismissed = (now = Date.now()) => write({ dismissedAt: now });
export const markThanked = (now = Date.now()) => write({ thankedAt: now });

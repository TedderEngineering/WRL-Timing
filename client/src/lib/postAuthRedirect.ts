/**
 * Remembers where a visitor was heading when they were sent to sign up or log
 * in from another Tedder Engineering tool (e.g. Finding Grip), so sign-up and
 * onboarding can return them there instead of the RaceTrace dashboard.
 *
 * The note expires after a few minutes so an abandoned sign-up does not hijack
 * a later, unrelated login in the same tab.
 */
const KEY = "post_auth_redirect";
const MAX_AGE_MS = 15 * 60 * 1000;

/** Same-site paths only: one leading slash, no scheme-relative or backslash tricks. */
function safePath(path: unknown): string | null {
  return typeof path === "string" && /^\/[^/\\]/.test(path) ? path : null;
}

export function rememberPostAuthRedirect(path: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Storage unavailable: fall back to the default destination.
  }
}

export function peekPostAuthRedirect(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const note = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof note.at !== "number" || Date.now() - note.at > MAX_AGE_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return safePath(note.path);
  } catch {
    return null;
  }
}

export function clearPostAuthRedirect(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function takePostAuthRedirect(fallback: string): string {
  const path = peekPostAuthRedirect();
  clearPostAuthRedirect();
  return path ?? fallback;
}

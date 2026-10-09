/**
 * Remembers where a visitor was heading when they were sent to sign up or log
 * in from another Tedder Engineering tool (e.g. Finding Grip), so sign-up and
 * onboarding can return them there instead of the RaceTrace dashboard.
 */
const KEY = "post_auth_redirect";

function safePath(path: string | null): string | null {
  // Same-site paths only.
  return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
}

export function rememberPostAuthRedirect(path: string): void {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // Storage unavailable: fall back to the default destination.
  }
}

export function peekPostAuthRedirect(): string | null {
  try {
    return safePath(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function takePostAuthRedirect(fallback: string): string {
  const path = peekPostAuthRedirect();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  return path ?? fallback;
}

export function clearPostAuthRedirect(): void {
  takePostAuthRedirect("");
}

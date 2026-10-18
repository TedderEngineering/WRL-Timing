/**
 * Why this browser was signed out (another phone or computer signed in to the account), shown once
 * on the sign-in page instead of a blocking pop-up. Session storage: this tab only, gone on close.
 */
const KEY = "rt_signed_out_notice";

export function setSignedOutNotice(message: string): void {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    /* storage unavailable: no notice */
  }
}

/** The notice, if any, cleared as it is read. */
export function takeSignedOutNotice(): string | null {
  try {
    const m = sessionStorage.getItem(KEY);
    if (m) sessionStorage.removeItem(KEY);
    return m;
  } catch {
    return null;
  }
}

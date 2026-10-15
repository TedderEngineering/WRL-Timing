/**
 * Sign in with another account (services/oauth.ts). Mounted at /api/auth/oauth.
 *
 *   GET  /providers                  the configured providers, for the sign-in buttons
 *   GET  /:provider/start?next=/x    → the provider
 *   GET|POST /:provider/callback     ← the provider (Apple posts a form)
 *
 * Outcomes go back to the site: the page in `next` signed in, or /login?oauth=<code>.
 */
import { Router, type Request, type Response } from "express";
import { env } from "../config/env.js";
import { setRefreshCookie } from "../utils/tokens.js";
import { siteForRequest } from "../services/site.js";
import {
  STATE_COOKIE,
  beginSignIn,
  configuredProviders,
  finishSignIn,
  openState,
  providerFor,
  safeNext,
  siteByKey,
  type ProviderId,
} from "../services/oauth.js";

export const oauthRouter = Router();

const COOKIE_PATH = "/api/auth/oauth";
function stateCookieOptions() {
  const production = env.NODE_ENV === "production";
  // Apple returns with a cross-site form POST, which only carries a SameSite=None cookie.
  return { httpOnly: true, secure: production, sameSite: (production ? "none" : "lax") as "none" | "lax", path: COOKIE_PATH, maxAge: 10 * 60 * 1000 };
}

oauthRouter.get("/providers", (_req: Request, res: Response) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ providers: configuredProviders() });
});

oauthRouter.get("/:provider/start", (req: Request, res: Response) => {
  const site = siteForRequest(req);
  const id = String(req.params.provider);
  const provider = providerFor(id);
  if (!provider || !provider.configured()) {
    res.redirect(302, `${site.url}/login?oauth=unavailable`);
    return;
  }
  const { url, sealed } = beginSignIn(id as ProviderId, site, safeNext(req.query.next));
  res.cookie(STATE_COOKIE, sealed, stateCookieOptions());
  res.set("Cache-Control", "no-store");
  res.redirect(302, url);
});

async function callback(req: Request, res: Response) {
  const input = { ...(req.query as Record<string, unknown>), ...((req.body ?? {}) as Record<string, unknown>) };
  const st = openState(req.cookies?.[STATE_COOKIE]);
  res.clearCookie(STATE_COOKIE, { ...stateCookieOptions(), maxAge: undefined });
  res.set("Cache-Control", "no-store");
  const back = (code: string) => {
    const site = st ? siteByKey(st.site) : siteForRequest(req);
    res.redirect(302, `${site.url}/login?oauth=${encodeURIComponent(code)}`);
  };
  const id = String(req.params.provider);
  if (!st || st.provider !== id || typeof input.state !== "string" || input.state !== st.state) return back("expired");
  // The person cancelled, or the provider refused.
  if (typeof input.error === "string") return back(input.error === "access_denied" || input.error === "user_cancelled_authorize" ? "cancelled" : "failed");
  if (typeof input.code !== "string" || !input.code) return back("failed");
  try {
    const { result, created, site } = await finishSignIn(id as ProviderId, st, {
      code: input.code,
      form: input,
      meta: { ipAddress: req.ip, userAgent: req.headers["user-agent"] },
    });
    setRefreshCookie(res, result.refreshToken);
    // A new account starts on the welcome steps where the site has them.
    // (The page they came from is kept in the browser and taken after onboarding.)
    const next = created && site.key === "racetrace" ? "/onboarding" : st.next;
    res.redirect(302, `${site.url}${next}`);
  } catch (err: any) {
    const code = err?.code === "OAUTH_NO_EMAIL" ? "no_email" : err?.code === "OAUTH_EMAIL_TAKEN" ? "email_taken" : err?.code === "ACCOUNT_SUSPENDED" ? "suspended" : "failed";
    if (code === "failed") console.error(`[oauth] ${id} sign-in failed:`, err?.message ?? err);
    back(code);
  }
}

oauthRouter.get("/:provider/callback", callback);
oauthRouter.post("/:provider/callback", callback);

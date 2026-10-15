/**
 * Sign in (and sign up) with another account: Google, Apple, Microsoft, Facebook, GitHub.
 *
 * Flow (authorization code with PKCE), all on the site's own address, so the session cookie
 * lands where the site reads it (Vercel passes /api/* to this server):
 *   1. GET  /api/auth/oauth/:provider/start?next=/dashboard   → 302 to the provider; a signed,
 *      short-lived cookie holds state, PKCE verifier, nonce, site and next page.
 *   2. GET or POST (Apple posts the form) /api/auth/oauth/:provider/callback → code exchanged
 *      server to server, the person's id and email read, the user found or created, a session
 *      started (refresh cookie), then 302 back to the page they came from.
 *
 * Linking: a provider account already linked signs in that user. Otherwise a user with the same
 * email is linked only when the provider says the email is verified (Microsoft does not, so a
 * Microsoft sign-in never takes over an existing account). A new email creates an account.
 * A provider is offered only when its settings are present (config/env.ts).
 */
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../models/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../middleware/error-handler.js";
import { generateSecureToken, getEmailVerifyExpiry } from "../utils/tokens.js";
import { sendVerificationEmail } from "./email.js";
import { startSession, type AuthResult, type SessionMeta } from "./auth.js";
import { gripSite, racetraceSite, setupSite, type Site } from "./site.js";

export type ProviderId = "google" | "apple" | "microsoft" | "facebook" | "github";

export interface OAuthProfile {
  /** The provider's stable id for the person. */
  subject: string;
  email: string | null;
  /** The provider vouches that the person controls this email. */
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

interface Provider {
  label: string;
  configured(): boolean;
  /** Apple returns to the callback with a form POST. */
  formPost?: boolean;
  authorizeUrl(a: { redirectUri: string; state: string; challenge: string; nonce: string }): string;
  profile(a: { code: string; redirectUri: string; verifier: string; nonce: string; form: Record<string, unknown> }): Promise<OAuthProfile>;
}

const has = (...v: (string | undefined)[]) => v.every((x) => !!x && x.trim().length > 0);
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function json(res: Response, what: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) throw new AppError(502, `${what} failed (${res.status})`, "OAUTH_PROVIDER_ERROR");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(502, `${what} returned no JSON`, "OAUTH_PROVIDER_ERROR");
  }
}

async function tokenRequest(url: string, form: Record<string, string>, what: string): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: q(form),
  });
  const data = await json(res, what);
  if (data.error) throw new AppError(502, `${what}: ${data.error}`, "OAUTH_PROVIDER_ERROR");
  return data;
}

/** The claims of a JWT received straight from a provider's token endpoint over TLS (OIDC 3.1.3.7). */
export function jwtClaims(token: string): Record<string, any> {
  const part = token.split(".")[1];
  if (!part) throw new AppError(502, "The provider's id token is malformed", "OAUTH_PROVIDER_ERROR");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/** Apple's client secret: an ES256 JWT signed with the Sign in with Apple key, valid 5 minutes. */
export function appleClientSecret(now = Math.floor(Date.now() / 1000)): string {
  const header = { alg: "ES256", kid: env.APPLE_KEY_ID };
  const payload = { iss: env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: env.APPLE_CLIENT_ID };
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${enc(header)}.${enc(payload)}`;
  const key = (env.APPLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  const sig = crypto.sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" });
  return `${data}.${sig.toString("base64url")}`;
}

const PROVIDERS: Record<ProviderId, Provider> = {
  google: {
    label: "Google",
    configured: () => has(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    authorizeUrl: ({ redirectUri, state, challenge, nonce }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${q({
        client_id: env.GOOGLE_CLIENT_ID!,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      })}`,
    async profile({ code, redirectUri, verifier }) {
      const t = await tokenRequest(
        "https://oauth2.googleapis.com/token",
        { code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier },
        "Google sign-in"
      );
      const u = await json(await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } }), "Google profile");
      return { subject: String(u.sub), email: u.email ?? null, emailVerified: u.email_verified === true, name: u.name ?? null, picture: u.picture ?? null };
    },
  },
  apple: {
    label: "Apple",
    formPost: true,
    configured: () => has(env.APPLE_CLIENT_ID, env.APPLE_TEAM_ID, env.APPLE_KEY_ID, env.APPLE_PRIVATE_KEY),
    authorizeUrl: ({ redirectUri, state, challenge, nonce }) =>
      `https://appleid.apple.com/auth/authorize?${q({
        client_id: env.APPLE_CLIENT_ID!,
        redirect_uri: redirectUri,
        response_type: "code",
        response_mode: "form_post",
        scope: "name email",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`,
    async profile({ code, redirectUri, verifier, nonce, form }) {
      const t = await tokenRequest(
        "https://appleid.apple.com/auth/token",
        { code, client_id: env.APPLE_CLIENT_ID!, client_secret: appleClientSecret(), redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier },
        "Apple sign-in"
      );
      const c = jwtClaims(String(t.id_token ?? ""));
      if (c.iss !== "https://appleid.apple.com" || c.aud !== env.APPLE_CLIENT_ID || (c.nonce && c.nonce !== nonce) || Number(c.exp) * 1000 < Date.now()) {
        throw new AppError(502, "Apple's id token did not match this sign-in", "OAUTH_PROVIDER_ERROR");
      }
      // Apple sends the name once, on the first sign-in, in the form.
      let name: string | null = null;
      try {
        const u = typeof form.user === "string" ? JSON.parse(form.user) : null;
        name = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(" ") || null;
      } catch {
        name = null;
      }
      return { subject: String(c.sub), email: c.email ?? null, emailVerified: c.email_verified === true || c.email_verified === "true", name, picture: null };
    },
  },
  microsoft: {
    label: "Microsoft",
    configured: () => has(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET),
    authorizeUrl: ({ redirectUri, state, challenge, nonce }) =>
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${q({
        client_id: env.MICROSOFT_CLIENT_ID!,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      })}`,
    async profile({ code, redirectUri, verifier }) {
      const t = await tokenRequest(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        { code, client_id: env.MICROSOFT_CLIENT_ID!, client_secret: env.MICROSOFT_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier, scope: "openid email profile" },
        "Microsoft sign-in"
      );
      const u = await json(await fetch("https://graph.microsoft.com/oidc/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } }), "Microsoft profile");
      // Microsoft does not say whether the email was verified.
      return { subject: String(u.sub), email: u.email ?? null, emailVerified: false, name: u.name ?? null, picture: null };
    },
  },
  facebook: {
    label: "Facebook",
    configured: () => has(env.FACEBOOK_APP_ID, env.FACEBOOK_APP_SECRET),
    authorizeUrl: ({ redirectUri, state, challenge }) =>
      `https://www.facebook.com/v21.0/dialog/oauth?${q({
        client_id: env.FACEBOOK_APP_ID!,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "email,public_profile",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`,
    async profile({ code, redirectUri, verifier }) {
      const t = await json(
        await fetch(
          `https://graph.facebook.com/v21.0/oauth/access_token?${q({ client_id: env.FACEBOOK_APP_ID!, client_secret: env.FACEBOOK_APP_SECRET!, redirect_uri: redirectUri, code, code_verifier: verifier })}`
        ),
        "Facebook sign-in"
      );
      const u = await json(
        await fetch(`https://graph.facebook.com/me?${q({ fields: "id,name,email,picture.type(large)", access_token: String(t.access_token) })}`),
        "Facebook profile"
      );
      // Facebook only returns an email the person has confirmed.
      return { subject: String(u.id), email: u.email ?? null, emailVerified: !!u.email, name: u.name ?? null, picture: u.picture?.data?.url ?? null };
    },
  },
  github: {
    label: "GitHub",
    configured: () => has(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    authorizeUrl: ({ redirectUri, state, challenge }) =>
      `https://github.com/login/oauth/authorize?${q({
        client_id: env.GITHUB_CLIENT_ID!,
        redirect_uri: redirectUri,
        scope: "read:user user:email",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        allow_signup: "true",
      })}`,
    async profile({ code, redirectUri, verifier }) {
      const t = await tokenRequest(
        "https://github.com/login/oauth/access_token",
        { code, client_id: env.GITHUB_CLIENT_ID!, client_secret: env.GITHUB_CLIENT_SECRET!, redirect_uri: redirectUri, code_verifier: verifier },
        "GitHub sign-in"
      );
      const headers = { Authorization: `Bearer ${t.access_token}`, "User-Agent": "RaceTrace", Accept: "application/vnd.github+json" };
      const u = await json(await fetch("https://api.github.com/user", { headers }), "GitHub profile");
      const emails = (await json(await fetch("https://api.github.com/user/emails", { headers }), "GitHub emails")) as { email: string; primary: boolean; verified: boolean }[];
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      return { subject: String(u.id), email: primary?.email ?? null, emailVerified: !!primary, name: u.name || u.login || null, picture: u.avatar_url ?? null };
    },
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function providerFor(id: string): Provider | null {
  return (PROVIDER_IDS as string[]).includes(id) ? PROVIDERS[id as ProviderId] : null;
}

/** The providers whose buttons the sign-in and sign-up pages show. */
export function configuredProviders(): { id: ProviderId; label: string }[] {
  return PROVIDER_IDS.filter((id) => PROVIDERS[id].configured()).map((id) => ({ id, label: PROVIDERS[id].label }));
}

// ── The signed state cookie ───────────────────────────────────────────────────

export const STATE_COOKIE = "rt_oauth";
const STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthState {
  provider: ProviderId;
  state: string;
  verifier: string;
  nonce: string;
  site: Site["key"];
  next: string;
  exp: number;
}

const stateKey = () => crypto.createHash("sha256").update(`oauth-state:${env.JWT_REFRESH_SECRET}`).digest();

export function sealState(s: OAuthState): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  const mac = crypto.createHmac("sha256", stateKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function openState(raw: string | undefined, now = Date.now()): OAuthState | null {
  if (!raw) return null;
  const [body, mac] = raw.split(".");
  if (!body || !mac) return null;
  const want = crypto.createHmac("sha256", stateKey()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    return s.exp > now ? s : null;
  } catch {
    return null;
  }
}

/** A path on the site to return to: same-site only ("/x", never "//host" or "https://…"). */
export function safeNext(raw: unknown, fallback = "/dashboard"): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\") || /[\r\n]/.test(s) || s.length > 300) return fallback;
  return s;
}

export function siteByKey(key: Site["key"]): Site {
  if (key === "grip") return gripSite() ?? racetraceSite();
  if (key === "setup") return setupSite() ?? racetraceSite();
  return racetraceSite();
}

export const redirectUriFor = (site: Site, provider: ProviderId) => `${site.url}/api/auth/oauth/${provider}/callback`;

/** Step 1: the provider's address to send the person to, and the sealed state for the cookie. */
export function beginSignIn(provider: ProviderId, site: Site, next: string): { url: string; sealed: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("base64url");
  const nonce = crypto.randomBytes(16).toString("base64url");
  const url = PROVIDERS[provider].authorizeUrl({ redirectUri: redirectUriFor(site, provider), state, challenge, nonce });
  const sealed = sealState({ provider, state, verifier, nonce, site: site.key, next, exp: Date.now() + STATE_TTL_MS });
  return { url, sealed };
}

// ── Finding or creating the user ──────────────────────────────────────────────

const withSub = { subscription: true } as const;

/**
 * The user this provider account signs in: already linked; else the account with the same
 * verified email (linked now); else a new account. Never links an unverified email to an
 * existing account.
 */
export async function userForProfile(provider: ProviderId, p: OAuthProfile, site: Site): Promise<{ user: any; created: boolean }> {
  const linked = (await prisma.userIdentity.findUnique({
    where: { provider_subject: { provider, subject: p.subject } },
    include: { user: { include: withSub } },
  })) as any;
  if (linked) {
    await prisma.userIdentity.update({ where: { id: linked.id }, data: { lastUsedAt: new Date() } });
    return { user: linked.user, created: false };
  }

  const email = p.email?.trim().toLowerCase() || null;
  if (!email) throw new AppError(400, `${PROVIDERS[provider].label} did not share an email address`, "OAUTH_NO_EMAIL");

  const existing = (await prisma.user.findUnique({ where: { email }, include: withSub })) as any;
  if (existing) {
    if (!p.emailVerified) throw new AppError(409, "An account with this email already exists", "OAUTH_EMAIL_TAKEN");
    await prisma.userIdentity.create({ data: { userId: existing.id, provider, subject: p.subject, email, lastUsedAt: new Date() } });
    if (!existing.emailVerified) {
      await prisma.user.update({ where: { id: existing.id }, data: { emailVerified: true } });
      existing.emailVerified = true;
    }
    return { user: existing, created: false };
  }

  // A new account. Its password is random and unknown: "Forgot password" sets one.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), env.BCRYPT_ROUNDS);
  const user = (await prisma.$transaction(async (tx: any) => {
    const u = await tx.user.create({
      data: {
        email,
        passwordHash,
        displayName: p.name?.slice(0, 100) || null,
        avatarUrl: p.picture && /^https:\/\//.test(p.picture) ? p.picture.slice(0, 500) : null,
        emailVerified: p.emailVerified,
      },
    });
    await tx.subscription.create({ data: { userId: u.id, plan: "FREE", status: "ACTIVE" } });
    await tx.userIdentity.create({ data: { userId: u.id, provider, subject: p.subject, email, lastUsedAt: new Date() } });
    return tx.user.findUnique({ where: { id: u.id }, include: withSub });
  })) as any;

  if (!p.emailVerified) {
    const { token, hash } = generateSecureToken();
    await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash: hash, expiresAt: getEmailVerifyExpiry() } });
    sendVerificationEmail(user.email, token, site).catch((err) => console.error("Failed to send verification email:", err));
  }
  return { user, created: true };
}

/** Step 2: exchange the code, find or create the user, start a session. */
export async function finishSignIn(
  provider: ProviderId,
  st: OAuthState,
  a: { code: string; form: Record<string, unknown>; meta: SessionMeta }
): Promise<{ result: AuthResult; created: boolean; site: Site }> {
  const site = siteByKey(st.site);
  const profile = await PROVIDERS[provider].profile({ code: a.code, redirectUri: redirectUriFor(site, provider), verifier: st.verifier, nonce: st.nonce, form: a.form });
  const { user, created } = await userForProfile(provider, profile, site);
  if (user.suspendedAt) throw new AppError(403, "Your account has been suspended", "ACCOUNT_SUSPENDED");
  return { result: await startSession(user, a.meta), created, site };
}

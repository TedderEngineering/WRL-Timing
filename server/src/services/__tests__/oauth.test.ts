import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pem = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const c = require("node:crypto") as typeof import("node:crypto");
  return c.generateKeyPairSync("ec", { namedCurve: "P-256", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
});

const db = vi.hoisted(() => ({
  identities: [] as any[],
  users: [] as any[],
}));
vi.mock("../../models/prisma.js", () => {
  const findUser = (where: any) => db.users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null;
  const prisma: any = {
    userIdentity: {
      findUnique: async ({ where }: any) => {
        const i = db.identities.find((x) => x.provider === where.provider_subject.provider && x.subject === where.provider_subject.subject);
        return i ? { ...i, user: findUser({ id: i.userId }) } : null;
      },
      update: async () => ({}),
      create: async ({ data }: any) => (db.identities.push({ id: `i${db.identities.length}`, ...data }), data),
    },
    user: {
      findUnique: async ({ where }: any) => findUser(where),
      update: async ({ where, data }: any) => Object.assign(findUser(where), data),
      create: async ({ data }: any) => {
        const u = { id: `u${db.users.length + 1}`, role: "USER", onboardingDone: false, createdAt: new Date(), avatarUrl: null, suspendedAt: null, subscription: null, ...data };
        db.users.push(u);
        return u;
      },
    },
    subscription: { create: async () => ({}) },
    emailVerificationToken: { create: async () => ({}) },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  return { prisma };
});
vi.mock("../email.js", () => ({ sendVerificationEmail: vi.fn(async () => {}) }));
vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    JWT_ACCESS_SECRET: "x".repeat(32),
    JWT_REFRESH_SECRET: "y".repeat(32),
    BCRYPT_ROUNDS: 4,
    FRONTEND_URL: "https://racetrace.example.com",
    GOOGLE_CLIENT_ID: "gid",
    GOOGLE_CLIENT_SECRET: "gsecret",
    APPLE_CLIENT_ID: "com.example.web",
    APPLE_TEAM_ID: "TEAM123",
    APPLE_KEY_ID: "KEY123",
    APPLE_PRIVATE_KEY: pem.privateKey.replace(/\n/g, "\\n"),
  },
}));

import {
  appleClientSecret,
  beginSignIn,
  configuredProviders,
  openState,
  safeNext,
  sealState,
  userForProfile,
} from "../oauth.js";
import { racetraceSite } from "../site.js";

beforeEach(() => {
  db.identities.length = 0;
  db.users.length = 0;
});

describe("sign in with another account", () => {
  it("offers only the providers that have settings", () => {
    expect(configuredProviders().map((p) => p.id)).toEqual(["google", "apple"]);
  });

  it("sends the person to Google with PKCE, a state and the site's own callback", () => {
    const { url, sealed } = beginSignIn("google", racetraceSite(), "/chart?race=r1");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("redirect_uri")).toBe("https://racetrace.example.com/api/auth/oauth/google/callback");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const st = openState(sealed)!;
    expect(st).toMatchObject({ provider: "google", site: "racetrace", next: "/chart?race=r1", state: u.searchParams.get("state") });
    expect(crypto.createHash("sha256").update(st.verifier).digest("base64url")).toBe(u.searchParams.get("code_challenge"));
  });

  it("refuses a tampered or expired state", () => {
    const s = { provider: "google" as const, state: "a", verifier: "v", nonce: "n", site: "racetrace" as const, next: "/", exp: Date.now() + 1000 };
    const sealed = sealState(s);
    expect(openState(sealed)).toMatchObject({ state: "a" });
    expect(openState(sealed.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    expect(openState(sealState({ ...s, exp: Date.now() - 1 }))).toBeNull();
    expect(openState(undefined)).toBeNull();
  });

  it("only returns to a page on the same site", () => {
    expect(safeNext("/chart?race=1")).toBe("/chart?race=1");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil", "", 5, "/x\r\nSet-Cookie: a"]) expect(safeNext(bad)).toBe("/dashboard");
  });

  it("signs Apple's client secret with the key (ES256, verifiable)", () => {
    const jwt = appleClientSecret(1_800_000_000);
    const [h, p, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({ iss: "TEAM123", sub: "com.example.web", aud: "https://appleid.apple.com", exp: 1_800_000_300 });
    expect(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: pem.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("creates an account for a new email, then signs the same account in next time", async () => {
    const p = { subject: "g-1", email: "Ann@Example.com", emailVerified: true, name: "Ann Driver", picture: "https://x/y.png" };
    const first = await userForProfile("google", p, racetraceSite());
    expect(first.created).toBe(true);
    expect(first.user).toMatchObject({ email: "ann@example.com", displayName: "Ann Driver", emailVerified: true });
    const again = await userForProfile("google", { ...p, email: "changed@example.com" }, racetraceSite());
    expect(again).toMatchObject({ created: false, user: { id: first.user.id } });
  });

  it("links a verified email to the existing account, but never an unverified one", async () => {
    db.users.push({ id: "u-old", email: "bob@example.com", emailVerified: false, role: "USER", subscription: null });
    await expect(userForProfile("microsoft", { subject: "m-1", email: "bob@example.com", emailVerified: false, name: null, picture: null }, racetraceSite())).rejects.toMatchObject({ code: "OAUTH_EMAIL_TAKEN" });
    const r = await userForProfile("google", { subject: "g-2", email: "bob@example.com", emailVerified: true, name: null, picture: null }, racetraceSite());
    expect(r).toMatchObject({ created: false, user: { id: "u-old", emailVerified: true } });
    expect(db.identities).toEqual([expect.objectContaining({ provider: "google", subject: "g-2", userId: "u-old" })]);
  });

  it("asks for another way in when the provider shares no email", async () => {
    await expect(userForProfile("github", { subject: "gh-1", email: null, emailVerified: false, name: "x", picture: null }, racetraceSite())).rejects.toMatchObject({ code: "OAUTH_NO_EMAIL" });
  });
});

/**
 * Race Analysis Package routes (G5): upload, publish/supersede/rollback,
 * reject, draft visibility, Rule Flags stripping, ETag/304, feature flag.
 * Prisma and Supabase Storage are replaced by in-memory fakes; the real app
 * (createApp) is used so body parsing and auth run as in production.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import request from "supertest";

// ─── Fakes ───────────────────────────────────────────────────────────────────

const fake = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    races: new Map<string, Row>(),
    packages: [] as Row[],
    subs: new Map<string, Row>(),
    audit: [] as Row[],
    files: new Map<string, Buffer>(),
    seq: 0,
  };

  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === "NOT") return !matches(row, v);
      if (v && typeof v === "object" && "not" in v) return row[k] !== v.not;
      return row[k] === v;
    });
  const pick = (row: Row | undefined | null, select?: Row) => {
    if (!row) return null;
    if (!select) return row;
    const out: Row = {};
    for (const k of Object.keys(select)) out[k] = row[k];
    return out;
  };
  const byVersionDesc = (a: Row, b: Row) => b.version - a.version;

  const prisma: Row = {
    race: {
      findUnique: async ({ where, select }: Row) => {
        const r = state.races.get(where.id);
        if (!r) return null;
        const out: Row = { ...r };
        if (select?.currentPackage) {
          out.currentPackage = state.packages.find((p) => p.id === r.currentPackageId) ?? null;
        }
        if (select?._count) out._count = { favorites: 0 };
        if (select?.entries) out.entries = [];
        if (select?.favorites) out.favorites = [];
        return out;
      },
      findMany: async ({ where }: Row) =>
        [...state.races.values()]
          .filter((r) => r.status === (where?.status ?? r.status))
          .filter((r) => !where?.createdAt?.lte || r.createdAt <= where.createdAt.lte)
          .sort((a, b) => b.date - a.date)
          .slice(0, 3)
          .map((r) => ({ id: r.id })),
      update: async ({ where, data }: Row) => Object.assign(state.races.get(where.id)!, data),
    },
    raceAnalysisPackage: {
      findUnique: async ({ where }: Row) =>
        where.id
          ? state.packages.find((p) => p.id === where.id) ?? null
          : state.packages.find(
              (p) => p.raceId === where.raceId_version.raceId && p.version === where.raceId_version.version
            ) ?? null,
      findFirst: async ({ where, select }: Row) =>
        pick(state.packages.filter((p) => matches(p, where)).sort(byVersionDesc)[0], select),
      findMany: async ({ where }: Row) => state.packages.filter((p) => matches(p, where)).sort(byVersionDesc),
      create: async ({ data }: Row) => {
        if (state.packages.some((p) => p.raceId === data.raceId && p.version === data.version)) {
          throw new Error("Unique constraint failed on (race_id, version)");
        }
        const row = {
          id: `pkg_${++state.seq}`,
          status: "DRAFT",
          rulebookVersion: null,
          dataQualityGrade: null,
          resultsStatus: null,
          publishedById: null,
          publishedAt: null,
          notes: null,
          createdAt: new Date(),
          ...data,
        };
        state.packages.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => Object.assign(state.packages.find((p) => p.id === where.id)!, data),
      updateMany: async ({ where, data }: Row) => {
        const rows = state.packages.filter((p) => matches(p, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    subscription: { findUnique: async ({ where }: Row) => state.subs.get(where.userId) ?? null },
    auditLog: { create: async ({ data }: Row) => (state.audit.push(data), data) },
    userRaceView: { create: async () => ({}) },
    $queryRaw: async () => [],
    $transaction: async (arg: unknown) =>
      typeof arg === "function" ? (arg as (tx: Row) => unknown)(prisma) : Promise.all(arg as unknown[]),
  };

  const bucket = {
    upload: async (p: string, body: Buffer) => {
      state.files.set(p, Buffer.from(body));
      return { error: null };
    },
    download: async (p: string) => {
      const b = state.files.get(p);
      return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "Object not found" } };
    },
  };

  return { state, prisma, supabase: { storage: { from: () => bucket } } };
});

vi.mock("../../models/prisma.js", () => ({ prisma: fake.prisma }));
vi.mock("../../lib/supabase.js", () => ({
  supabase: fake.supabase,
  STORAGE_BUCKET: "race-files",
  uploadRaceFiles: async () => ({}),
  downloadRaceFiles: async () => ({}),
}));
vi.mock("../../middleware/rate-limit.js", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return Object.fromEntries(Object.keys(orig).map((k) => [k, pass]));
});

import { createApp } from "../../app.js";
import { generateAccessToken } from "../../utils/tokens.js";
import { clearPackageCache } from "../../packages/store.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const app = createApp();
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const BASE = JSON.parse(
  fs.readFileSync(new URL("../../packages/__tests__/fixtures/minimal-package.json", import.meta.url), "utf8")
);
const PUBLISHABLE = JSON.parse(
  fs.readFileSync(new URL("../../packages/__tests__/fixtures/publishable-package.json", import.meta.url), "utf8")
);
const ARCHIVED_LAPS = "imports/arch-1/lapsCsv.csv";
const ARCHIVED_LAPS_BODY = Buffer.from("NUMBER;LAP_NUMBER;LAP_TIME\n7;1;1:38.973\n", "utf8");

/** A schema-valid draft whose first source file matches the race archive. */
function draftPackage(overrides: Record<string, unknown> = {}) {
  const pkg = structuredClone(BASE);
  pkg.sourceFiles[0].archive.path = ARCHIVED_LAPS;
  pkg.sourceFiles[0].sha256 = sha(ARCHIVED_LAPS_BODY);
  pkg.sourceFiles[0].bytes = ARCHIVED_LAPS_BODY.length;
  return Object.assign(pkg, overrides);
}

/** A package that also passes the publish gate: the same synthetic race with stories and summary written. */
function publishablePackage(packageId = "test-minimal-r1") {
  const pkg = structuredClone(PUBLISHABLE);
  pkg.sourceFiles[0].archive.path = ARCHIVED_LAPS;
  pkg.sourceFiles[0].sha256 = sha(ARCHIVED_LAPS_BODY);
  pkg.sourceFiles[0].bytes = ARCHIVED_LAPS_BODY.length;
  pkg.packageId = packageId;
  return pkg;
}

const users = {
  admin: { userId: "u_admin", email: "admin@example.com", role: "ADMIN" as const },
  pro: { userId: "u_pro", email: "pro@example.com", role: "USER" as const },
  team: { userId: "u_team", email: "team@example.com", role: "USER" as const },
};
const bearer = (u: (typeof users)[keyof typeof users]) => `Bearer ${generateAccessToken(u)}`;

const RACE = "race_1";
const DAY = 24 * 3600 * 1000;

const savedEnv = { packages: process.env.RACETRACE_PACKAGES, rules: process.env.RACETRACE_RULE_FLAGS };
afterAll(() => {
  process.env.RACETRACE_PACKAGES = savedEnv.packages;
  process.env.RACETRACE_RULE_FLAGS = savedEnv.rules;
});

beforeEach(() => {
  const s = fake.state;
  s.races.clear();
  s.packages.length = 0;
  s.subs.clear();
  s.audit.length = 0;
  s.files.clear();
  s.seq = 0;
  clearPackageCache();
  process.env.RACETRACE_PACKAGES = "on";
  process.env.RACETRACE_RULE_FLAGS = "R0";

  s.races.set(RACE, {
    id: RACE,
    name: "Race 1",
    date: new Date("2026-10-10T00:00:00Z"),
    track: "Indianapolis Motor Speedway",
    series: "GT4 America",
    season: 2026,
    status: "PUBLISHED",
    premium: false,
    maxLap: 34,
    totalCars: 34,
    createdAt: new Date(Date.now() - 2 * DAY),
    sourceFiles: { lapsCsv: ARCHIVED_LAPS },
    currentPackageId: null,
    packagesDisabled: false,
  });
  s.files.set(ARCHIVED_LAPS, ARCHIVED_LAPS_BODY);
  s.subs.set(users.pro.userId, { userId: users.pro.userId, plan: "PRO", status: "ACTIVE" });
  s.subs.set(users.team.userId, { userId: users.team.userId, plan: "TEAM", status: "ACTIVE" });
});

const upload = (body: Buffer | string, contentType = "application/json") =>
  request(app)
    .post(`/api/admin/races/${RACE}/packages`)
    .set("Authorization", bearer(users.admin))
    .set("Content-Type", contentType)
    .send(body);

const adminPost = (p: string, body?: object) =>
  request(app).post(`/api/admin/races/${RACE}/packages/${p}`).set("Authorization", bearer(users.admin)).send(body);

async function uploadAndPublish(packageId: string) {
  const up = await upload(JSON.stringify(publishablePackage(packageId)));
  expect(up.status).toBe(201);
  const pub = await adminPost(`${up.body.package.version}/publish`);
  expect(pub.status).toBe(200);
  return up.body.package.version as number;
}

// ─── Upload ──────────────────────────────────────────────────────────────────

describe("POST /api/admin/races/:id/packages", () => {
  it("stores a valid package as a draft, gzipped at packages/<raceId>/v<n>.json.gz", async () => {
    const text = JSON.stringify(draftPackage());
    const res = await upload(text);

    expect(res.status).toBe(201);
    expect(res.body.package).toMatchObject({
      version: 1,
      status: "draft",
      isCurrent: false,
      schemaVersion: "1.1.0",
      engineVersion: "1.0.0",
      sha256: sha(text),
      sizeBytes: Buffer.byteLength(text),
      resultsStatus: "provisional",
      dataQualityGrade: "limited", // partial sections in a draft
    });
    expect(res.body.report.passed).toBe(true);
    expect(res.body.report.sourceFiles.map((f: { status: string }) => f.status)).toEqual(["match", ...Array(BASE.sourceFiles.length - 1).fill("not_archived")]);

    const stored = fake.state.files.get(`packages/${RACE}/v1.json.gz`);
    expect(stored).toBeDefined();
    expect(gunzipSync(stored!).toString("utf8")).toBe(text);
    expect(fake.state.packages[0].storagePath).toBe(`packages/${RACE}/v1.json.gz`);
    expect(fake.state.audit.map((a) => a.action)).toEqual(["UPLOAD_RACE_PACKAGE"]);
  });

  it("accepts a gzip body and numbers versions per race", async () => {
    await upload(JSON.stringify(draftPackage()));
    const text = JSON.stringify(draftPackage({ packageId: "second-upload" }));
    const res = await upload(gzipSync(Buffer.from(text)), "application/gzip");

    expect(res.status).toBe(201);
    expect(res.body.package.version).toBe(2);
    expect(res.body.package.sha256).toBe(sha(text)); // hash of the JSON, not of the gzip
  });

  it("rejects a schema-invalid package with 422 and the report, storing nothing", async () => {
    const bad = draftPackage();
    bad.entries[0].car = 7; // car ids are strings ("007" ≠ "7")
    const res = await upload(JSON.stringify(bad));

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("PACKAGE_INVALID");
    expect(res.body.report.passed).toBe(false);
    expect(res.body.report.errors[0]).toMatchObject({ code: "SCHEMA", path: "/entries/0/car" });
    expect(fake.state.packages).toHaveLength(0);
    expect([...fake.state.files.keys()].some((k) => k.startsWith("packages/"))).toBe(false);
    expect(fake.state.audit.map((a) => a.action)).toEqual(["UPLOAD_RACE_PACKAGE_REJECTED"]);
  });

  it("rejects a package whose source file differs from the race's archived file", async () => {
    const pkg = draftPackage();
    pkg.sourceFiles[0].sha256 = "0".repeat(64);
    const res = await upload(JSON.stringify(pkg));

    expect(res.status).toBe(422);
    expect(res.body.report.errors).toEqual([
      expect.objectContaining({ code: "SOURCE_HASH_MISMATCH", path: "/sourceFiles/0/sha256" }),
    ]);
    expect(fake.state.packages).toHaveLength(0);
  });

  it("refuses non-JSON, unknown schema versions, duplicates and oversize bodies", { timeout: 20_000 }, async () => {
    expect((await upload("{not json")).body.code).toBe("INVALID_JSON");

    const v2 = await upload(JSON.stringify(draftPackage({ schemaVersion: "2.0.0" })));
    expect(v2.status).toBe(422);
    expect(v2.body.report.errors[0].code).toBe("UNSUPPORTED_SCHEMA_VERSION");

    const text = JSON.stringify(draftPackage());
    expect((await upload(text)).status).toBe(201);
    const dup = await upload(text);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("DUPLICATE_PACKAGE");

    const big = await upload(Buffer.alloc(25 * 1024 * 1024 + 1, 0x20), "application/octet-stream");
    expect(big.status).toBe(413);
    expect(big.body.code).toBe("PACKAGE_TOO_LARGE");

    // A small gzip that inflates past the 128 MB decompressed cap.
    const bomb = await upload(gzipSync(Buffer.alloc(129 * 1024 * 1024, 0x20)), "application/gzip");
    expect(bomb.status).toBe(413);
    expect(bomb.body.code).toBe("PACKAGE_TOO_LARGE");
  });

  it("is admin-only", async () => {
    const res = await request(app)
      .post(`/api/admin/races/${RACE}/packages`)
      .set("Authorization", bearer(users.team))
      .set("Content-Type", "application/json")
      .send(JSON.stringify(draftPackage()));
    expect(res.status).toBe(403);
    expect(fake.state.packages).toHaveLength(0);
  });
});

// ─── Publish / supersede / rollback / reject ─────────────────────────────────

describe("publish, supersede, rollback, reject", () => {
  it("publishes, supersedes the previous version, and rolls back", async () => {
    const v1 = await uploadAndPublish("pkg-one");
    const race = fake.state.races.get(RACE)!;
    const row = (v: number) => fake.state.packages.find((p) => p.version === v)!;
    expect(row(v1).status).toBe("PUBLISHED");
    expect(row(v1).publishedById).toBe(users.admin.userId);
    expect(race.currentPackageId).toBe(row(v1).id);

    const up2 = await upload(JSON.stringify(publishablePackage("pkg-two")));
    const pub2 = await adminPost("2/publish");
    expect(pub2.status).toBe(200);
    expect(pub2.body).toMatchObject({ package: { version: 2, status: "published", isCurrent: true }, previousVersion: 1 });
    expect(up2.body.package.version).toBe(2);
    expect(row(1).status).toBe("SUPERSEDED");
    expect(race.currentPackageId).toBe(row(2).id);

    const back = await adminPost("1/rollback");
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ package: { version: 1, status: "published" }, previousVersion: 2 });
    expect(row(1).status).toBe("PUBLISHED");
    expect(row(2).status).toBe("SUPERSEDED");
    expect(race.currentPackageId).toBe(row(1).id);
    expect(fake.state.packages.filter((p) => p.status === "PUBLISHED")).toHaveLength(1);

    expect((await adminPost("1/publish")).body.code).toBe("ALREADY_PUBLISHED");
    expect((await adminPost("1/rollback")).body.code).toBe("ALREADY_CURRENT");
    expect((await adminPost("2/publish")).body.code).toBe("USE_ROLLBACK");

    const list = await request(app).get(`/api/admin/races/${RACE}/packages`).set("Authorization", bearer(users.admin));
    expect(list.body.currentVersion).toBe(1);
    expect(list.body.packages.map((p: { version: number; status: string }) => [p.version, p.status])).toEqual([
      [2, "superseded"],
      [1, "published"],
    ]);

    expect(fake.state.audit.map((a) => a.action)).toEqual([
      "UPLOAD_RACE_PACKAGE",
      "PUBLISH_RACE_PACKAGE",
      "UPLOAD_RACE_PACKAGE",
      "PUBLISH_RACE_PACKAGE",
      "ROLLBACK_RACE_PACKAGE",
    ]);
  });

  it("refuses to publish a package that fails the publish gate", async () => {
    await upload(JSON.stringify(draftPackage())); // partial sections, no race summary
    const res = await adminPost("1/publish");

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("PACKAGE_NOT_PUBLISHABLE");
    expect(res.body.report.errors.every((e: { code: string }) => e.code === "PUBLISH_GATE")).toBe(true);
    expect(fake.state.packages[0].status).toBe("DRAFT");
    expect(fake.state.races.get(RACE)!.currentPackageId).toBeNull();
  });

  it("rejects a draft but never the current package", async () => {
    await uploadAndPublish("pkg-one");
    await upload(JSON.stringify(publishablePackage("pkg-two")));

    const rej = await adminPost("2/reject", { reason: "wrong session" });
    expect(rej.status).toBe(200);
    expect(rej.body.package).toMatchObject({ version: 2, status: "rejected", notes: "Rejected: wrong session" });
    expect((await adminPost("2/publish")).body.code).toBe("PACKAGE_REJECTED");
    expect((await adminPost("1/reject")).body.code).toBe("CANNOT_REJECT_CURRENT");
  });
});

// ─── Read ────────────────────────────────────────────────────────────────────

describe("GET /api/races/:id/package", () => {
  const get = (query = "", auth?: string) => {
    const r = request(app).get(`/api/races/${RACE}/package${query}`);
    return auth ? r.set("Authorization", auth) : r;
  };

  it("lets an admin read a draft by version, but not a user", async () => {
    await upload(JSON.stringify(draftPackage()));

    const admin = await get("?version=1", bearer(users.admin));
    expect(admin.status).toBe(200);
    expect(admin.headers["x-racetrace-package-status"]).toBe("draft");
    expect(admin.headers["cache-control"]).toBe("private, no-cache");
    expect(admin.body.packageId).toBe("test-minimal-r1");

    const user = await get("?version=1", bearer(users.pro));
    expect(user.status).toBe(404);
    expect(user.body.code).toBe("PACKAGE_NOT_FOUND");

    const current = await get("", bearer(users.pro));
    expect(current.status).toBe(404);
    expect(current.body.code).toBe("NO_PACKAGE");
  });

  it("strips ruleChecks and ruleFindings for viewers below the Rule Flags stage", async () => {
    await uploadAndPublish("pkg-one");

    const user = await get("", bearer(users.pro));
    expect(user.status).toBe(200);
    expect(user.headers["x-racetrace-rule-flags"]).toBe("hidden");
    expect(user.body.ruleFindings).toEqual([]);
    expect(user.body.ruleChecks).toEqual([]);
    expect(user.body.entries.map((e: { car: string }) => e.car)).toEqual(expect.arrayContaining(["007", "07", "7"])); // identity stays a string

    const admin = await get("", bearer(users.admin));
    expect(admin.headers["x-racetrace-rule-flags"]).toBe("included");
    expect(admin.body.ruleFindings).toHaveLength(1);
    expect(admin.body.ruleChecks).toHaveLength(1);
    expect(admin.headers.etag).not.toBe(user.headers.etag);

    // R1: the Team plan sees them too; Pro still does not.
    process.env.RACETRACE_RULE_FLAGS = "R1";
    expect((await get("", bearer(users.team))).body.ruleFindings).toHaveLength(1);
    expect((await get("", bearer(users.pro))).body.ruleFindings).toEqual([]);
  });

  it("serves gzip with an ETag of the sha256 and answers If-None-Match with 304", async () => {
    await uploadAndPublish("pkg-one");
    const row = fake.state.packages[0];

    const first = await get("", bearer(users.admin)).set("Accept-Encoding", "gzip");
    expect(first.status).toBe(200);
    expect(first.headers["content-encoding"]).toBe("gzip");
    expect(first.headers.etag).toBe(`"${row.sha256}"`);
    expect(first.headers["x-racetrace-package-version"]).toBe("1");
    expect(first.headers["cache-control"]).toBe("private, max-age=60");
    expect(first.headers.vary).toContain("Authorization");

    const again = await get("", bearer(users.admin)).set("If-None-Match", first.headers.etag);
    expect(again.status).toBe(304);
    expect(again.text ?? "").toBe("");

    const plain = await get("", bearer(users.admin)).set("Accept-Encoding", "identity");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(sha(plain.text)).toBe(row.sha256); // exactly the uploaded bytes
  });

  it("answers 404 PACKAGES_DISABLED when the switch is off, globally or for one race", async () => {
    await uploadAndPublish("pkg-one");

    process.env.RACETRACE_PACKAGES = "off";
    const off = await get("", bearer(users.pro));
    expect(off.status).toBe(404);
    expect(off.body.code).toBe("PACKAGES_DISABLED");
    expect((await get("")).body.code).toBe("PACKAGES_DISABLED");
    expect((await get("", bearer(users.admin))).status).toBe(200); // admins can still review

    process.env.RACETRACE_PACKAGES = "on";
    const set = await request(app)
      .put(`/api/admin/races/${RACE}/packages/override`)
      .set("Authorization", bearer(users.admin))
      .send({ disabled: true });
    expect(set.status).toBe(200);
    expect((await get("", bearer(users.pro))).body.code).toBe("PACKAGES_DISABLED");
    expect(fake.state.audit.at(-1)).toMatchObject({ action: "SET_RACE_PACKAGES_OVERRIDE", details: { disabled: true } });
  });

  it("keeps the /chart-data access gating", async () => {
    await uploadAndPublish("pkg-one");
    // Make the race too new for the free tier (10-hour rule).
    fake.state.races.get(RACE)!.createdAt = new Date();

    const anon = await get("");
    expect(anon.status).toBe(403);
    expect(anon.body.code).toBe("AUTH_REQUIRED");
    expect((await get("", bearer(users.pro))).status).toBe(200);
  });

  it("hides draft races from users", async () => {
    await uploadAndPublish("pkg-one");
    fake.state.races.get(RACE)!.status = "DRAFT";
    expect((await get("", bearer(users.pro))).body.code).toBe("RACE_NOT_FOUND");
  });
});

// ─── Race detail ─────────────────────────────────────────────────────────────

describe("GET /api/races/:id package fields", () => {
  it("reports hasPackage, version, results status and data grade", async () => {
    const none = await request(app).get(`/api/races/${RACE}`).set("Authorization", bearer(users.pro));
    expect(none.body).toMatchObject({ hasPackage: false, packageVersion: null, resultsStatus: null });
    expect(none.body.packageAdmin).toBeUndefined();

    await uploadAndPublish("pkg-one");
    const res = await request(app).get(`/api/races/${RACE}`).set("Authorization", bearer(users.pro));
    expect(res.body).toMatchObject({
      hasPackage: true,
      packageVersion: 1,
      resultsStatus: "provisional",
      dataQualityGrade: "check_notes", // complete sections; the fixture keeps one warning note
    });
    expect(res.body.packageAdmin).toBeUndefined();

    process.env.RACETRACE_PACKAGES = "off";
    const off = await request(app).get(`/api/races/${RACE}`).set("Authorization", bearer(users.admin));
    expect(off.body).toMatchObject({ hasPackage: false, packageVersion: null });
    expect(off.body.packageAdmin).toMatchObject({ currentVersion: 1, raceDisabled: false, flag: "off" });
  });
});

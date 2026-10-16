import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));
vi.mock("../../lib/supabase.js", () => ({ supabase: null, STORAGE_BUCKET: "race-files" }));

import { supportedSchemaVersions, validatePackage, emptyReport, finaliseReport } from "../validator.js";
import { checkSourceFiles, deriveDataQualityGrade, deriveResultsStatus } from "../service.js";
import { canSeeRuleFlags } from "../flags.js";

const BASE = JSON.parse(fs.readFileSync(new URL("./fixtures/minimal-package.json", import.meta.url), "utf8"));
const clone = () => structuredClone(BASE);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("validatePackage (schema stage)", () => {
  it("loads the shared schema and accepts the fixture", () => {
    expect(supportedSchemaVersions()).toContain("1.1.0");
    const r = validatePackage(clone());
    expect(r).toMatchObject({ passed: true, schemaVersion: "1.1.0", errorCount: 0 });
  });

  it("rejects unknown properties, numeric car ids and timestamp race dates", () => {
    const pkg = clone();
    pkg.surprise = 1;
    pkg.entries[0].car = 7;
    pkg.metadata.raceDate = "2026-10-10T00:00:00Z";
    const r = validatePackage(pkg);
    expect(r.passed).toBe(false);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["", "/entries/0/car", "/metadata/raceDate"]));
  });

  it("applies the publish gate only when asked", () => {
    expect(validatePackage(clone()).passed).toBe(true);
    const gate = validatePackage(clone(), { asPublished: true });
    expect(gate.passed).toBe(false);
    expect(gate.errors.some((e) => e.code === "PUBLISH_GATE")).toBe(true);
  });

  it("names an unsupported schemaVersion", () => {
    const r = validatePackage({ ...clone(), schemaVersion: "9.9.9" });
    expect(r.errors[0].code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(validatePackage([]).errors[0].code).toBe("NOT_AN_OBJECT");
  });
});

describe("derived columns", () => {
  it("grades data quality", () => {
    const pkg = clone();
    expect(deriveDataQualityGrade(pkg)).toBe("limited"); // partial sections
    for (const k of Object.keys(pkg.completeness)) pkg.completeness[k] = "complete";
    expect(deriveDataQualityGrade(pkg)).toBe("check_notes"); // a warning note
    pkg.dataQuality = [];
    expect(deriveDataQualityGrade(pkg)).toBe("good");
    pkg.completeness.ruleChecks = "absent";
    expect(deriveDataQualityGrade(pkg)).toBe("good"); // rule checks are admin-only
    pkg.dataQuality = [{ id: "dq:1", severity: "blocker", code: "X1", message: "m" }];
    expect(deriveDataQualityGrade(pkg)).toBe("limited");
  });

  it("maps results status", () => {
    expect(deriveResultsStatus({ metadata: { resultsStatus: "official" } })).toBe("OFFICIAL");
    expect(deriveResultsStatus({ metadata: { resultsStatus: "unofficial" } })).toBe("PROVISIONAL");
    expect(deriveResultsStatus({ metadata: { resultsStatus: "none" } })).toBeNull();
  });
});

describe("checkSourceFiles", () => {
  it("matches a PDF archived as a data URL by its decoded bytes", async () => {
    const pdf = Buffer.from("%PDF-1.4 test");
    const archived = Buffer.from(`data:application/pdf;base64,${pdf.toString("base64")}`);
    const pkg = { sourceFiles: [{ fileId: "f1", name: "cards.pdf", sha256: sha(pdf), archive: { path: "race-files/imports/a/pitPdf.pdf" } }] };
    const report = emptyReport("1.1.0");
    await checkSourceFiles(pkg, { pitPdf: "imports/a/pitPdf.pdf" }, report, async () => archived);
    expect(finaliseReport(report).passed).toBe(true);
    expect(report.sourceFiles?.[0]).toMatchObject({ status: "match", archivePath: "imports/a/pitPdf.pdf" });
  });

  it("warns, without failing, when the race has no archive", async () => {
    const report = emptyReport("1.1.0");
    await checkSourceFiles(clone(), null, report);
    expect(finaliseReport(report).passed).toBe(true);
    expect(report.warnings[0].code).toBe("RACE_NOT_ARCHIVED");
  });
});

describe("Rule Flags visibility (OD-3)", () => {
  const v = (role: string | null, plan: string | null, signedIn = true) => ({ role, plan, signedIn });
  it("R0 admins only; R1 adds Team; R2 adds every signed-in user", () => {
    expect(canSeeRuleFlags(v("ADMIN", null), "R0")).toBe(true);
    expect(canSeeRuleFlags(v("USER", "TEAM"), "R0")).toBe(false);
    expect(canSeeRuleFlags(v("USER", "TEAM"), "R1")).toBe(true);
    expect(canSeeRuleFlags(v("USER", "PRO"), "R1")).toBe(false);
    expect(canSeeRuleFlags(v("USER", "FREE"), "R2")).toBe(true);
    expect(canSeeRuleFlags(v(null, null, false), "R2")).toBe(false);
  });
});

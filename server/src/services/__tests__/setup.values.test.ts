import { describe, it, expect, vi } from "vitest";

const env = vi.hoisted((): Record<string, string | undefined> => ({ SETUP_ACCESS: "admin", SETUP_TESTER_EMAILS: undefined }));
vi.mock("../../config/env.js", () => ({ env }));
vi.mock("../../models/prisma.js", () => ({ prisma: {} }));

import {
  applyPatch,
  carryForward,
  cleanValues,
  dateOnlySchema,
  diffValues,
  fromDateOnly,
  readValues,
  sheetPatchSchema,
  sheetValuesSchema,
  toDateOnly,
  MAX_SHEET_KEYS,
} from "../setup/values.js";
import { canUseSetup, roleAtLeast } from "../setup/access.js";

describe("sheet values", () => {
  it("keeps values exactly as typed, trimmed, and drops empty ones", () => {
    expect(cleanValues({ "lf.camber": " -4.8 ", "lr.toe": "1 IN", "lf.caster": "", "rf.caster": null })).toEqual({
      "lf.camber": "-4.8",
      "lr.toe": "1 IN",
    });
  });

  it("reads stored JSON defensively", () => {
    expect(readValues({ "lf.rebound": "8", bad: 3, "x.y": "" })).toEqual({ "lf.rebound": "8" });
    expect(readValues(null)).toEqual({});
    expect(readValues(["a"])).toEqual({});
  });

  it("patches only the keys sent and reports what changed", () => {
    const { next, changes } = applyPatch(
      { "lf.rebound": "6", "rf.rebound": "6", "car.brake_bias": "56" },
      { "lf.rebound": "8", "rf.rebound": "6", "car.brake_bias": "", "lf.camber": "-4.8" }
    );
    expect(next).toEqual({ "lf.rebound": "8", "rf.rebound": "6", "lf.camber": "-4.8" });
    expect(changes).toEqual([
      { key: "car.brake_bias", from: "56", to: null },
      { key: "lf.camber", from: null, to: "-4.8" },
      { key: "lf.rebound", from: "6", to: "8" },
    ]);
  });

  it("finds no changes when nothing differs", () => {
    expect(diffValues({ "a.b": "1" }, { "a.b": "1" })).toEqual([]);
    expect(applyPatch({ "a.b": "1" }, { "a.b": " 1 " }).changes).toEqual([]);
  });

  it("refuses to grow a sheet past the limit", () => {
    const full = Object.fromEntries(Array.from({ length: MAX_SHEET_KEYS }, (_, i) => [`p.k${i}`, "1"]));
    expect(() => applyPatch(full, { "p.extra": "1" })).toThrow(RangeError);
  });

  it("does not carry the setup date or crew into the next session", () => {
    expect(carryForward({ "lf.rebound": "8", "meta.setup_date": "2026-10-08", "meta.setup_people": "JT", "meta.driver_name": "Sam" })).toEqual({
      "lf.rebound": "8",
      "meta.driver_name": "Sam",
    });
  });

  it("accepts parameter keys and rejects anything else", () => {
    expect(sheetValuesSchema.safeParse({ "lf.rebound": "8", "meta.driver_weight": "200" }).success).toBe(true);
    for (const key of ["LF.rebound", "lf", "lf.", ".x", "lf.re bound", "__proto__.x", "a".repeat(17) + ".x"]) {
      expect(sheetValuesSchema.safeParse({ [key]: "1" }).success, key).toBe(false);
    }
    expect(sheetPatchSchema.safeParse({ "lf.rebound": null }).success).toBe(true);
    expect(sheetValuesSchema.safeParse({ "lf.rebound": "x".repeat(201) }).success).toBe(false);
  });
});

describe("dates without a time of day", () => {
  it("round-trips YYYY-MM-DD without shifting a day", () => {
    expect(fromDateOnly(toDateOnly("2026-10-09"))).toBe("2026-10-09");
    expect(toDateOnly(null)).toBeNull();
    expect(fromDateOnly(null)).toBeNull();
  });
  it("validates", () => {
    expect(dateOnlySchema.parse("2026-10-09")).toBe("2026-10-09");
    expect(dateOnlySchema.parse("")).toBeNull();
    expect(dateOnlySchema.parse(null)).toBeNull();
    expect(dateOnlySchema.safeParse("10/09/2026").success).toBe(false);
    expect(dateOnlySchema.safeParse("2026-13-45").success).toBe(false);
  });
});

describe("access", () => {
  it("ranks roles", () => {
    expect(roleAtLeast("OWNER", "ENGINEER")).toBe(true);
    expect(roleAtLeast("ENGINEER", "ENGINEER")).toBe(true);
    expect(roleAtLeast("VIEWER", "ENGINEER")).toBe(false);
    expect(roleAtLeast("VIEWER", "VIEWER")).toBe(true);
  });

  it("follows SETUP_ACCESS", () => {
    const user = { email: "Crew@Example.com", role: "USER" as const };
    const admin = { email: "a@example.com", role: "ADMIN" as const };
    env.SETUP_ACCESS = "off";
    expect(canUseSetup(admin)).toBe(false);
    env.SETUP_ACCESS = "admin";
    expect(canUseSetup(admin)).toBe(true);
    expect(canUseSetup(user)).toBe(false);
    env.SETUP_ACCESS = "testers";
    env.SETUP_TESTER_EMAILS = " crew@example.com , other@example.com";
    expect(canUseSetup(user)).toBe(true);
    expect(canUseSetup({ email: "x@example.com", role: "USER" })).toBe(false);
    env.SETUP_ACCESS = "public";
    expect(canUseSetup({ email: "x@example.com", role: "USER" })).toBe(true);
  });
});

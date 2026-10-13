import { describe, expect, it, vi } from "vitest";

vi.mock("../../models/prisma.js", () => ({ prisma: {} }));

import { apiTokenMayCall, requireAuth } from "../auth.js";

describe("API token route allowlist", () => {
  it("allows intake and draft-package upload/read", () => {
    expect(apiTokenMayCall("GET", "/api/admin/intake/whoami")).toBe(true);
    expect(apiTokenMayCall("GET", "/api/admin/intake/races?series=imsa")).toBe(true);
    expect(apiTokenMayCall("POST", "/api/admin/intake/races")).toBe(true);
    expect(apiTokenMayCall("POST", "/api/admin/races/abc123/packages")).toBe(true);
    expect(apiTokenMayCall("GET", "/api/admin/races/abc123/packages/")).toBe(true);
    expect(apiTokenMayCall("HEAD", "/api/admin/races/abc123/packages")).toBe(true);
  });

  it("refuses publishing, overrides, token management and every other admin or user route", () => {
    for (const [m, u] of [
      ["POST", "/api/admin/races/abc/packages/3/publish"],
      ["POST", "/api/admin/races/abc/packages/3/rollback"],
      ["POST", "/api/admin/races/abc/packages/3/reject"],
      ["PUT", "/api/admin/races/abc/packages/override"],
      ["DELETE", "/api/admin/intake/races"],
      ["GET", "/api/admin/api-tokens"],
      ["POST", "/api/admin/api-tokens"],
      ["DELETE", "/api/admin/races/abc"],
      ["PATCH", "/api/admin/users/u1"],
      ["POST", "/api/admin/races/import"],
      ["DELETE", "/api/users/me"],
      ["GET", "/api/admin/intake/../users"],
      ["POST", "/api/admin/races/abc/packages/../../abc"],
    ] as const) {
      expect(apiTokenMayCall(m, u), `${m} ${u}`).toBe(false);
    }
  });

  it("requireAuth rejects a token on a disallowed route before looking it up", () => {
    const next = vi.fn();
    requireAuth(
      { method: "DELETE", originalUrl: "/api/admin/races/abc", headers: { authorization: "Bearer rt_abcdefghijklmnopqrstuvwxyz0123456789" } } as any,
      {} as any,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, code: "TOKEN_ROUTE_NOT_ALLOWED" });
  });
});

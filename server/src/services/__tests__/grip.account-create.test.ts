import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gripAccount: { findUnique: vi.fn(), create: vi.fn() },
}));
vi.mock("../../models/prisma.js", () => ({ prisma: db }));

import { getOrCreateGripAccount } from "../grip/account.js";

beforeEach(() => {
  db.gripAccount.findUnique.mockReset();
  db.gripAccount.create.mockReset();
});

describe("getOrCreateGripAccount", () => {
  it("returns the existing account without writing", async () => {
    db.gripAccount.findUnique.mockResolvedValue({ userId: "u1" });
    expect(await getOrCreateGripAccount("u1")).toEqual({ userId: "u1" });
    expect(db.gripAccount.create).not.toHaveBeenCalled();
  });

  it("creates the account on first use", async () => {
    db.gripAccount.findUnique.mockResolvedValue(null);
    db.gripAccount.create.mockResolvedValue({ userId: "u1" });
    expect(await getOrCreateGripAccount("u1")).toEqual({ userId: "u1" });
    expect(db.gripAccount.create).toHaveBeenCalledWith({ data: { userId: "u1" } });
  });

  it("uses the row another request just created instead of failing", async () => {
    db.gripAccount.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: "u1" });
    db.gripAccount.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    expect(await getOrCreateGripAccount("u1")).toEqual({ userId: "u1" });
  });

  it("still reports other database errors", async () => {
    db.gripAccount.findUnique.mockResolvedValue(null);
    db.gripAccount.create.mockRejectedValue(Object.assign(new Error("connection lost"), { code: "P1001" }));
    await expect(getOrCreateGripAccount("u1")).rejects.toThrow("connection lost");
  });
});

import { describe, expect, it } from "vitest";
import { carNumbering } from "../carNumbers.js";

describe("car numbering", () => {
  it("keeps plain numbers and gives every other published number its own integer", () => {
    const n = carNumbering(["007", "7", "028", "4A", "4", "X1", " 12 ", "7"]);
    expect(["7", "4", "12"].map((r) => n.num(r))).toEqual([7, 4, 12]);
    expect(n.num("028")).toBe(28);
    const [a, b, c] = [n.num("007"), n.num("4A"), n.num("X1")];
    expect(new Set([a, b, c, 7, 4, 12, 28]).size).toBe(7);
    expect(a).toBeGreaterThanOrEqual(10000);
    expect(n.label(a!)).toBe("007");
    expect(n.label(b!)).toBe("4A");
    expect(n.label(28)).toBe("028");
    expect(n.label(7)).toBeUndefined();
    expect(n.collisions).toEqual([["007", "7"], ["4A", "4"]]);
  });

  it("does not depend on the order the files list the cars", () => {
    expect(carNumbering(["7", "007"]).num("7")).toBe(7);
    expect(carNumbering(["007", "7"]).num("7")).toBe(7);
  });

  it("never merges an unseen number into a taken one", () => {
    const n = carNumbering(["7", "8"]);
    expect(n.num("9")).toBe(9);
    expect(n.num("07")).toBeNull();
    expect(n.num("")).toBeNull();
  });
});

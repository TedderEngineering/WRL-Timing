import { beforeEach, describe, expect, it } from "vitest";
import { carTitle, hasPendingFollow, rememberPendingFollow, takePendingFollow, type MyCar } from "../api";

// A tiny in-memory sessionStorage (vitest runs these in Node).
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe("a follow asked for before signing up", () => {
  it("is done once, on the race it was asked on, within 15 minutes", () => {
    rememberPendingFollow("race1", "67");
    expect(hasPendingFollow()).toBe(true);
    expect(takePendingFollow("other")).toBeNull();
    expect(takePendingFollow("race1")).toBe("67");
    expect(takePendingFollow("race1")).toBeNull();
    expect(hasPendingFollow()).toBe(false);
  });

  it("expires", () => {
    rememberPendingFollow("race1", "67");
    expect(takePendingFollow("race1", Date.now() + 16 * 60 * 1000)).toBeNull();
  });
});

describe("car titles", () => {
  const car: MyCar = { id: "c", label: null, number: "67", series: "imsa", teamName: "Blackdog Racing", carClass: "GS", season: 2026 };
  it("lead with the user's label, else the number, team and season", () => {
    expect(carTitle(car)).toBe("#67 · Blackdog Racing · 2026");
    expect(carTitle({ ...car, teamName: null, season: null })).toBe("#67 · any season");
    expect(carTitle({ ...car, label: "Our Miata" })).toBe("Our Miata (#67)");
  });
});

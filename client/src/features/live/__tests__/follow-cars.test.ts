import { beforeEach, describe, expect, it } from "vitest";
import { readFollowedCars, saveFollowedCars, toggleFollow } from "../my-car";

// The tests run without a browser: a small in-memory localStorage.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

describe("cars followed on the live map", () => {
  beforeEach(() => localStorage.clear());

  it("follows a car, then stops following it", () => {
    expect(toggleFollow([], "119")).toEqual(["119"]);
    expect(toggleFollow(["119", "120"], "119")).toEqual(["120"]);
  });

  it("keeps the cars per race page on this device", () => {
    saveFollowedCars("sebring-sunday", ["119", "216x"]);
    expect(readFollowedCars("sebring-sunday")).toEqual(["119", "216x"]);
    expect(readFollowedCars("sebring-saturday")).toEqual([]);
    saveFollowedCars("sebring-sunday", []);
    expect(readFollowedCars("sebring-sunday")).toEqual([]);
  });

  it("ignores a damaged entry", () => {
    localStorage.setItem("rt.live.follow:x", "not json");
    expect(readFollowedCars("x")).toEqual([]);
  });
});

/**
 * Tests for detecting car numbers that collide once parsed as integers.
 *
 * The real case that prompted this: SRO GT4 America, COTA Race 1, 2025 — cars
 * "007" (ProSport, Am), "07" (Skip Barber, Am) and "7" (ACI, Pro-Am) ran in the
 * same race, and the import silently kept one of the three.
 */
import { describe, it, expect } from "vitest";
import {
  findCarNumberCollisions,
  carNumberCollisionWarnings,
} from "../../carNumberCollisions.js";

describe("findCarNumberCollisions", () => {
  it("finds nothing when every car number is already distinct", () => {
    expect(findCarNumberCollisions(["12", "19", "60", "95"])).toEqual([]);
  });

  it("groups leading-zero variants onto the integer they share", () => {
    const [c] = findCarNumberCollisions(["007", "12", "07", "7", "19"]);
    expect(c.parsed).toBe(7);
    expect(c.sources).toEqual(["007", "07", "7"]);
  });

  it("preserves first-appearance order, so the survivor is last", () => {
    const [c] = findCarNumberCollisions(["7", "07", "007"]);
    expect(c.sources).toEqual(["7", "07", "007"]);
  });

  it("ignores repeats of the same car number", () => {
    expect(findCarNumberCollisions(["7", "7", "7"])).toEqual([]);
  });

  it("skips non-numeric car numbers rather than grouping them at NaN", () => {
    expect(findCarNumberCollisions(["TBC", "N/A", "7"])).toEqual([]);
  });

  it("reports several collisions, ordered by the shared integer", () => {
    const found = findCarNumberCollisions(["07", "7", "003", "3"]);
    expect(found.map((c) => c.parsed)).toEqual([3, 7]);
  });

  it("attaches per-car lap counts when supplied", () => {
    const counts = new Map([["007", 71], ["07", 69], ["7", 72]]);
    const [c] = findCarNumberCollisions(["007", "07", "7"], counts);
    expect(c.lapRecords).toEqual([71, 69, 72]);
  });
});

describe("carNumberCollisionWarnings", () => {
  it("names what is kept and what is lost", () => {
    const [w] = carNumberCollisionWarnings(
      findCarNumberCollisions(["007", "07", "7"])
    );
    expect(w).toContain('"007", "07", "7"');
    expect(w).toContain("reduce to 7");
    expect(w).toContain('only "7" will be kept');
  });

  it("quantifies the loss when lap counts are known", () => {
    const counts = new Map([["007", 71], ["07", 69], ["7", 72]]);
    const [w] = carNumberCollisionWarnings(
      findCarNumberCollisions(["007", "07", "7"], counts)
    );
    // 71 + 69 discarded; the 72 belonging to the survivor is kept
    expect(w).toContain("140 lap record(s) will be dropped");
  });

  it("says nothing when nothing collides", () => {
    expect(carNumberCollisionWarnings(findCarNumberCollisions(["1", "2"]))).toEqual([]);
  });
});

/**
 * A race date is a calendar day, not a moment. The API sends it as UTC midnight,
 * so formatting it in the viewer's local zone shows the previous day for anyone
 * west of UTC — which is what every race on the site was doing.
 *
 * These tests fix the timezone during the run so the bug cannot hide behind the
 * machine that happens to execute them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  formatRaceDate,
  formatRaceDateLong,
  toDateInputValue,
} from "../race-dates";

const ORIGINAL_TZ = process.env.TZ;

// UTC-4: the zone in which the original bug was observed.
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const VIR = "2026-08-22T00:00:00.000Z";

describe("formatRaceDate", () => {
  it("shows the day that was stored, not the previous one", () => {
    expect(formatRaceDate(VIR)).toBe("8/22/2026");
  });

  it("does not slip a day back across a month boundary", () => {
    expect(formatRaceDate("2025-04-01T00:00:00.000Z")).toBe("4/1/2025");
  });

  it("does not slip a day back across a year boundary", () => {
    expect(formatRaceDate("2026-01-01T00:00:00.000Z")).toBe("1/1/2026");
  });

  it("differs from the naive local rendering that caused the bug", () => {
    // Guards the fix: if someone reverts to toLocaleDateString these agree again.
    const naive = new Date(VIR).toLocaleDateString();
    expect(formatRaceDate(VIR)).not.toBe(naive);
  });

  it("returns an empty string for an unparseable value", () => {
    expect(formatRaceDate("not a date")).toBe("");
  });
});

describe("formatRaceDateLong", () => {
  it("spells out the stored day", () => {
    expect(formatRaceDateLong(VIR)).toBe("August 22, 2026");
  });

  it("returns an empty string for an unparseable value", () => {
    expect(formatRaceDateLong("")).toBe("");
  });
});

describe("toDateInputValue", () => {
  it("gives the date input the stored day", () => {
    expect(toDateInputValue(VIR)).toBe("2026-08-22");
  });

  it("round-trips a value typed into the input", () => {
    const typed = "2026-08-22";
    expect(toDateInputValue(`${typed}T00:00:00.000Z`)).toBe(typed);
  });

  it("returns an empty string for an unparseable value", () => {
    expect(toDateInputValue("nope")).toBe("");
  });
});

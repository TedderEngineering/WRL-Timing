/**
 * Tests for deriving a race date from an Alkamel pit stop PDF footer.
 *
 * The footer is the only text on the page carrying a date — the event header
 * above it is a raster image. Because the footer records when the report was
 * exported rather than when the race ran, the suggestion is corroborated
 * against the last lap's clock time from the Time Cards CSV.
 */
import { describe, it, expect } from "vitest";
import {
  extractPdfExportStamp,
  latestSessionClock,
  suggestRaceDate,
} from "../../suggestRaceDate.js";

// Real footer text, as pdf-parse extracts it.
const IMSA_FOOTER = "8/22/2026 4:24 PM Page 1 / 2";
const SRO_FOOTER = "4/26/2025 8:09 PM Page 1 / 2";

const TIME_CARDS = [
  "NUMBER; DRIVER_NUMBER; LAP_NUMBER; LAP_TIME; ELAPSED; HOUR;",
  "12;2;1;2:00.735;2:00.735;14:17:29.521;",
  "12;2;2;1:56.392;3:57.127;14:19:25.913;",
  "19;1;58;1:58.000;2:02:06.175;16:17:34.961;",
].join("\n");

describe("extractPdfExportStamp", () => {
  it("reads a PM timestamp", () => {
    const s = extractPdfExportStamp(`some table text\n${IMSA_FOOTER}`)!;
    expect(s.date).toBe("2026-08-22");
    expect(s.timeSec).toBe(16 * 3600 + 24 * 60);
    expect(s.raw).toBe("8/22/2026 4:24 PM");
  });

  it("keeps 12 AM and 12 PM the right way round", () => {
    expect(extractPdfExportStamp("1/2/2025 12:30 AM")!.timeSec).toBe(30 * 60);
    expect(extractPdfExportStamp("1/2/2025 12:30 PM")!.timeSec).toBe(12 * 3600 + 30 * 60);
  });

  it("zero-pads single-digit months and days", () => {
    expect(extractPdfExportStamp("4/6/2025 8:09 PM")!.date).toBe("2025-04-06");
  });

  it("returns null when the footer is absent", () => {
    expect(extractPdfExportStamp("Race Pit Stop Time Cards\n2 CSM")).toBeNull();
  });
});

describe("latestSessionClock", () => {
  it("finds the clock time of the last recorded lap", () => {
    expect(latestSessionClock(TIME_CARDS)).toBeCloseTo(
      16 * 3600 + 17 * 60 + 34.961,
      3
    );
  });

  it("returns null without an HOUR column", () => {
    expect(latestSessionClock("NUMBER;LAP_NUMBER\n12;1\n")).toBeNull();
  });
});

describe("suggestRaceDate", () => {
  it("is confident when the export follows the last lap on the same day", () => {
    const r = suggestRaceDate(IMSA_FOOTER, TIME_CARDS);
    expect(r.date).toBe("2026-08-22");
    expect(r.confidence).toBe("high");
    expect(r.sessionEnd).toBe("16:17");
    // 16:24:00 export minus a 16:17:34.961 last lap is 6.4 minutes.
    expect(r.note).toMatch(/6 minute/);
  });

  it("is unconfident when the export predates the last lap", () => {
    // 8:09 PM export against a session ending 16:17 is fine; use a morning
    // export instead, which cannot be the same race day.
    const r = suggestRaceDate("8/22/2026 9:15 AM Page 1 / 2", TIME_CARDS);
    expect(r.date).toBe("2026-08-22");
    expect(r.confidence).toBe("low");
    expect(r.note).toMatch(/later day/);
  });

  it("is unconfident when there is no lap data to corroborate", () => {
    const r = suggestRaceDate(SRO_FOOTER);
    expect(r.date).toBe("2025-04-26");
    expect(r.confidence).toBe("low");
    expect(r.sessionEnd).toBeNull();
  });

  it("reports nothing rather than guessing when the footer is missing", () => {
    const r = suggestRaceDate("Race Pit Stop Time Cards", TIME_CARDS);
    expect(r.date).toBeNull();
    expect(r.confidence).toBe("none");
  });
});

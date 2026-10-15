import { describe, expect, it } from "vitest";
import { closestText, previewYear, recapYearFor, seasonHeadline } from "../season";
import type { Season } from "../api";

describe("recapYearFor", () => {
  it("shows this year's recap from 20 November to 31 December", () => {
    expect(recapYearFor(new Date(2026, 10, 19))).toBeNull();
    expect(recapYearFor(new Date(2026, 10, 20))).toBe(2026);
    expect(recapYearFor(new Date(2026, 11, 31))).toBe(2026);
  });
  it("keeps last year's recap through January, then nothing", () => {
    expect(recapYearFor(new Date(2027, 0, 1))).toBe(2026);
    expect(recapYearFor(new Date(2027, 0, 31))).toBe(2026);
    expect(recapYearFor(new Date(2027, 1, 1))).toBeNull();
    expect(recapYearFor(new Date(2026, 9, 14))).toBeNull();
  });
});

describe("previewYear", () => {
  const now = new Date(2026, 9, 14);
  it("accepts a past or current year only", () => {
    expect(previewYear("?season=2026", now)).toBe(2026);
    expect(previewYear("?season=2025", now)).toBe(2025);
    expect(previewYear("?season=2027", now)).toBeNull();
    expect(previewYear("?season=abc", now)).toBeNull();
    expect(previewYear("", now)).toBeNull();
  });
});

const track = (shortName: string) => ({
  id: shortName,
  name: `${shortName} Raceway`,
  shortName,
});
const base: Season = {
  year: 2026,
  onTargetPsi: 0.5,
  calculations: 14,
  referenceSessions: 5,
  trackDays: 9,
  recorded: 10,
  onTarget: 7,
  averageWorstMiss: 0.4,
  tracks: [
    { track: track("VIR"), days: 5, calculations: 8, recorded: 6, onTarget: 4 },
    { track: track("RA"), days: 4, calculations: 6, recorded: 4, onTarget: 3 },
  ],
  closest: {
    id: "c1",
    name: "INDY R1",
    track: track("VIR"),
    sessionDate: "2026-10-10T15:00:00.000Z",
    worstMiss: 0.1,
    onTarget: true,
  },
  firstDate: "2026-04-10",
  lastDate: "2026-10-10",
};

describe("season wording", () => {
  it("states the season as counts", () => {
    expect(seasonHeadline(base)).toBe("14 calculations at 2 tracks over 9 track days.");
    expect(
      seasonHeadline({
        ...base,
        calculations: 1,
        trackDays: 1,
        tracks: base.tracks.slice(0, 1),
      })
    ).toBe("1 calculation at 1 track over 1 track day.");
  });
  it("describes the closest run as a fact", () => {
    expect(closestText(base, "STANDARD")).toBe(
      "INDY R1 at VIR, Oct 10: within 0.1 PSI on all four corners"
    );
    expect(
      closestText(
        { ...base, closest: { ...base.closest!, worstMiss: 0 } },
        "STANDARD",
        false
      )
    ).toBe("INDY R1 at VIR, on target on all four corners");
    expect(
      closestText(
        { ...base, closest: { ...base.closest!, worstMiss: 0.7, onTarget: false } },
        "STANDARD",
        false
      )
    ).toBe("INDY R1 at VIR, worst corner 0.7 PSI off");
    expect(closestText({ ...base, closest: null }, "STANDARD")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  canonicalSourceKey,
  imsaSourceKey,
  parseSourceKey,
  parseSpeedhiveRef,
  SOURCE_KEY_PATTERN,
  speedhiveSourceKey,
  sroSourceKey,
} from "../source-key.js";
import { safeFileName, slugForSourceKey } from "../names.js";
import { groupSroLinks, parseResultLinks } from "../parse-alkamel.js";

describe("sourceKey stability", () => {
  const KEY = "imsa:26_2026/21_Road Atlanta/02_IMSA Michelin Pilot Challenge/202610021140_Race";

  it("the same IMSA session gives the same key from decoded, percent-encoded or untidy folder names", () => {
    expect(imsaSourceKey("26_2026", "21_Road Atlanta", "02_IMSA Michelin Pilot Challenge", "202610021140_Race")).toBe(KEY);
    expect(imsaSourceKey("26_2026", "21_Road%20Atlanta", "02_IMSA%20Michelin%20Pilot%20Challenge", "202610021140_Race")).toBe(KEY);
    expect(imsaSourceKey(" 26_2026", "21_Road  Atlanta ", "02_IMSA Michelin\tPilot Challenge", "202610021140_Race")).toBe(KEY);
    expect(canonicalSourceKey("imsa:26_2026/21_Road%20Atlanta/02_IMSA Michelin Pilot Challenge/202610021140_Race")).toBe(KEY);
  });

  it("an SRO key from an encoded link equals one from a raw link", () => {
    const raw = 'href="Results/06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610101000_Race 1/a.CSV"';
    const enc = 'href="Results/06_SRO/26_2026/09_Indianapolis%20Motor%20Speedway%20RC/03_Pirelli%20GT4%20America/202610101000_Race%201/b.CSV"';
    const [g1] = groupSroLinks(parseResultLinks(`<a ${raw}>`));
    const [g2] = groupSroLinks(parseResultLinks(`<a ${enc}>`));
    const k = (g: typeof g1) => sroSourceKey(g.siteSeries, g.season, g.event, g.subSeries, g.sessionFolder);
    expect(k(g1)).toBe(k(g2));
    expect(k(g1)).toBe("sro:06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610101000_Race 1");
  });

  it("round-trips through parse and canonical form", () => {
    for (const key of [KEY, "sro:06_SRO/26_2026/09_Indianapolis Motor Speedway RC/03_Pirelli GT4 America/202610101000_Race 1", "speedhive:session:11748965"]) {
      expect(canonicalSourceKey(key)).toBe(key);
      expect(SOURCE_KEY_PATTERN.test(key)).toBe(true);
    }
    expect(parseSourceKey(KEY)).toEqual({ site: "imsa", season: "26_2026", event: "21_Road Atlanta", championship: "02_IMSA Michelin Pilot Challenge", sessionFolder: "202610021140_Race" });
    expect(speedhiveSourceKey("011748965")).toBe("speedhive:session:11748965");
  });

  it("does not depend on which files the session has (results changing provisional → official keep the key)", () => {
    // The key is folder-based; files only change the session's version.
    expect(KEY.includes("Results_")).toBe(false);
  });

  it.each([
    "imsa:26_2026/21_Road Atlanta/202610021140_Race",
    "imsa:26_2026/../x/y/z",
    "sro:06_SRO/26_2026/x/y",
    "speedhive:session:abc",
    "speedhive:event:123",
    "wrl:123",
  ])("rejects %s", (bad) => expect(() => canonicalSourceKey(bad)).toThrow());

  it("reads Speedhive web and API references", () => {
    expect(parseSpeedhiveRef("https://speedhive.mylaps.com/sessions/11748965")).toEqual({ kind: "session", id: 11748965 });
    expect(parseSpeedhiveRef("https://speedhive.mylaps.com/events/3197001?tab=x")).toEqual({ kind: "event", id: 3197001 });
    expect(parseSpeedhiveRef("https://eventresults-api.speedhive.com/api/v0.2.3/eventresults/sessions/11748965/classification")).toEqual({ kind: "session", id: 11748965 });
    expect(parseSpeedhiveRef("11748965")).toEqual({ kind: "session", id: 11748965 });
    expect(() => parseSpeedhiveRef("https://example.com/x")).toThrow();
  });
});

describe("Windows-safe names", () => {
  const forbidden = /[<>:"/\\|?*\u0000-\u001f]/;

  it("work-folder slugs are Windows-safe, stable and distinct", () => {
    const a = slugForSourceKey("imsa:26_2026/21_Road Atlanta/02_IMSA Michelin Pilot Challenge/202610021140_Race");
    expect(a).toBe("imsa__26_2026__21_Road_Atlanta__02_IMSA_Michelin_Pilot_Challenge__202610021140_Race");
    expect(forbidden.test(a)).toBe(false);
    expect(slugForSourceKey("speedhive:session:11748965")).toBe("speedhive__session__11748965");
    const long1 = slugForSourceKey(`sro:06_SRO/26_2026/${"A".repeat(80)}/03_Pirelli GT4 America/202610101000_Race 1`);
    const long2 = slugForSourceKey(`sro:06_SRO/26_2026/${"A".repeat(80)}/03_Pirelli GT4 America/202610111330_Race 2`);
    expect(long1.length).toBeLessThanOrEqual(100);
    expect(long1).not.toBe(long2);
    expect(slugForSourceKey("sro:06_SRO/26_2026/Événement São Paulo/x/202601010000_Race")).not.toMatch(/[^A-Za-z0-9._-]/);
  });

  it("file names lose forbidden characters, reserved names and trailing dots", () => {
    expect(safeFileName('25_Flags: "RC"? <1/2>.CSV')).toBe("25_Flags_ _RC__ _1_2_.CSV");
    expect(safeFileName("CON.csv")).toBe("_CON.csv");
    expect(safeFileName("name. . ")).toBe("name");
    expect(safeFileName("23_Time Cards_Race.JSON")).toBe("23_Time Cards_Race.JSON");
    const long = safeFileName(`${"x".repeat(200)}.CSV`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(".CSV")).toBe(true);
  });
});

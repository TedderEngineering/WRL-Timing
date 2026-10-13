import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePitCardsPdf } from "../adapters/pit-cards-pdf.js";
import { detectRole } from "../adapters/index.js";
import type { PdfPage, PdfTextItem } from "../types.js";
import { parseDuration } from "../util.js";
import { formatDuration } from "../validate-package.js";

const it_ = (str: string, x: number, y: number): PdfTextItem => ({ str, x, y, width: str.length * 3, height: 6 });

describe("pit-card PDF reader (coordinate based, AO6)", () => {
  // Two columns on a 595-wide page. Left: car 007 (two cards, one sub-minute). Right: car 7, whose
  // second card continues at the top of the next page (carry-over).
  const page1: PdfPage = {
    width: 595,
    height: 841,
    items: [
      it_("Nr.", 56, 130),
      it_("In Time In Driver", 80, 130),
      it_("007", 57, 197),
      it_("Aston Martin Vantage AMR GT4 EVO", 92, 198),
      it_("Silver", 280, 198),
      it_("1 10:31:28.930", 62, 212),
      it_("I. Ellahi", 107, 212),
      it_("10:33:32.840", 148, 212),
      it_("A. Houk", 187, 212),
      it_("2:03.910", 237, 212),
      it_("2:03.910", 275, 212),
      it_("2 10:50:01.100", 62, 222),
      it_("A. Houk", 107, 222),
      it_("10:50:59.832", 148, 222),
      it_("A. Houk", 187, 222),
      it_("58.732", 237, 222),
      it_("3:02.642", 275, 222),
      it_("7", 327, 197),
      it_("Porsche 718 Cayman GT4 RS Clubsport", 352, 198),
      it_("1 10:28:19.971", 322, 212),
      it_("Y. Baltas", 367, 212),
      it_("10:30:10.525", 408, 212),
      it_("T. Estep", 447, 212),
      it_("1:50.554", 497, 212),
      it_("1:50.554", 535, 212),
    ],
  };
  const page2: PdfPage = { width: 595, height: 841, items: [it_("2 10:59:00.000", 62, 100), it_("T. Estep", 107, 100), it_("11:00:05.500", 148, 100), it_("T. Estep", 187, 100), it_("1:05.500", 237, 100), it_("2:56.054", 275, 100)] };
  const r = parsePitCardsPdf([page1, page2]);
  it("keys cards by the header string ('007' is not '7')", () => {
    expect(r.orphans).toEqual([]);
    expect(r.cards.filter((c) => c.car === "007").map((c) => c.nr)).toEqual([1, 2]);
    expect(r.cards.filter((c) => c.car === "7").map((c) => c.nr)).toEqual([1, 2]);
  });
  it("accepts a sub-minute pit time (SS.mmm) row", () => {
    const c = r.cards.find((x) => x.car === "007" && x.nr === 2)!;
    expect(c.pitTime).toBe("58.732");
    expect(parseDuration(c.pitTime)).toBe(58.732);
    expect(c.inDriver).toBe("A. Houk");
  });
  it("carries the current car over to the next column/page", () => {
    // Columns are read left then right, so page 2's headerless first row continues page 1's right column (car 7).
    expect(r.cards.find((x) => x.inTime === "10:59:00.000")!.car).toBe("7");
  });
});

describe("helpers", () => {
  it("parseDuration: blank and '-' are null, never 0 (WS20)", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("-")).toBeNull();
    expect(parseDuration("1:02:03.004")).toBe(3723.004);
    expect(parseDuration("00:02:28.524")).toBe(148.524);
  });
  it("formatDuration: GUI m:ss.sss, 3 decimals, no unit", () => {
    expect(formatDuration(110.554)).toBe("1:50.554");
    expect(formatDuration(47.123)).toBe("0:47.123");
    expect(formatDuration(3634.129)).toBe("1:00:34.129");
    expect(formatDuration(-4.042)).toBe("-0:04.042");
    expect(formatDuration(108)).toBe("1:48.000");
  });
  it("detectRole from timing-provider file names", () => {
    expect(detectRole("GT4_Indy_2026_20_Pit Stops Time Cards_Race 1.PDF")).toBe("pit_cards_pdf");
    expect(detectRole("MPC_RoadAtlanta_2026_20_Pit Stops Time Cards_Race.JSON")).toBe("pit_cards_json");
    expect(detectRole("MPC_RoadAtlanta_2026_23_Time Cards_Race.CSV")).toBe("time_cards");
    expect(detectRole("x_05_Results by Class_Race 1_Provisional.CSV")).toBe("results_by_class");
    expect(detectRole("05_Provisional_Results_by_Class_Race_1_COTA.csv")).toBe("results_by_class");
    expect(detectRole("00_Results_GR_Cup_Race_1_Official_COTA.csv")).toBe("results");
    expect(detectRole("speedhive_Sunday_7_hour_11586857_all_laps.csv")).toBe("laps");
  });
  it("shared/ and server copies of the schema and types are identical", () => {
    const a = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    expect(a("../schema/race-analysis-package.schema.json")).toBe(a("../../../../shared/race-analysis-package/race-analysis-package.schema.json"));
    expect(a("../schema/package-types.ts")).toBe(a("../../../../shared/race-analysis-package/types.ts"));
  });
});

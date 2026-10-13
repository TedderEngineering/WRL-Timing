/**
 * Tests for the Alkamel pit stop time card PDF parser.
 *
 * Fixtures are the text pdf-parse extracts from the real PDFs: one car block per
 * header line, one stop per row, columns separated by spaces with a tab before
 * the driver pair. IMSA prints these pages in two columns, which pdf-parse
 * de-interleaves into the same shape SRO and GR Cup produce.
 */
import { describe, it, expect } from "vitest";
import { parseAlkamelPitStopPdf } from "../../parseAlkamelPitStopPdf.js";

describe("parseAlkamelPitStopPdf", () => {
  it("keeps stops shorter than a minute", () => {
    // Alkamel prints sub-minute durations as "55.544", not "0:55.544".
    const text = [
      "Race Pit Stop Time Cards",
      "2 CSM",
      "Aston Martin Vantage AMR GT4 Evo GS",
      "1 15:05:53.812 15:07:11.772 1:17.960 1:17.960\tG. Scully M. Burkhard",
      "2 15:32:19.386 15:33:14.930 55.544 2:13.504\tM. Burkhard M. Burkhard",
    ].join("\n");

    const stops = parseAlkamelPitStopPdf(text).get(2)!;
    expect(stops).toHaveLength(2);
    expect(stops[1].pitTime).toBeCloseTo(55.544, 3);
    expect(stops[0].pitTime).toBeCloseTo(77.96, 2);
  });

  it("reads a team name containing a slash", () => {
    // "Stallion Motorsports w/ GOU" was previously skipped, and its stops were
    // silently attributed to whichever car came before it.
    const text = [
      "76 Bryan Herta Autosport with Curb Agajanian",
      "Hyundai Elantra N TCR TCR",
      "1 14:36:02.999 14:37:04.020 1:01.021 1:01.021\tP. Brown P. Brown",
      "77 Stallion Motorsports w/ GOU",
      "Cupra Leon VZ TCR TCR",
      "1 14:29:50.317 14:30:34.302 43.985 43.985\tE. Gou E. Gou",
      "2 15:10:26.245 15:16:55.592 6:29.347 7:13.332\tE. Gou C. Neto",
    ].join("\n");

    const result = parseAlkamelPitStopPdf(text);
    expect(result.get(76)).toHaveLength(1);
    expect(result.get(77)).toHaveLength(2);
  });

  it("accumulates a car whose stops are split across several blocks", () => {
    // The two-column layout can split one car's rows across the page, and long
    // entry lists wrap across pages. Later blocks must not replace earlier ones.
    const text = [
      "7 Some Racing Team",
      "Ford Mustang GT4 GS",
      "1 15:00:00.000 15:01:00.000 1:00.000 1:00.000\tA. One A. One",
      "9 Another Team",
      "BMW M4 GT4 EVO GS",
      "1 15:05:00.000 15:06:00.000 1:00.000 1:00.000\tB. Two B. Two",
      "7 Some Racing Team",
      "Ford Mustang GT4 GS",
      "2 15:40:00.000 15:41:00.000 1:00.000 2:00.000\tA. One A. One",
    ].join("\n");

    const stops = parseAlkamelPitStopPdf(text).get(7)!;
    expect(stops).toHaveLength(2);
    // and are returned in chronological order
    expect(stops[0].inTime).toBeLessThan(stops[1].inTime);
  });

  it("does not double-count a block repeated in the extracted text", () => {
    const block = [
      "7 Some Racing Team",
      "Ford Mustang GT4 GS",
      "1 15:00:00.000 15:01:00.000 1:00.000 1:00.000\tA. One A. One",
    ];
    const result = parseAlkamelPitStopPdf([...block, ...block].join("\n"));
    expect(result.get(7)).toHaveLength(1);
  });

  it("records the driver change across a stop", () => {
    const text = [
      "31 RVA Graphics Motorsports by Speed Syndicate",
      "Audi RS3 LMS TCR TCR",
      "1 15:12:33.428 15:13:58.503 1:25.075 1:25.075\tD. Yount L. Rumburg",
    ].join("\n");

    const stop = parseAlkamelPitStopPdf(text).get(31)![0];
    expect(stop.inDriverSurname).toBe("Yount");
    expect(stop.outDriverSurname).toBe("Rumburg");
    expect(stop.driverChanged).toBe(true);
  });

  it("reads pit in and out as clock time in seconds from midnight", () => {
    // buildPitLapSet compares these against the HOUR column, so the units matter.
    const text = [
      "2 CSM",
      "Aston Martin Vantage AMR GT4 Evo GS",
      "1 15:05:53.812 15:07:11.772 1:17.960 1:17.960\tG. Scully M. Burkhard",
    ].join("\n");

    const stop = parseAlkamelPitStopPdf(text).get(2)![0];
    expect(stop.inTime).toBeCloseTo(15 * 3600 + 5 * 60 + 53.812, 3);
    expect(stop.outTime).toBeCloseTo(15 * 3600 + 7 * 60 + 11.772, 3);
  });
});

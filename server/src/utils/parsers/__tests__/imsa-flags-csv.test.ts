/**
 * Tests for the IMSA Flags Analysis CSV parser.
 *
 * IMSA publishes 25_FlagsAnalysisWithRCMessages as JSON for older events and as
 * CSV for newer ones. The CSV columns map one-to-one onto the JSON's flag event
 * shape, so this parser's job is to produce records the existing JSON code path
 * can consume unchanged.
 */
import { describe, it, expect } from "vitest";
import { parseImsaFlagsCsv } from "../imsa.js";

const HEADER = "TIME;ELAPSED;REC_TYPE;FLAG;SECTOR;MESSAGE;FLAG_TIME;ACCUM_TIME;LAP";

const SAMPLE = [
  HEADER,
  "14:02:43.382;;RCMessage;;;UNDER 5 MINUTES TO COMMAND;-;-;0",
  "14:15:28.786;-;GF;GREEN FLAG;;;20:13.603;20:13.603;1",
  "14:22:46.393;7:17.607;RCMessage;;;Car 4: Penalty - False Start  - Drive Through;-;-;0",
  "14:35:42.389;20:13.603;FCY;FULL COURSE YELLOW;;;8:18.562;8:18.562;11",
  "14:44:00.951;28:32.165;GF;GREEN FLAG;;;1:19:19.445;1:39:33.048;13",
  "16:17:34.961;2:02:06.174;FF;CHEQUERED FLAG;;;-;-;58",
  "",
].join("\n");

describe("parseImsaFlagsCsv", () => {
  it("parses every record and skips the blank trailing line", () => {
    expect(parseImsaFlagsCsv(SAMPLE)).toHaveLength(6);
  });

  it("keeps flag transitions with their lap numbers", () => {
    const flags = parseImsaFlagsCsv(SAMPLE).filter(
      (f) => f.rec_type === "GF" || f.rec_type === "FCY" || f.rec_type === "FF"
    );
    expect(flags.map((f) => [f.rec_type, f.lap])).toEqual([
      ["GF", 1],
      ["FCY", 11],
      ["GF", 13],
      ["FF", 58],
    ]);
  });

  it("keeps race control messages, which carry lap 0", () => {
    const rc = parseImsaFlagsCsv(SAMPLE).filter((f) => f.rec_type === "RCMessage");
    expect(rc).toHaveLength(2);
    expect(rc[0].lap).toBe(0);
    expect(rc[1].message).toBe("Car 4: Penalty - False Start  - Drive Through");
  });

  it('normalises the "-" placeholder to an empty string', () => {
    const [first, green] = parseImsaFlagsCsv(SAMPLE);
    expect(first.flag_time).toBe("");
    expect(first.accum_time).toBe("");
    // "-" appears in ELAPSED on flag rows too
    expect(green.elapsed).toBe("");
    expect(green.flag_time).toBe("20:13.603");
  });

  it("preserves the clock time used to anchor messages to laps", () => {
    expect(parseImsaFlagsCsv(SAMPLE)[1].time).toBe("14:15:28.786");
  });

  it("returns nothing for a header-only file", () => {
    expect(parseImsaFlagsCsv(HEADER)).toEqual([]);
  });

  it("throws when REC_TYPE is missing rather than importing silent nonsense", () => {
    expect(() => parseImsaFlagsCsv("TIME;ELAPSED;FLAG\n14:00:00.000;;GREEN\n")).toThrow(
      /REC_TYPE/
    );
  });
});

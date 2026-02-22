/**
 * SRO Motorsports Group data parser (placeholder)
 *
 * Used by: GT World Challenge America, GT America, Pirelli GT4 America,
 *          TC America, and other SRO-sanctioned series.
 *
 * TODO: Obtain sample SRO timing exports and implement parser.
 *       SRO typically provides timing data via:
 *       - Their live timing system
 *       - Race Hero integration
 *       - Official timing partner exports
 *       - PDF/Excel results from series officials
 *
 * Expected files TBD — will be determined once sample data is available.
 */

import type { RaceDataParser } from "./types.js";

export const sroParser: RaceDataParser = {
  id: "sro",
  name: "SRO Motorsports",
  series: "SRO",
  description:
    "Import from SRO timing exports. Supports GT World Challenge, GT America, GT4 America, and TC America. (Coming soon)",
  fileSlots: [
    {
      key: "resultsCsv",
      label: "Results / Classification CSV",
      description:
        "SRO results export with final classification, car numbers, classes, and finishing positions.",
      required: true,
    },
    {
      key: "lapsCsv",
      label: "Lap Chart / Timing CSV",
      description:
        "SRO lap-by-lap timing data with lap times, positions, gaps, and pit activity.",
      required: true,
    },
  ],

  parse(_files) {
    throw new Error(
      "SRO parser is not yet implemented. " +
      "Please contact the admin with a sample SRO timing export so we can build support for this format."
    );
  },
};

/**
 * IMSA timing & scoring data parser (placeholder)
 *
 * Used by: IMSA WeatherTech, IMSA Michelin Pilot Challenge, IMSA VP Racing SportsCar Challenge
 *
 * TODO: Obtain sample IMSA timing exports and implement parser.
 *       IMSA typically provides timing data via:
 *       - PDF results (not easily parseable)
 *       - Their website API / live timing feed
 *       - Race Hero integration
 *       - Official CSV/Excel exports from series officials
 *
 * Expected files TBD — will be determined once sample data is available.
 */

import type { RaceDataParser } from "./types.js";

export const imsaParser: RaceDataParser = {
  id: "imsa",
  name: "IMSA Timing & Scoring",
  series: "IMSA",
  description:
    "Import from IMSA timing exports. Supports WeatherTech, Michelin Pilot Challenge, and VP Racing SportsCar Challenge. (Coming soon)",
  fileSlots: [
    {
      key: "resultsCsv",
      label: "Results / Classification CSV",
      description:
        "IMSA results export with final classification, car numbers, classes, and finishing positions.",
      required: true,
    },
    {
      key: "lapsCsv",
      label: "Lap Analysis CSV",
      description:
        "IMSA lap-by-lap timing data with lap times, positions, pit stops, and sector times.",
      required: true,
    },
  ],

  parse(_files) {
    throw new Error(
      "IMSA parser is not yet implemented. " +
      "Please contact the admin with a sample IMSA timing export so we can build support for this format."
    );
  },
};

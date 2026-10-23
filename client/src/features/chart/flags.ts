/**
 * Whether a lap ran under green. The imports write the line flag in their source's words:
 * "GREEN" (WRL website, Speedhive), "GF" (Alkamel: IMSA, SRO, GR Cup; and the analysis
 * package's pit facts), "G". Every pace calculation goes through this, so a panel never
 * finds no green laps because it only knew one series' word.
 */
export function isGreenFlag(flag: string | null | undefined): boolean {
  const f = (flag ?? "").trim().toUpperCase();
  return f === "GREEN" || f === "GF" || f === "G";
}

/** The live timing's session flags in their colours (the page header and the track map). */
export const LIVE_FLAG_COLORS: Record<string, string> = {
  Green: "#22c55e",
  Yellow: "#facc15",
  FCY: "#facc15",
  "Code 35": "#a855f7",
  "Code 60": "#a855f7",
  Red: "#ef4444",
  White: "#e5e7eb",
  Checkered: "#e5e7eb",
  Black: "#9ca3af",
};

/** How the track map shows a session flag: a badge over the map, and the track tinted for a caution or a red flag. */
export interface MapFlag {
  label: string;
  /** The badge's colour (and the track's tint). */
  color: string;
  /** Text on the badge. */
  ink: string;
  /** Tint the track outline. */
  tint: boolean;
  checkered?: boolean;
}

/** The track map's flag for the session's flag now; null under green (or no flag): the map as usual. */
export function mapFlag(flag: string | null | undefined): MapFlag | null {
  switch (flag) {
    case "Yellow":
    case "FCY":
      return { label: "Full-course yellow", color: LIVE_FLAG_COLORS.Yellow, ink: "#0b0b18", tint: true };
    case "Code 35":
    case "Code 60":
      return { label: flag, color: LIVE_FLAG_COLORS[flag], ink: "#ffffff", tint: true };
    case "Red":
      return { label: "Red flag · session stopped", color: LIVE_FLAG_COLORS.Red, ink: "#ffffff", tint: true };
    case "White":
      return { label: "White flag · last lap", color: LIVE_FLAG_COLORS.White, ink: "#0b0b18", tint: false };
    case "Checkered":
      return { label: "Checkered flag · finished", color: "#0b0b18", ink: "#ffffff", tint: false, checkered: true };
    case "Black":
      return { label: "Black flag", color: "#111118", ink: "#ffffff", tint: false };
    default:
      return null;
  }
}

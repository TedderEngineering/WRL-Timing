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

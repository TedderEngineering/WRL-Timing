/** Shared series badge color config — reusable across cards, sidebar, and future components */
export const SERIES_COLORS: Record<string, { bg: string; text: string }> = {
  IMSA: { bg: "#0057B8", text: "#FFFFFF" },
  SRO: { bg: "#C41E3A", text: "#FFFFFF" },
  GR_CUP: { bg: "#EB0A1E", text: "#FFFFFF" },
  WRL: { bg: "#16A34A", text: "#FFFFFF" },
};

/** Returns color config for a series. Falls back to gray for unknown series. */
export function getSeriesColor(series: string): { bg: string; text: string; label: string } {
  const key = series.toUpperCase();
  for (const [name, colors] of Object.entries(SERIES_COLORS)) {
    if (key.includes(name)) return { ...colors, label: name };
  }
  return { bg: "#4B5563", text: "#FFFFFF", label: series.slice(0, 6) };
}

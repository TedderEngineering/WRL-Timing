/** Class colors matching the original source chart */
export const CLASS_COLORS: Record<string, string> = {
  GTU: "#4ade80",
  GTO: "#60a5fa",
  GP1: "#f87171",
  GP2: "#fbbf24",
  GP3: "#a78bfa",
};

/** 20 distinct colors for comparison car traces */
export const COMP_PALETTE = [
  "#f87171", "#fb923c", "#fbbf24", "#a3e635", "#34d399",
  "#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#e879f9",
  "#f9a8d4", "#fdba74", "#bef264", "#6ee7b7", "#67e8f9",
  "#93c5fd", "#c4b5fd", "#fca5a5", "#86efac", "#fcd34d",
];

/** Chart styling */
export const CHART_STYLE = {
  bg: "#0b0b18",
  card: "#12122a",
  border: "#1e1e38",
  text: "#e0e0e8",
  muted: "#6b6b88",
  dim: "#44445a",
  gridLine: "#1e1e38",
  fcyBand: "rgba(251,191,36,0.07)",
  crosshair: "rgba(255,255,255,0.3)",
} as const;

/**
 * Position Trace (RaceTrace 2.0, mockup F1): the focus car is orange, up to a
 * few compare cars get distinct colours, every other car in view is a faint
 * "field" line.
 */
export const TRACE = {
  focus: "#F48C34",
  field: "rgba(224,224,232,0.16)",
  fieldPit: "rgba(224,224,232,0.45)",
  fcyFill: "rgba(251,191,36,0.08)",
  fcyBar: "#fbbf24",
  fcyText: "#fab219",
  glyph: "#e0e0e8",
  garage: "#f97316",
  penalty: "#e66767",
  selected: "rgba(255,255,255,0.35)",
  axis: "#9a9ab4",
  grid: "#1e1e38",
  gain: "#4ade80",
  loss: "#f87171",
  leader: "rgba(224,224,232,0.18)",
  driverText: "#f3f4f6",
} as const;

/** Compare-car colours, in the order cars were added (mockup F1). */
export const COMPARE_PALETTE = [
  "#3987e5", "#199e70", "#9085e9", "#e05c9a", "#2bb5c8", "#d4b62c", "#e66767", "#8fb8ff",
];

/** Each class's colour on RaceTrace Live (map, running order, pit list); any other class: grey-blue. */
export const LIVE_CLASS_COLORS: Record<string, string> = {
  GTU: "#9ca3af",
  GTO: "#3b82f6",
  GP1: "#ef4444",
  GP2: "#22c55e",
};
const LIVE_CLASS_OTHER = "#8b8bb0";

/** A class's colour on RaceTrace Live. */
export function liveClassColor(cls: string | null | undefined): string {
  return LIVE_CLASS_COLORS[String(cls ?? "").trim().toUpperCase()] ?? LIVE_CLASS_OTHER;
}

/** Text on a fill of this colour: dark on the light colours, white on the dark ones. */
export function labelOn(color: string): string {
  const n = parseInt(color.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 140 ? "#0b0b18" : "#ffffff";
}

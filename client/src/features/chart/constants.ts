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

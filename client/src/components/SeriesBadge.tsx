import { useState } from "react";

type BadgeSize = "sm" | "md" | "lg";

interface SeriesBadgeProps {
  series: string;
  size?: BadgeSize;
}

const SERIES_CONFIG: Record<
  string,
  { color: string; bg: string; text: string; logo: string }
> = {
  WRL: {
    color: "#CC0000",
    bg: "rgba(180,0,0,0.10)",
    text: "#ffffff",
    logo: "https://images.squarespace-cdn.com/content/v1/611fe48f61d6702c42301722/bc104c98-a3c9-49ea-a770-b0c5e7c2a46a/2021_NewPNG.png?format=1500w",
  },
  IMSA: {
    color: "#0057B8",
    bg: "rgba(0,87,184,0.12)",
    text: "#60a5fa",
    // Official IMSA logo supplied by the owner (white wordmark, for the dark theme).
    logo: "/logos/imsa.png",
  },
  SRO: {
    color: "#C41E3A",
    bg: "rgba(196,30,58,0.12)",
    text: "#f87171",
    logo: "https://www.sro-motorsports.com/assets/img/sro-motorsports-group.svg",
  },
  GR_CUP: {
    color: "#EB0A1E",
    bg: "rgba(235,10,30,0.12)",
    text: "#f87171",
    logo: "",
  },
};

/**
 * The badge for any series string the site stores ("IMSA", "SRO", "GR_CUP", "GR CUP", "WRL",
 * "Porsche Carrera Cup North America", "Mustang Challenge North America"…): every series is
 * shown as its sanctioning family, so one race weekend looks the same on every page.
 */
export function seriesFamilyKey(series: string): keyof typeof SERIES_CONFIG | null {
  const s = series.toLowerCase().replace(/_/g, " ");
  if (/\bgr cup\b|toyota/.test(s)) return "GR_CUP";
  if (/\bwrl\b|world racing league/.test(s)) return "WRL";
  if (/\bsro\b|gt4|gtwc|gt world challenge|tc america|mclaren|gt america|igtc/.test(s)) return "SRO";
  if (/imsa|weathertech|pilot challenge|porsche|carrera|mustang|lamborghini|super trofeo|mx-?5|vp racing|vprc|hsr|airbnb/.test(s)) return "IMSA";
  return null;
}

/** Outer height in px; logos and text sit in the same box so every badge lines up. */
const SIZE_HEIGHT: Record<BadgeSize, number> = { sm: 18, md: 22, lg: 26 };

const DISPLAY_LABELS: Record<string, string> = {
  GR_CUP: "GR Cup",
};

function getConfig(series: string) {
  const key = seriesFamilyKey(series);
  if (key) return { ...SERIES_CONFIG[key], label: DISPLAY_LABELS[key] || key };
  return {
    color: "#4B5563",
    bg: "rgba(75,85,99,0.12)",
    text: "#9ca3af",
    logo: "",
    label: series.replace(/_/g, " ").slice(0, 10),
  };
}

export function SeriesBadge({ series, size = "md" }: SeriesBadgeProps) {
  const config = getConfig(series);
  const height = SIZE_HEIGHT[size];
  const [imgFailed, setImgFailed] = useState(false);
  const box = {
    backgroundColor: config.bg,
    border: `1px solid ${config.color}66`,
    height,
    padding: "0 6px",
  } as const;

  if (config.logo && !imgFailed) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded" style={box} title={config.label}>
        <img
          src={config.logo}
          alt={config.label}
          style={{ height: height - 6, pointerEvents: "none" }}
          onError={() => setImgFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded text-[10px] font-bold uppercase leading-none tracking-wider"
      style={{ ...box, color: config.text }}
    >
      {config.label}
    </span>
  );
}

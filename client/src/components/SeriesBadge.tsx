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
    logo: "",
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

// Normalize series string for lookup: "GR Cup" → "GR_CUP", "gr_cup" → "GR_CUP"
function normalizeSeriesKey(series: string): string {
  return series.toUpperCase().replace(/[\s-]+/g, "_");
}

const SIZE_HEIGHT: Record<BadgeSize, number> = { sm: 12, md: 16, lg: 20 };

const DISPLAY_LABELS: Record<string, string> = {
  GR_CUP: "GR Cup",
};

function getConfig(series: string) {
  const key = normalizeSeriesKey(series);
  // Direct match first
  if (SERIES_CONFIG[key]) {
    return { ...SERIES_CONFIG[key], label: DISPLAY_LABELS[key] || key };
  }
  // Substring match fallback
  for (const [name, config] of Object.entries(SERIES_CONFIG)) {
    if (key.includes(name)) return { ...config, label: DISPLAY_LABELS[name] || name };
  }
  return {
    color: "#4B5563",
    bg: "rgba(75,85,99,0.12)",
    text: "#9ca3af",
    logo: "",
    label: series.slice(0, 6),
  };
}

export function SeriesBadge({ series, size = "md" }: SeriesBadgeProps) {
  const config = getConfig(series);
  const height = SIZE_HEIGHT[size];
  const [imgFailed, setImgFailed] = useState(false);

  if (config.logo && !imgFailed) {
    return (
      <span
        className="inline-flex items-center justify-center rounded"
        style={{
          backgroundColor: config.bg,
          border: `1px solid ${config.color}66`,
          padding: "2px 6px",
        }}
      >
        <img
          src={config.logo}
          alt={config.label}
          style={{ height, pointerEvents: "none" }}
          onError={() => setImgFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center justify-center rounded text-[10px] font-bold uppercase tracking-wider leading-none"
      style={{
        backgroundColor: config.bg,
        color: config.text,
        border: `1px solid ${config.color}66`,
        padding: "2px 6px",
        height: height + 4,
      }}
    >
      {config.label}
    </span>
  );
}

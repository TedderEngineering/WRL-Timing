import { SERIES_COLORS } from "../lib/series-colors";

interface SeriesBadgeProps {
  series: string;
  size?: "sm" | "md";
}

export function SeriesBadge({ series, size = "sm" }: SeriesBadgeProps) {
  const key = series.toUpperCase();
  const color = SERIES_COLORS[key]?.bg ?? "#6B7280";
  const label =
    Object.keys(SERIES_COLORS).find((k) => key.includes(k)) ?? series.slice(0, 6);

  const sizeClasses =
    size === "md" ? "text-sm px-3 py-1" : "text-xs px-2 py-0.5";

  return (
    <span
      className={`inline-flex items-center justify-center ${sizeClasses} font-bold uppercase tracking-wide rounded-full leading-none shrink-0`}
      style={{
        backgroundColor: `${color}33`,
        border: `1px solid ${color}`,
        color,
      }}
    >
      {label}
    </span>
  );
}

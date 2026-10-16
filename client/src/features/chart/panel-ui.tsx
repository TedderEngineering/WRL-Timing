import type { ReactNode } from "react";
import type { RaceChartData } from "@shared/types";

/** Shared look for the chart's side panels (Gap evolution, Head-to-head). */
export const PANEL = {
  card: "#12122a",
  well: "#0e0e20",
  raised: "#1a1a36",
  line: "#1e1e38",
  control: "#2c2c50",
  text: "#e0e0e8",
  muted: "#9a9ab4",
} as const;

/** A row of mutually exclusive choices ("Last 10 · This stint · Whole race"). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-[3px] rounded-lg p-[3px]"
      style={{ background: PANEL.well, gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className="min-h-[34px] truncate rounded-md px-1 text-[13px] font-semibold transition-colors"
            style={on ? { background: PANEL.control, color: "#fff" } : { color: PANEL.muted }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small upper-case heading inside a panel. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] font-bold uppercase tracking-[0.08em] ${className}`} style={{ color: PANEL.muted }}>
      {children}
    </div>
  );
}

export function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={PANEL.muted} strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

export function ChevronIcon({ up }: { up?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={PANEL.muted} strokeWidth="2" aria-hidden="true">
      <path d={up ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}

/** "Team (Driver / Driver)" as IMSA imports write it → team and drivers. */
export function splitTeam(team: string | undefined): { team: string; drivers: string | null } {
  const t = (team ?? "").trim();
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(t);
  return m ? { team: m[1], drivers: m[2] } : { team: t, drivers: null };
}

/** A car's team and its drivers, from the driver list or the "Team (A / B)" form. */
export function driversOf(data: RaceChartData, num: number): { team: string; drivers: string | null } {
  const car = data.cars[String(num)];
  const split = splitTeam(car?.team);
  const listed = car?.drivers?.length ? car.drivers.join(" · ") : null;
  return { team: split.team, drivers: listed ?? split.drivers };
}

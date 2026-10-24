/**
 * Shared pieces for the phone's card lists (mobile redesign, step 5): the Pit Stops, Strategy and
 * Driver Report tables become one card per row on a phone, never a table that scrolls sideways.
 *
 *  - your car first: its cards are pinned above the ranked list, outlined in orange
 *  - one sort control (a native picker, as phones expect) and a direction button, 44 px each
 *  - chips for the class, 44 px tall, in a row that scrolls sideways when it must
 *  - each card: a title line, a sub line, then a grid of labelled numbers
 *
 * Colours are the laptop race page's (#12122a cards, #1e1e38 lines, orange focus).
 */
import type { ReactNode } from "react";

export const PC = {
  bg: "#0b0b18",
  card: "#12122a",
  line: "#1e1e38",
  border: "#3a3a5c",
  text: "#e0e0e8",
  soft: "#cbd5e1",
  muted: "#9a9ab4",
  accent: "#F48C34",
  focusBg: "rgba(244,140,52,0.08)",
};

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="m-0 mb-1.5 mt-4 px-1 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: PC.muted }}>
      {children}
    </h3>
  );
}

/** Sort: a native picker (the phone's own wheel or list) and a direction button. */
export function SortBar<K extends string>({
  options,
  value,
  dir,
  onChange,
  onFlip,
  label = "Sort by",
}: {
  options: { key: K; label: string }[];
  value: K;
  dir: "asc" | "desc";
  onChange: (k: K) => void;
  onFlip: () => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2" data-phone-cards="sort">
      <label className="relative flex min-h-[44px] min-w-0 flex-1 items-center rounded-lg border px-3 text-[14px]" style={{ borderColor: PC.border, background: PC.card }}>
        <span className="shrink-0" style={{ color: PC.muted }}>
          {label}&nbsp;
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold" style={{ color: PC.text }}>
          {options.find((o) => o.key === value)?.label}
        </span>
        <span aria-hidden style={{ color: PC.muted }}>
          ▾
        </span>
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value as K)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={onFlip}
        aria-label={dir === "asc" ? "Lowest first; show highest first" : "Highest first; show lowest first"}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-[16px]"
        style={{ borderColor: PC.border, background: PC.card, color: PC.text }}
      >
        {dir === "asc" ? "↑" : "↓"}
      </button>
    </div>
  );
}

/** Class (or other) chips, 44 px tall, in one row that scrolls sideways when it must. */
export function ChipRow<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: { key: K; label: string; color?: string }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar -mx-2 flex gap-1.5 overflow-x-auto px-2" data-phone-cards="chips">
      {items.map((it) => {
        const on = it.key === value;
        const color = it.color ?? PC.accent;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.key)}
            className="min-h-[44px] shrink-0 whitespace-nowrap rounded-lg border px-3.5 text-[13px] font-semibold"
            style={{ borderColor: on ? color : PC.border, background: on ? `${color}22` : PC.card, color: on ? PC.text : PC.muted }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/** One row of a table as a card. Tapping it makes that car the focus car (as a laptop row click). */
export function RowCard({
  focus,
  onClick,
  children,
  label,
}: {
  focus?: boolean;
  onClick?: () => void;
  children: ReactNode;
  label?: string;
}) {
  const style = { borderColor: focus ? PC.accent : PC.line, background: focus ? PC.focusBg : PC.card, color: PC.text };
  const cls = "block w-full rounded-xl border p-3 text-left";
  return onClick ? (
    <div role="button" tabIndex={0} aria-label={label} data-phone-card onClick={onClick} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()} className={`${cls} cursor-pointer`} style={style}>
      {children}
    </div>
  ) : (
    <div data-phone-card className={cls} style={style}>
      {children}
    </div>
  );
}

/** Labelled numbers in a grid, three across. */
export function StatGrid({ stats }: { stats: { label: string; value: ReactNode; color?: string; strong?: boolean }[] }) {
  return (
    <dl className="m-0 mt-2 grid grid-cols-3 gap-x-3 gap-y-2">
      {stats.map((s) => (
        <div key={s.label} className="min-w-0">
          <dt className="truncate text-[11px] uppercase tracking-[0.04em]" style={{ color: PC.muted }}>
            {s.label}
          </dt>
          <dd className="m-0 truncate font-mono text-[14px]" style={{ color: s.color ?? PC.text, fontWeight: s.strong ? 700 : 400 }}>
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

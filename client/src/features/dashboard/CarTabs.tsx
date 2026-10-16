import { ScrollRow } from "../../components/ScrollRow";
import type { MyCarResponse } from "./MyCarCard";

type Car = NonNullable<MyCarResponse["cars"]>[number];
const SERIES: Record<string, string> = { imsa: "IMSA", sro: "SRO", wrl: "WRL" };

/** "#6 · Z's Car" or "#67 Blackdog Racing", with the series. */
export function carTabLabel(c: Car): string {
  const name = c.label ? `#${c.number} · ${c.label}` : `#${c.number}${c.teamName ? ` ${c.teamName}` : ""}`;
  return `${name} · ${SERIES[c.series] ?? c.series.toUpperCase()}`;
}

/**
 * The user's cars as tabs, the same look and feel as the race tabs (grab, wheel or arrows to
 * scroll). Choosing one shows its latest race and its season recaps.
 */
export function CarTabs({
  cars,
  active,
  onChoose,
  className = "border-b border-[var(--rt-border)]",
}: {
  cars: Car[];
  active: string | null;
  onChoose: (id: string) => void;
  className?: string;
}) {
  if (cars.length < 2) return null;
  const idx = Math.max(0, cars.findIndex((c) => c.id === active));
  return (
    <ScrollRow
      role="tablist"
      aria-label="Your cars"
      activeKey={idx}
      className={className}
      innerClassName="gap-1"
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const next = (idx + (e.key === "ArrowRight" ? 1 : cars.length - 1)) % cars.length;
        onChoose(cars[next].id);
        e.currentTarget.querySelectorAll<HTMLElement>("button")[next]?.focus();
      }}
    >
      {cars.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={i === idx}
          data-active={i === idx}
          tabIndex={i === idx ? 0 : -1}
          onClick={() => onChoose(c.id)}
          className={`flex min-h-[40px] items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors ${
            i === idx ? "border-[var(--rt-accent)] font-semibold text-[var(--rt-text)]" : "border-transparent text-[var(--rt-text-muted)] hover:text-[var(--rt-text)]"
          }`}
        >
          {carTabLabel(c)}
        </button>
      ))}
    </ScrollRow>
  );
}

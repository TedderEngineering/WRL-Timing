import { FollowTabs } from "./FollowTabs";
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
 * scroll). Choosing one shows its latest race and its season recaps; holding one and dragging
 * it reorders them (onReorder saves the order).
 */
export function CarTabs({
  cars,
  active,
  onChoose,
  onReorder,
  className,
}: {
  cars: Car[];
  active: string | null;
  onChoose: (id: string) => void;
  onReorder?: (ids: string[]) => void;
  className?: string;
}) {
  return (
    <FollowTabs
      label="Your cars"
      tabs={cars.map((c) => ({ id: c.id, label: carTabLabel(c) }))}
      active={active}
      onChoose={onChoose}
      onReorder={onReorder}
      className={className}
    />
  );
}

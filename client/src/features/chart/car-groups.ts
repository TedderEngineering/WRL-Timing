import type { RaceChartData } from "@shared/types";
import { carMatchesSearch, textMatches } from "./car-number";
import { finishInfo } from "./finish";

/** One car in a picker list (the laptop's focus menu and the phone car sheet). */
export interface PickCar {
  n: number;
  team: string;
  /** Class finishing position, 999 when unknown. */
  pos: number;
  make?: string;
  /** No laps in a race that has started: did not start. */
  dns: boolean;
  /** The official result text ("P3", "DSQ", "Not classified"). */
  official: string;
  classified: boolean;
  /** The driver the search matched, shown under the team. */
  driver?: string;
}

/**
 * The cars matching a search (number, team, make or driver: car-number.ts), grouped by class in
 * class order, classified cars first in finishing order, then those without a classified position.
 */
export function carGroups(data: RaceChartData, query: string): { cls: string; cars: PickCar[] }[] {
  const needle = query.trim().toLowerCase();
  const byCls = new Map<string, PickCar[]>();
  for (const [k, c] of Object.entries(data.cars)) {
    const n = Number(k);
    if (needle && !carMatchesSearch(data, n, needle)) continue;
    const info = finishInfo(data, n);
    const list = byCls.get(c.cls) ?? [];
    list.push({
      n,
      team: c.team,
      pos: c.finishPosClass || 999,
      official: info?.official ?? "",
      classified: info?.pos != null,
      make: c.make,
      // Before the race (no laps anywhere: the live page's pre-race layout) every entry can be picked.
      dns: c.laps.length === 0 && data.maxLap > 0,
      driver: needle ? (c.drivers ?? []).find((d) => textMatches(d, needle)) : undefined,
    });
    byCls.set(c.cls, list);
  }
  return [...byCls.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cls, cars]) => ({ cls, cars: cars.sort((a, b) => Number(b.classified) - Number(a.classified) || a.pos - b.pos) }));
}

/**
 * A car's class rivals for the phone's default compare set (plan decision M3, GUI spec OD-5):
 * up to two cars ahead of it and two behind in its class finishing order, among the cars that
 * ran and are in view. Near the front or back of the class the four come from the other side,
 * so the class leader is compared with P2 to P5.
 */
export function classRivals(data: RaceChartData, focus: number, inView: number[], count = 4): number[] {
  const car = data.cars[String(focus)];
  if (!car) return [];
  const view = new Set(inView);
  const ran = (n: number) => (data.cars[String(n)]?.laps.length ?? 0) > 0 || data.maxLap === 0;
  const order = (data.classGroups[car.cls] ?? [])
    .filter((n) => n === focus || (view.has(n) && ran(n)))
    .sort((a, b) => {
      const [x, y] = [data.cars[String(a)], data.cars[String(b)]];
      return (x.finishPosClass || 999) - (y.finishPosClass || 999) || a - b;
    });
  const i = order.indexOf(focus);
  if (i < 0) return [];
  const half = Math.floor(count / 2);
  let start = Math.max(0, i - half);
  let end = Math.min(order.length, start + count + 1);
  start = Math.max(0, end - count - 1);
  end = Math.min(order.length, start + count + 1);
  return order.slice(start, end).filter((n) => n !== focus);
}

/**
 * Who drove when, from the chart data: the car's stints between stops, each with the driver the
 * pit stops' driver changes name (inDriver on the in-lap, outDriver after it). The same rules as
 * the server's dashboard/my-driver.ts. Sources without driver changes (Speedhive) name nobody.
 */
import { expandDriverName, sameDriver } from "./api";

interface LapRow {
  l: number;
  ltSec: number;
  flag?: string;
  pit: number;
}
interface PitRow {
  l: number;
  inDriver?: string;
  outDriver?: string;
}

export interface Stint {
  start: number;
  end: number;
  driver: string | null;
}

export function stintsOf(laps: LapRow[], pits: PitRow[] | undefined, soleDriver: string | null, carDrivers: string[] = []): Stint[] {
  const last = laps.length ? Math.max(...laps.map((l) => l.l)) : 0;
  if (last === 0) return [];
  const stops = [...new Map((pits ?? []).filter((p) => p.l > 0 && p.l < last).map((p) => [p.l, p])).values()].sort((a, b) => a.l - b.l);
  const out: Stint[] = [];
  let start = 1;
  let driver: string | null = null;
  for (const p of stops) {
    out.push({ start, end: p.l, driver: p.inDriver?.trim() || driver || null });
    start = p.l + 1;
    driver = p.outDriver?.trim() || null;
  }
  out.push({ start, end: last, driver });
  // SRO's pit records name drivers by surname ("Boehm"): use the car's full name when one fits.
  const named = out.map((s) => ({ ...s, driver: s.driver ? expandDriverName(s.driver, carDrivers) : null }));
  return soleDriver ? named.map((s) => ({ ...s, driver: s.driver ?? soleDriver })) : named;
}

const green = (l: LapRow) => !l.flag || ["GF", "GREEN", "G"].includes(l.flag.toUpperCase());

export interface DriverDrive {
  stints: number;
  driveTimeS: number;
  best: { sec: number; lap: number } | null;
}

/** One driver's share of the car's race; null when the timing doesn't name who drove. */
export function driveOf(laps: LapRow[], stints: Stint[], name: string): DriverDrive | null {
  if (!stints.some((s) => s.driver)) return null;
  const mine = stints.filter((s) => s.driver && sameDriver(s.driver, name));
  const myLaps = laps.filter((l) => mine.some((s) => l.l >= s.start && l.l <= s.end));
  let best: DriverDrive["best"] = null;
  for (const l of myLaps) {
    if (l.pit === 1 || !green(l) || !(l.ltSec > 0)) continue;
    if (!best || l.ltSec < best.sec) best = { sec: l.ltSec, lap: l.l };
  }
  return { stints: mine.length, driveTimeS: Math.round(myLaps.reduce((t, l) => t + (l.ltSec > 0 ? l.ltSec : 0), 0)), best };
}

/** "3:42 h" for a drive of hours, "48 min" for less. */
export function driveTimeText(s: number): string {
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")} h`;
  }
  return `${Math.max(1, Math.round(s / 60))} min`;
}

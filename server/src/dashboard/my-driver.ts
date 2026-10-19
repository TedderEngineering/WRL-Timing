/**
 * "Your driver's latest race": the followed driver's part in the car's race, from the chart data
 * the import stored. Who drove when comes from the pit stops' driver changes (inDriver on the
 * in-lap, outDriver after the stop), which the IMSA, SRO and GR Cup imports fill from the lap
 * files. A source without them (Speedhive) leaves `known` false and the card shows the car's
 * numbers instead. Nothing here is estimated: a stint whose driver the timing doesn't name stays
 * unnamed.
 */
import { expandDriverName, sameDriver } from "../services/my-drivers.js";

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

export interface DriverStint {
  start: number;
  end: number;
  /** As the timing names them; null when it doesn't. */
  driver: string | null;
  mine: boolean;
  /** Average of the stint's green laps (no pit lap, out-lap, caution lap or lap far over the car's pace); null with none. */
  avgLapS: number | null;
  /** How many laps that average is over. */
  avgLaps: number;
}

export interface DriverFacts {
  /** False when the timing doesn't say who drove when. */
  known: boolean;
  stints: DriverStint[];
  myStints: number;
  driveTimeS: number;
  carTimeS: number;
  bestLap: { sec: number; lap: number } | null;
  /** 1 = the quickest of the car's named drivers; `of` = how many had a best lap. */
  bestRank: { rank: number; of: number } | null;
}

const green = (l: LapRow) => !l.flag || ["GF", "GREEN", "G"].includes(l.flag.toUpperCase());

function bestOf(laps: LapRow[]): { sec: number; lap: number } | null {
  let best: { sec: number; lap: number } | null = null;
  for (const l of laps) {
    if (l.pit === 1 || !green(l) || !(l.ltSec > 0)) continue;
    if (!best || l.ltSec < best.sec) best = { sec: l.ltSec, lap: l.l };
  }
  return best;
}

/**
 * The car's stints between stops, each with its driver when the timing names one; a short name
 * ("Boehm") becomes the car's full one ("Kevin Boehm") when `carDrivers` gives it.
 */
export function stintsOf(laps: LapRow[], pits: PitRow[], soleDriver: string | null, carDrivers: string[] = []): Omit<DriverStint, "mine">[] {
  const last = laps.length ? Math.max(...laps.map((l) => l.l)) : 0;
  if (last === 0) return [];
  const stops = [...new Map(pits.filter((p) => p.l > 0 && p.l < last).map((p) => [p.l, p])).values()].sort((a, b) => a.l - b.l);
  const out: Omit<DriverStint, "mine">[] = [];
  let start = 1;
  let driver: string | null = null;
  for (const p of stops) {
    out.push({ start, end: p.l, driver: p.inDriver?.trim() || driver || null });
    start = p.l + 1;
    driver = p.outDriver?.trim() || null;
  }
  out.push({ start, end: last, driver });
  const named = out.map((s) => ({ ...s, driver: s.driver ? expandDriverName(s.driver, carDrivers) : null }));
  // One driver in the car: every stint is theirs, stops or not.
  if (soleDriver) return named.map((s) => ({ ...s, driver: s.driver ?? soleDriver }));
  return named;
}

/** Laps over this share of the car's median green lap are not racing laps (a slow lap, a stop in the garage). */
const STINT_LAP_MAX = 1.25;

/**
 * Each stint's average green lap: no pit lap, no out-lap (the stint's first lap after a stop), no
 * caution lap, nothing over STINT_LAP_MAX of the car's median green lap.
 */
export function stintAverage(laps: LapRow[]): (s: { start: number; end: number }) => { avgLapS: number | null; avgLaps: number } {
  const greens = laps.filter((l) => l.pit !== 1 && green(l) && l.ltSec > 0).map((l) => l.ltSec).sort((a, b) => a - b);
  const med = greens.length ? greens[Math.floor(greens.length / 2)] : 0;
  const pitLaps = new Set(laps.filter((l) => l.pit === 1).map((l) => l.l));
  return (s) => {
    const xs = laps
      .filter((l) => l.l >= s.start && l.l <= s.end && l.pit !== 1 && !pitLaps.has(l.l - 1) && green(l) && l.ltSec > 0)
      .filter((l) => !med || l.ltSec <= med * STINT_LAP_MAX)
      .map((l) => l.ltSec);
    if (!xs.length) return { avgLapS: null, avgLaps: 0 };
    return { avgLapS: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000, avgLaps: xs.length };
  };
}

export function driverFacts(
  car: { laps: LapRow[] },
  pits: PitRow[] | undefined,
  name: string,
  entryDrivers: string[]
): DriverFacts {
  const sole = entryDrivers.length === 1 ? entryDrivers[0] : null;
  const avg = stintAverage(car.laps);
  const stints = stintsOf(car.laps, pits ?? [], sole, entryDrivers).map((s) => ({ ...s, mine: !!s.driver && sameDriver(s.driver, name), ...avg(s) }));
  const known = stints.some((s) => s.driver);
  const inStint = (l: LapRow, list: DriverStint[]) => list.some((s) => l.l >= s.start && l.l <= s.end);
  const mineList = stints.filter((s) => s.mine);
  const myLaps = car.laps.filter((l) => inStint(l, mineList));
  const sum = (ls: LapRow[]) => ls.reduce((t, l) => t + (l.ltSec > 0 ? l.ltSec : 0), 0);
  const bestLap = known ? bestOf(myLaps) : null;

  let bestRank: DriverFacts["bestRank"] = null;
  if (bestLap) {
    // Each named driver's best lap, the same driver under two spellings counted once.
    const names: string[] = [];
    for (const s of stints) if (s.driver && !names.some((n) => sameDriver(n, s.driver!))) names.push(s.driver);
    const bests = names
      .map((n) => bestOf(car.laps.filter((l) => inStint(l, stints.filter((s) => s.driver && sameDriver(s.driver, n))))))
      .filter((b): b is { sec: number; lap: number } => !!b);
    bestRank = { rank: bests.filter((b) => b.sec < bestLap.sec).length + 1, of: bests.length };
  }

  return {
    known,
    stints,
    myStints: mineList.length,
    driveTimeS: known ? Math.round(sum(myLaps)) : 0,
    carTimeS: Math.round(sum(car.laps)),
    bestLap,
    bestRank,
  };
}

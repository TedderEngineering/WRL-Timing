/**
 * RaceTrace Live: who drove each stint, from the driver name the timing sends with every lap.
 *
 * The live chart is built through the Speedhive parser, which keeps each car's drivers only as a
 * list (in the order they first drove) and names nobody on its pit stops. The driver report and
 * the car's stints (client my-drivers/stints.ts) need each stop's driver in (who drove the in-lap)
 * and driver out (who drove the lap after), as an imported race's analysis package gives them.
 * Here they come from the laps: each stint's driver is the one named on most of its laps (so a
 * lap at either end of a stint carrying the next driver's name changes nothing); the stint after
 * the last stop, before any of its laps is done, is the driver in the car now (the timing's
 * current state). On Sunday at Sebring the live driver lists matched the finished race's order of
 * drivers for every car checked.
 */
import { uniqueDrivers } from "../utils/driverNames.js";

/** A lap row's car, lap and driver (the live feed's lap fields). */
export interface DriverLap {
  n?: string | null;
  llp?: number | null;
  dn?: string | null;
}

interface Marker {
  l: number;
  inDriver?: string;
  outDriver?: string;
  driverChanged?: boolean;
}

/** A driver name as the parser keeps it (spaces collapsed). */
const clean = (s: string | null | undefined): string => uniqueDrivers([s])[0] ?? "";

/**
 * Name the driver in and out on every pit stop the live chart has (`annotations[key].pits`),
 * leaving any stop that already names them. `data` gives each chart key's published number
 * (its `label`, else the key); `current` who is in each car now, by published number.
 */
export function nameDriverChanges(
  annotations: Record<string, unknown>,
  data: { cars: Record<string, { label?: string }> },
  laps: DriverLap[],
  current: Record<string, string> = {}
): void {
  const byCar = new Map<string, Map<number, string>>();
  for (const l of laps) {
    const n = l.n ? String(l.n).trim() : "";
    const lap = Number(l.llp);
    const d = clean(l.dn);
    if (!n || !(lap >= 1) || !d) continue;
    if (!byCar.has(n)) byCar.set(n, new Map());
    byCar.get(n)!.set(lap, d);
  }
  for (const [key, car] of Object.entries(data.cars)) {
    const pits = (annotations[key] as { pits?: Marker[] } | undefined)?.pits;
    if (!Array.isArray(pits) || !pits.length) continue;
    const num = car.label ?? key;
    const drove = byCar.get(num) ?? new Map<number, string>();
    const lastLap = Math.max(0, ...drove.keys());
    const now = clean(current[num]);
    const stops = [...new Set(pits.map((p) => p.l))].filter((l) => l > 0).sort((a, b) => a - b);
    /** The driver named on most laps from..to (the later lap on a tie), or undefined. */
    const stintDriver = (from: number, to: number): string | undefined => {
      const count = new Map<string, number>();
      let best: string | undefined;
      for (let l = from; l <= to; l++) {
        const d = drove.get(l);
        if (!d) continue;
        const c = (count.get(d) ?? 0) + 1;
        count.set(d, c);
        if (!best || c >= (count.get(best) ?? 0)) best = d;
      }
      return best;
    };
    for (const p of pits) {
      if (p.inDriver !== undefined || p.outDriver !== undefined) continue;
      const i = stops.indexOf(p.l);
      const prev = i > 0 ? stops[i - 1] : 0;
      const next = i >= 0 && i + 1 < stops.length ? stops[i + 1] : Infinity;
      const dIn = stintDriver(prev + 1, p.l);
      // The stint after the stop; before any of its laps is done, whoever is in the car now.
      const dOut = stintDriver(p.l + 1, Math.min(next, lastLap)) ?? (p.l >= lastLap && now ? now : undefined);
      if (dIn) p.inDriver = dIn;
      if (dOut) p.outDriver = dOut;
      if (dIn && dOut) p.driverChanged = dIn.toLowerCase() !== dOut.toLowerCase();
    }
  }
}

/** Who is in each car now, by published number: the driver on each car's latest state row. */
export function currentDrivers(stateLaps: DriverLap[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of stateLaps) {
    const n = l.n ? String(l.n).trim() : "";
    const d = clean(l.dn);
    if (n && d) out[n] = d;
  }
  return out;
}

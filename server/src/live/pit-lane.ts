/**
 * RaceTrace Live: each stop's time in the pit lane, from the timing's own pit data.
 *
 * The live chart is built through the Speedhive parser, whose pit timing has no pit-lane time: it
 * puts the stop's time lost in that slot (position-analysis.ts, "total_only"), so the Pit Stops
 * tab showed the same figure as pit lane and as time lost. The timing sends the pit-lane time
 * with every lap: `pet` (pit entry time) and `pdm` (time in the pit lane, ms) describe the car's
 * latest visit and stay on its laps until the next one (analysis/adapters/redmist.ts). A stop's
 * pit-lane time is the `pdm` on its last lap before the next stop that carries a new entry time;
 * none found leaves it unknown (never the time lost).
 */
interface Lap {
  n?: string | null;
  llp?: number | null;
  pet?: unknown;
  pdm?: unknown;
}
interface Marker {
  l: number;
  pitTiming?: { pitRoadTime?: number | null; totalPitLoss?: number | null; decompositionLevel?: string } | null;
}

/** Shorter than this is not a pit-lane time (a reissued entry's partial); longer than this, a garage stay. */
const MIN_S = 5;
const MAX_S = 6 * 3600;

const entry = (v: unknown): string => (typeof v === "string" ? v : v instanceof Date ? v.toISOString() : "");

export function setPitLaneTimes(annotations: Record<string, unknown>, data: { cars: Record<string, { label?: string }> }, laps: Lap[]): number {
  const byCar = new Map<string, Map<number, Lap>>();
  for (const l of laps) {
    const n = l.n ? String(l.n).trim() : "";
    const lap = Number(l.llp);
    if (!n || !(lap >= 1)) continue;
    if (!byCar.has(n)) byCar.set(n, new Map());
    byCar.get(n)!.set(lap, l);
  }
  let set = 0;
  for (const [key, car] of Object.entries(data.cars)) {
    const pits = (annotations[key] as { pits?: Marker[] } | undefined)?.pits;
    if (!Array.isArray(pits) || !pits.length) continue;
    const rows = byCar.get(car.label ?? key) ?? new Map<number, Lap>();
    const lastLap = Math.max(0, ...rows.keys());
    const stops = [...pits].sort((a, b) => a.l - b.l);
    stops.forEach((m, i) => {
      const t = m.pitTiming;
      if (!t) return;
      // The visit before this one: its entry time is what the laps carry until this stop's.
      const before = entry(rows.get(m.l - 1)?.pet);
      const until = Math.min(i + 1 < stops.length ? stops[i + 1].l - 1 : Infinity, lastLap);
      let ms: number | null = null;
      for (let l = m.l; l <= until; l++) {
        const r = rows.get(l);
        const pet = entry(r?.pet);
        const pdm = typeof r?.pdm === "number" ? r.pdm : Number(r?.pdm);
        if (pet && pet !== before && Number.isFinite(pdm) && pdm > 0) ms = pdm;
      }
      const s = ms !== null ? ms / 1000 : null;
      t.pitRoadTime = s !== null && s >= MIN_S && s <= MAX_S ? Math.round(s * 10) / 10 : null;
      if (t.pitRoadTime !== null) set++;
    });
  }
  return set;
}

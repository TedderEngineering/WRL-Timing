import type { LapData, PitMarker } from "@shared/types";

/** One driver's spell in the car: laps `from`–`to` (the in-lap belongs to the spell it ends). */
export interface DriverStint {
  from: number;
  to: number;
  driver?: string;
}

/** Positions before and after one stop: `delta` > 0 is places gained. */
export interface PitDelta {
  lap: number;
  before: number;
  after: number;
  delta: number;
}

/** "Jane Q. Estep" → "ESTEP"; the chart shows surnames, like the timing sheets. */
export function surname(name: string | undefined): string | undefined {
  const parts = name?.trim().split(/\s+/).filter(Boolean);
  return parts?.length ? parts[parts.length - 1].toUpperCase() : undefined;
}

/**
 * Who drove when. Spells break at each stop (a lap with `pit`); the driver of each spell comes
 * from the stop that began it (its out-driver) or the stop that ended it (its in-driver).
 * Neighbouring spells with the same driver are merged, so the band shows driver changes only.
 */
export function driverStints(laps: LapData[], pits: PitMarker[]): DriverStint[] {
  if (!laps.length) return [];
  const byLap = new Map(pits.map((p) => [p.l, p] as const));
  const stops = laps.filter((d) => d.pit && d !== laps[0]).map((d) => d.l);
  const first = laps[0].l;
  const last = laps[laps.length - 1].l;
  const start = pits.find((p) => p.stintNumber === 1 || /^start\b/i.test(p.lb));

  const raw: DriverStint[] = [];
  let from = first;
  let opener: string | undefined = start?.outDriver;
  for (const s of stops) {
    const m = byLap.get(s);
    raw.push({ from, to: s, driver: surname(opener ?? m?.inDriver) });
    opener = m?.outDriver;
    from = s + 1;
  }
  if (from <= last) raw.push({ from, to: last, driver: surname(opener) });

  const out: DriverStint[] = [];
  for (const st of raw) {
    const prev = out[out.length - 1];
    if (prev && st.driver && prev.driver === st.driver) prev.to = st.to;
    else out.push({ ...st });
  }
  return out;
}

/**
 * Places gained or lost at each stop: the position on the lap before the stop against the first
 * green lap after it (within ten laps; failing that, the first lap without a stop), the same rule
 * the "settled" markers use.
 */
export function pitDeltas(laps: LapData[], pk: "p" | "cp", fcy: [number, number][] = []): PitDelta[] {
  const yellow = (l: number) => fcy.some(([s, e]) => l >= s && l <= e);
  const out: PitDelta[] = [];
  for (let i = 1; i < laps.length; i++) {
    if (!laps[i].pit) continue;
    let after: LapData | undefined;
    for (let j = i + 1; j < laps.length && j <= i + 10 && !after; j++) if (!laps[j].pit && !yellow(laps[j].l)) after = laps[j];
    for (let j = i + 1; j < laps.length && j <= i + 6 && !after; j++) if (!laps[j].pit) after = laps[j];
    if (!after) continue;
    const before = laps[i - 1][pk];
    out.push({ lap: laps[i].l, before, after: after[pk], delta: before - after[pk] });
  }
  return out;
}

export function deltaText(d: number): string {
  return d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : "±0";
}

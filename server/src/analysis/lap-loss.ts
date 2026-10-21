/**
 * How each car lost its laps: a derived row fact per car, `laploss:<car>`, built from the package's
 * confirmed lap-down events (positionChanges.lapDowns, D-LAPDOWN) and its pit passages. Derived
 * like the `lapdown:` and `pass:` rows, so the validator and the story digest build the same
 * values from the same package, and the package format does not change.
 *
 * Fields:
 *   lapsLost       laps lost to the class leader over the race (each confirmed lap-down event adds
 *                  what it lost; laps won back are not taken off; not the stop where the car retired)
 *   inPitStops     of those, at green-flag stops
 *   inGarage       at garage visits
 *   underCaution   at stops under a caution
 *   onTrack        on track (the class leader came round)
 *   notExplained   the engine could not tell how (cause unknown)
 *   onTrackFirstLap / onTrackLastLap   the car's laps where it went down on track
 *   biggestLap, biggestLaps, biggestCause   the single loss that was largest: one stop (laps lost
 *                  over the whole visit; biggestLap is its in-lap) or one lap on track
 *   finishLapsDown laps behind the class winner at the flag (null for a car that retired or has no result)
 */
import type { RaceAnalysisPackage } from "./schema/package-types.js";

export type LapLossCause = "pit_stop" | "garage" | "caution_stop" | "on_track" | "not_explained";

export interface LapLoss {
  car: string;
  lapsLost: number;
  inPitStops: number;
  inGarage: number;
  underCaution: number;
  onTrack: number;
  notExplained: number;
  onTrackFirstLap: number | null;
  onTrackLastLap: number | null;
  biggestLap: number;
  biggestLaps: number;
  biggestCause: LapLossCause;
  finishLapsDown: number | null;
}

export function lapLossFacts(P: RaceAnalysisPackage): Map<string, LapLoss> {
  const out = new Map<string, LapLoss>();
  const ld = P.positionChanges?.lapDowns;
  if (!ld || !ld.car.length) return out;
  const passages = P.events.pitPassages;
  const retired = new Set(P.events.retirements.map((r) => r.car));
  const winnerLaps = new Map<string, number>();
  for (const e of P.entries) if (e.result?.positionClass === 1 && typeof e.result.laps === "number") winnerLaps.set(e.class, e.result.laps);

  const byCar = new Map<string, { lap: number; lapsDown: number; cause: string }[]>();
  for (let i = 0; i < ld.car.length; i++) {
    const list = byCar.get(ld.car[i]) ?? [];
    list.push({ lap: ld.lap[i], lapsDown: ld.lapsDown[i], cause: ld.cause[i] });
    byCar.set(ld.car[i], list);
  }
  for (const [car, events] of byCar) {
    events.sort((a, b) => a.lap - b.lap);
    const L: LapLoss = {
      car,
      lapsLost: 0,
      inPitStops: 0,
      inGarage: 0,
      underCaution: 0,
      onTrack: 0,
      notExplained: 0,
      onTrackFirstLap: null,
      onTrackLastLap: null,
      biggestLap: events[0].lap,
      biggestLaps: 0,
      biggestCause: "on_track",
      finishLapsDown: null,
    };
    const cols = (P.laps?.cars as Record<string, { lap: number[]; lapsDown?: number[] }> | undefined)?.[car];
    let prev = 0;
    const groups = new Map<string, { lap: number; laps: number; cause: LapLossCause }>();
    for (const e of events) {
      // What the event lost: laps down at its lap against the lap before (from the lap table), else
      // against the previous event. At least a lap; laps won back in between are not taken off.
      const at = passages.find((p) => p.car === car && p.inLap <= e.lap && e.lap <= Math.max(p.inLap, p.outLap ?? p.inLap));
      // The stop where the car retired: the story says it retired, not that it lost laps there.
      if (at?.kind === "retirement") continue;
      const i = cols?.lapsDown ? cols.lap.indexOf(e.lap) : -1;
      const before = i > 0 ? cols!.lapsDown![i - 1] : prev;
      const lost = Math.max(1, e.lapsDown - before);
      prev = e.lapsDown;
      const cause: LapLossCause =
        e.cause === "on_track" ? "on_track" : e.cause !== "pit" && e.cause !== "fcy_pit" ? "not_explained" : at?.kind === "garage" ? "garage" : e.cause === "fcy_pit" ? "caution_stop" : "pit_stop";
      L.lapsLost += lost;
      if (cause === "pit_stop") L.inPitStops += lost;
      else if (cause === "garage") L.inGarage += lost;
      else if (cause === "caution_stop") L.underCaution += lost;
      else if (cause === "not_explained") L.notExplained += lost;
      else {
        L.onTrack += lost;
        L.onTrackFirstLap ??= e.lap;
        L.onTrackLastLap = e.lap;
      }
      // Laps lost at one stop count together (a long garage visit can lose them over several laps).
      const key = at ? `stop:${at.inLap}` : `lap:${e.lap}`;
      const g = groups.get(key) ?? { lap: at ? at.inLap : e.lap, laps: 0, cause };
      g.laps += lost;
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      if (g.laps > L.biggestLaps) {
        L.biggestLaps = g.laps;
        L.biggestLap = g.lap;
        L.biggestCause = g.cause;
      }
    }
    if (!L.lapsLost) continue;
    const entry = P.entries.find((e) => e.car === car);
    const wl = entry ? winnerLaps.get(entry.class) : undefined;
    if (entry?.result && typeof entry.result.laps === "number" && wl !== undefined && !retired.has(car)) L.finishLapsDown = Math.max(0, wl - entry.result.laps);
    out.set(car, L);
  }
  return out;
}

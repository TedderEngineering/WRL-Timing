import type { CanonLap, SourceFileInfo } from "../types.js";

/** Import blocker (FACT_ENGINE_SPEC.md §6): the race is not created. */
export class AdapterBlocker extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly files: string[] = [],
  ) {
    super(`${code}: ${message}`);
    this.name = "AdapterBlocker";
  }
}

/**
 * Sort each car's laps, refuse duplicate lap numbers (LAP-DUPLICATE) and decreasing crossings
 * (CROSSING-NOT-MONOTONIC). When `rolloverRef` is given, clock values more than 12 h before it are
 * moved to the next day first (D-TIME midnight rollover).
 */
export function checkLapOrder(laps: Record<string, CanonLap[]>, f: SourceFileInfo, rolloverRef?: number): void {
  for (const [car, ls] of Object.entries(laps)) {
    if (rolloverRef !== undefined) for (const x of ls) if (x.tS < rolloverRef - 43200) x.tS += 86400;
    ls.sort((a, b) => a.lap - b.lap);
    for (let i = 1; i < ls.length; i++) {
      if (ls[i].lap === ls[i - 1].lap) {
        throw new AdapterBlocker(
          "LAP-DUPLICATE",
          `${f.name}: car '${car}' lap ${ls[i].lap} appears twice (lines ${ls[i - 1].row} and ${ls[i].row})`,
          [f.fileId],
        );
      }
      if (ls[i].tS < ls[i - 1].tS - 1e-6) {
        throw new AdapterBlocker(
          "CROSSING-NOT-MONOTONIC",
          `${f.name}: car '${car}' crossing at line ${ls[i].row} is earlier than lap ${ls[i - 1].lap}`,
          [f.fileId],
        );
      }
    }
  }
}

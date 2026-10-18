import type { RaceChartData } from "@shared/types";
import { carNo } from "./car-number";
import { classColor, spanText, type PitVisit } from "./RunningOrder";

/** In the pits longer than this: in the garage or retired, listed after the cars making a stop, dimmed. */
export const LONG_STAY_MS = 10 * 60_000;

export interface PitRow {
  key: number;
  /** Time in the pits now (ms), or null when it went in before anyone was watching. */
  ms: number | null;
  long: boolean;
}

/** The cars in the pits: those making a stop first (shortest in first), then long stays, then unknown. */
export function pitRows(pits: Map<number, PitVisit>, now: number): PitRow[] {
  return [...pits]
    .map(([key, v]) => {
      const ms = v.since === null ? null : Math.max(0, now - v.since);
      return { key, ms, long: ms !== null && ms >= LONG_STAY_MS };
    })
    .sort((a, b) => (a.ms === null ? 1 : 0) - (b.ms === null ? 1 : 0) || (a.ms ?? 0) - (b.ms ?? 0));
}

/**
 * RaceTrace Live, under the track map: every car in the pits with a running timer (time since
 * its pit flag came on), in its class colour. Tapping one makes it the focus car.
 */
export function PitList({
  data,
  pits,
  now,
  focusNum,
  setFocusNum,
}: {
  data: RaceChartData;
  pits: Map<number, PitVisit>;
  now: number;
  focusNum: number;
  setFocusNum: (n: number) => void;
}) {
  const rows = pitRows(pits, now);
  if (!rows.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2 text-xs sm:px-6" style={{ borderColor: "#1e1e38", color: "#9a9ab4" }}>
      <span className="mr-1 flex items-center gap-1.5 font-semibold" style={{ color: "#e0e0e8" }}>
        <span className="rounded px-1 text-[10px] font-bold text-white" style={{ background: "#2563eb" }}>
          PIT
        </span>
        In the pits ({rows.length})
      </span>
      {rows.map((r) => {
        const cls = data.cars[String(r.key)]?.cls ?? "";
        const focus = r.key === focusNum;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => setFocusNum(r.key)}
            title={r.long ? "In the pits over 10 minutes (garage or retired)" : r.ms === null ? "In the pits since before the timing was watched" : "Time in the pits"}
            className="flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 tabular-nums hover:bg-white/5"
            style={{
              borderColor: focus ? "#F48C34" : "#2a2a48",
              borderLeft: `4px solid ${classColor(cls)}`,
              opacity: r.long || r.ms === null ? 0.55 : 1,
            }}
          >
            <span className="font-bold" style={{ color: focus ? "#F48C34" : "#e0e0e8" }}>
              #{carNo(data, r.key)}
            </span>
            <span style={{ color: r.long || r.ms === null ? "#9a9ab4" : "#93b4ff" }}>{r.ms === null ? "–" : spanText(r.ms)}</span>
          </button>
        );
      })}
    </div>
  );
}

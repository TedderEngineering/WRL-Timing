/**
 * The Gaps tab beside the live Position Trace: each car on the chart with its
 * last and best lap, its gap to the focus car, the pace difference, and the
 * laps until the next pass or lapping if both keep their current pace.
 */
import { useMemo } from "react";
import type { RaceChartData } from "@shared/types";
import { carNo } from "./car-number";
import { TRACE } from "./constants";
import { gapRows, PACE_LAPS, type GapRow } from "./live-gaps";

const T = { muted: "#9a9ab4", soft: "#cbd5e1", line: "#1e1e38", gain: "#4ade80", lose: "#f87171" };

/** Seconds → "2:19.637". */
function lapText(sec: number): string {
  const ms = Math.round(sec * 1000);
  const m = Math.floor(ms / 60_000);
  return `${m}:${((ms % 60_000) / 1000).toFixed(3).padStart(6, "0")}`;
}

const signed = (x: number, digits: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;

/** Gap as the timing screens show it, from the focus car: + behind, − ahead. */
function gapText(r: GapRow): string {
  if (r.isFocus) return "—";
  if (r.gapSec !== null) return signed(r.gapSec, 1);
  if (r.delta === null) return r.stopped ? "pit" : "";
  const laps = Math.trunc(r.delta);
  return laps === 0 ? "" : `${laps > 0 ? "+" : "−"}${Math.abs(laps)} L`;
}

const NEXT: Record<NonNullable<GapRow["next"]>["event"], [string, (k: number) => string]> = {
  pass: ["pass", () => "You pass this car for position"],
  passed: ["passes you", () => "This car passes you for position"],
  laps: ["you lap", (k) => `You put this car ${k} lap${k === 1 ? "" : "s"} down`],
  lapped: ["laps you", (k) => `You go ${-k} lap${k === -1 ? "" : "s"} down to this car`],
  unlap: ["lap back", () => "You get a lap back on this car"],
  unlapped: ["gets lap back", () => "This car gets a lap back on you"],
};

export function LiveGapsPanel({ data, focusNum, compSet, fieldCars }: { data: RaceChartData; focusNum: number; compSet: Set<number>; fieldCars: number[] }) {
  const rows = useMemo(() => {
    const nums = compSet.size ? [...compSet] : fieldCars;
    return gapRows(data, focusNum, nums);
  }, [data, focusNum, compSet, fieldCars]);

  const cell = "whitespace-nowrap px-1 py-1.5 text-right font-mono tabular-nums";
  return (
    <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0" style={{ background: "#0e0e20", color: T.muted }}>
          <tr>
            <th className="px-1 py-1.5 text-left font-medium" title="Car number and class position">Car</th>
            <th className="px-1 py-1.5 text-right font-medium">Last</th>
            <th className="px-1 py-1.5 text-right font-medium">Best</th>
            <th className="px-1 py-1.5 text-right font-medium" title="From the focus car: + behind, − ahead (seconds, or laps)">
              Gap
            </th>
            <th className="px-1 py-1.5 text-right font-medium" title={`Seconds a lap you gain (+) or lose (−) to this car, from each car's last ${PACE_LAPS} green laps`}>
              You/lap
            </th>
            <th className="px-1 py-1.5 text-right font-medium" title="If both keep their current pace: laps until the next pass or lapping">
              Next
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const next = r.next ? NEXT[r.next.event] : null;
            const gainColor = r.gainPerLap === null || Math.abs(r.gainPerLap) < 0.05 ? T.soft : r.gainPerLap > 0 ? T.gain : T.lose;
            return (
              <tr
                key={r.num}
                className="border-t"
                style={{ borderColor: T.line, background: r.isFocus ? "rgba(244,140,52,0.10)" : undefined }}
              >
                <td className="whitespace-nowrap px-1 py-1.5" title={`${r.team} · P${r.posClass ?? "?"} in ${r.cls}${r.pos ? ` · P${r.pos} overall` : ""}`}>
                  <span className="font-mono font-semibold" style={{ color: r.isFocus ? TRACE.focus : T.soft }}>
                    #{carNo(data, r.num)}
                  </span>{" "}
                  <span className="text-[11px]" style={{ color: T.muted }}>
                    P{r.posClass ?? "?"}
                  </span>
                </td>
                <td className={cell}>{r.last !== null ? lapText(r.last) : ""}</td>
                <td className={cell} style={{ color: T.soft }}>
                  {r.best !== null ? lapText(r.best) : ""}
                </td>
                <td className={cell}>{gapText(r)}</td>
                <td className={cell} style={{ color: gainColor }}>
                  {r.isFocus || r.gainPerLap === null ? "" : signed(r.gainPerLap, 2)}
                </td>
                <td className="whitespace-nowrap px-1 py-1.5 text-right" title={next && r.next ? `${next[1](r.next.k)} in about ${Math.round(r.next.laps)} laps at the current pace` : undefined}>
                  {next && r.next && (
                    <span style={{ color: r.next.event === "pass" || r.next.event === "laps" || r.next.event === "unlap" ? T.gain : T.lose }}>
                      {next[0]} <span className="font-mono tabular-nums">{Math.max(1, Math.round(r.next.laps))}</span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] leading-snug" style={{ color: T.muted }}>
        Gap: + behind the focus car, − ahead; L = laps. You/lap: what you gain (+) or lose (−) each lap, from the last {PACE_LAPS} green laps. Next: laps until the
        next pass or lapping if both keep that pace.
      </p>
    </div>
  );
}

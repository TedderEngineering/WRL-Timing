/**
 * The Gaps tab beside the live Position Trace: each car on the chart with its
 * last and best lap, its gap to the focus car, the pace difference, and the
 * laps until the next pass or lapping if both keep their current pace.
 */
import { useContext, useEffect, useMemo, useState } from "react";
import type { RaceChartData } from "@shared/types";
import { carNo } from "./car-number";
import { TRACE } from "./constants";
import { gapRows, lapsAndSeconds, PACE_LAPS, type GapRow } from "./live-gaps";
import { LiveClockContext } from "./live-zoom";

const T = { muted: "#9a9ab4", soft: "#cbd5e1", line: "#1e1e38", gain: "#4ade80", lose: "#f87171" };

/** Seconds → "2:19.64" (hundredths: enough to compare laps, and it fits the column). */
function lapText(sec: number): string {
  const cs = Math.round(sec * 100);
  const m = Math.floor(cs / 6000);
  return `${m}:${((cs % 6000) / 100).toFixed(2).padStart(5, "0")}`;
}

const signed = (x: number, digits: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;

/**
 * Gap from the focus car (+ behind, − ahead), as the timing screens show it: seconds on the same
 * lap; a lap or more apart, the rest in seconds plus whole laps at the focus car's average lap
 * ("+54.1 (+1L)").
 */
function gapText(r: GapRow): string {
  if (r.isFocus) return "—";
  if (r.gapSec !== null) return signed(r.gapSec, 1);
  if (r.delta === null) return "";
  const t = lapsAndSeconds(r.delta, r.focusPace).replace(/\(\+/, r.delta > 0 ? "(+" : "(−");
  return `${r.delta > 0 ? "+" : "−"}${t}`;
}

const NEXT: Record<NonNullable<GapRow["next"]>["event"], [string, (k: number) => string]> = {
  pass: ["pass", () => "You pass this car for position"],
  passed: ["passes you", () => "This car passes you for position"],
  laps: ["you lap", (k) => `You put this car ${k} lap${k === 1 ? "" : "s"} down`],
  lapped: ["laps you", (k) => `You go ${-k} lap${k === -1 ? "" : "s"} down to this car`],
  unlap: ["lap back", () => "You get a lap back on this car"],
  unlapped: ["unlaps", () => "This car gets a lap back on you"],
};

export function LiveGapsPanel({ data, focusNum, compSet, fieldCars }: { data: RaceChartData; focusNum: number; compSet: Set<number>; fieldCars: number[] }) {
  // Between updates the gaps move on at each car's pace: redraw every second.
  const drift = useContext(LiveClockContext);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!drift) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [drift]);
  const rows = useMemo(() => {
    const nums = compSet.size ? [...compSet] : fieldCars;
    return gapRows(data, focusNum, nums, drift?.());
    // tick: recompute each second
  }, [data, focusNum, compSet, fieldCars, drift, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fixed column shares (colgroup) so the table always fits the panel; anything still too long is cut with "…".
  const cell = "overflow-hidden text-ellipsis whitespace-nowrap px-[3px] py-1.5 text-right font-mono tabular-nums";
  return (
    <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-auto">
      <table className="w-full table-fixed border-collapse text-[11px]">
        <colgroup>
          <col style={{ width: "14%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "24%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "22%" }} />
        </colgroup>
        <thead className="sticky top-0" style={{ background: "#0e0e20", color: T.muted }}>
          <tr>
            <th className="px-[3px] py-1.5 text-left font-medium" title="Car number and class position">Car</th>
            <th className="px-[3px] py-1.5 text-right font-medium">Last</th>
            <th className="px-[3px] py-1.5 text-right font-medium">Best</th>
            <th className="px-[3px] py-1.5 text-right font-medium" title="From the focus car: + behind, − ahead. Seconds on the same lap; otherwise the rest in seconds plus whole laps at the focus car's average lap, e.g. +54.1 (+1L)">
              Gap
            </th>
            <th className="px-[3px] py-1.5 text-right font-medium" title={`Seconds a lap you gain (+) or lose (−) to this car, from the average of each car's last ${PACE_LAPS} green laps`}>
              You/lap
            </th>
            <th className="px-[3px] py-1.5 text-right font-medium" title="If both keep their current pace: laps until the next pass or lapping">
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
                <td
                  className="overflow-hidden text-ellipsis whitespace-nowrap px-[3px] py-1.5"
                  title={`${r.team} · P${r.posClass ?? "?"} in ${r.cls}${r.pos ? ` · P${r.pos} overall` : ""}${r.stopped ? " · in the pits or the garage (has not crossed the line for longer than its pace)" : ""}`}
                >
                  <span className="font-mono font-semibold" style={{ color: r.isFocus ? TRACE.focus : T.soft }}>
                    #{carNo(data, r.num)}
                  </span>{" "}
                  {r.stopped ? (
                    <span className="text-[10px] font-semibold uppercase" style={{ color: "#fab219" }}>
                      pit
                    </span>
                  ) : (
                    <span style={{ color: T.muted }}>P{r.posClass ?? "?"}</span>
                  )}
                </td>
                <td className={cell}>{r.last !== null ? lapText(r.last) : ""}</td>
                <td className={cell} style={{ color: T.soft }}>
                  {r.best !== null ? lapText(r.best) : ""}
                </td>
                <td className={cell}>{gapText(r)}</td>
                <td className={cell} style={{ color: gainColor }}>
                  {r.isFocus || r.gainPerLap === null ? "" : signed(r.gainPerLap, 2)}
                </td>
                <td className="overflow-hidden text-ellipsis whitespace-nowrap px-[3px] py-1.5 text-right" title={next && r.next ? `${next[1](r.next.k)} in about ${Math.round(r.next.laps)} laps at the current pace` : undefined}>
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
        Gap: + behind the focus car, − ahead; 54.1 (+1L) = a lap and 54.1 s at the focus car's average lap. Between updates, gaps move on at each car's pace (an estimate; held under a
        caution). You/lap: what you gain (+) or lose (−) each lap, from the average of the last {PACE_LAPS} green laps. Next: laps until the
        next pass or lapping if both keep that pace.
      </p>
    </div>
  );
}

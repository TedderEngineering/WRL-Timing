import type { RaceChartData } from "@shared/types";
import { carNo } from "./car-number";
import { getCompColor } from "./chart-renderer";
import { CLASS_COLORS, TRACE } from "./constants";

const C = {
  bg: "#0b0b18",
  head: "#12122a",
  line: "#1e1e38",
  text: "#e0e0e8",
  muted: "#9a9ab4",
  pit: "#2563eb",
};

/** A class's colour (the WRL classes have their own; any other a neutral grey). */
export function classColor(cls: string): string {
  return CLASS_COLORS[cls] ?? "#9a9ab4";
}

export interface OrderRow {
  key: number;
  /** Overall position now (null before the timing gives the car one). */
  pos: number | null;
  /** Position in class now. */
  posClass: number | null;
  cls: string;
  team: string;
}

/** The running order: cars by their position now, any without one after them by car number. */
export function runningOrder(data: RaceChartData): OrderRow[] {
  return Object.entries(data.cars)
    .map(([k, c]) => ({
      key: Number(k),
      pos: c.finishPos > 0 ? c.finishPos : null,
      posClass: c.finishPosClass > 0 ? c.finishPosClass : null,
      cls: c.cls,
      team: c.team,
    }))
    .sort(
      (a, b) =>
        (a.pos ?? 1e6) - (b.pos ?? 1e6) ||
        carNo(data, a.key).localeCompare(carNo(data, b.key), undefined, { numeric: true })
    );
}

/**
 * RaceTrace Live, beside the track map: every car's position now, its number and its place in
 * class, each row marked in its class colour. Cars in the pit lane carry a P. Tapping a row makes
 * it the focus car.
 */
export function RunningOrder({
  data,
  focusNum,
  setFocusNum,
  compSet,
  classView,
  inPit,
}: {
  data: RaceChartData;
  focusNum: number;
  setFocusNum: (n: number) => void;
  compSet: Set<number>;
  classView: string;
  /** Chart keys of the cars in the pit lane now. */
  inPit: Set<number>;
}) {
  const rows = runningOrder(data);
  const th = "px-1.5 py-1.5 font-semibold";
  return (
    <div
      className="custom-scroll border-t text-xs md:min-h-0 md:w-[300px] md:shrink-0 md:overflow-y-auto md:border-l md:border-t-0"
      style={{ background: C.bg, borderColor: C.line, color: C.text }}
    >
      <table className="w-full border-collapse tabular-nums">
        <thead
          className="sticky top-0 z-10"
          style={{ background: C.head, color: C.muted }}
        >
          <tr className="text-left">
            <th className={`${th} w-5 text-center`} aria-label="In the pits" />
            <th className={`${th} text-right`}>P</th>
            <th className={th}>#</th>
            <th className={th}>Class</th>
            <th className={`${th} text-right`} title="Position in class">
              PIC
            </th>
            <th className={`${th} w-full`}>Team</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const focus = r.key === focusNum;
            const compared = !focus && compSet.has(r.key);
            const other = !!classView && r.cls !== classView && !focus;
            const color = classColor(r.cls);
            const pit = inPit.has(r.key);
            return (
              <tr
                key={r.key}
                onClick={() => setFocusNum(r.key)}
                className="cursor-pointer border-b hover:bg-white/5"
                style={{
                  borderColor: C.line,
                  opacity: other ? 0.35 : 1,
                  background: focus ? "rgba(244,140,52,0.16)" : `${color}26`,
                }}
                aria-current={focus ? "true" : undefined}
              >
                <td className="px-1 py-1 text-center" style={{ borderLeft: `5px solid ${color}` }}>
                  {pit && (
                    <span
                      className="inline-block rounded px-1 text-[10px] font-bold text-white"
                      style={{ background: C.pit }}
                      title="In the pits"
                    >
                      P
                    </span>
                  )}
                </td>
                <td className="px-1.5 py-1 text-right font-semibold">{r.pos ?? "–"}</td>
                <td
                  className="px-1.5 py-1 font-bold"
                  style={{
                    color: focus
                      ? TRACE.focus
                      : compared
                        ? getCompColor(compSet, focusNum, r.key)
                        : C.text,
                  }}
                >
                  {carNo(data, r.key)}
                </td>
                <td className="px-1.5 py-1">
                  <span
                    className="rounded px-1 text-[10px] font-bold"
                    style={{ background: color, color: C.bg }}
                  >
                    {r.cls || "–"}
                  </span>
                </td>
                <td className="px-1.5 py-1 text-right font-semibold" style={{ color }}>
                  {r.posClass ?? "–"}
                </td>
                <td
                  className="max-w-0 truncate px-1.5 py-1"
                  style={{ color: C.muted }}
                  title={r.team}
                >
                  {r.team}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

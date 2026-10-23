import type { RaceChartData } from "@shared/types";
import { carNo } from "./car-number";
import { classColor, type PitVisit } from "./RunningOrder";

const C = { line: "#1e1e38", text: "#e0e0e8", muted: "#9a9ab4", chip: "#2a2a48", pit: "#2563eb", out: "#6b7280", focus: "#F48C34" };

/** Chart keys in running order (position now, then car number). */
function inOrder(data: RaceChartData, keys: Iterable<number>): number[] {
  return [...keys].sort(
    (a, b) =>
      (data.cars[String(a)]?.finishPos || 1e6) - (data.cars[String(b)]?.finishPos || 1e6) ||
      carNo(data, a).localeCompare(carNo(data, b), undefined, { numeric: true })
  );
}

/**
 * RaceTrace Live, under the track map: the cars in the pits making a stop, and the cars not
 * running (OUT: in the garage, retired, parked), each in its class colour. Tapping one makes it
 * the focus car.
 */
export function PitList({
  data,
  pits,
  out,
  focusNum,
  setFocusNum,
  className = "",
}: {
  data: RaceChartData;
  pits: Map<number, PitVisit>;
  out: Set<number>;
  focusNum: number;
  setFocusNum: (n: number) => void;
  /** Placement (the track map puts it beside the map on a wide screen). */
  className?: string;
}) {
  const stopping = inOrder(data, [...pits.keys()].filter((k) => !out.has(k)));
  const notRunning = inOrder(data, out);
  if (!stopping.length && !notRunning.length) return null;
  const chip = (key: number, dim: boolean) => {
    const focus = key === focusNum;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setFocusNum(key)}
        className="rounded-md border px-1.5 py-0.5 font-bold tabular-nums hover:bg-white/5"
        style={{
          borderColor: focus ? C.focus : C.chip,
          borderLeft: `4px solid ${classColor(data.cars[String(key)]?.cls ?? "")}`,
          color: focus ? C.focus : dim ? C.muted : C.text,
        }}
      >
        #{carNo(data, key)}
      </button>
    );
  };
  const tag = (text: string, bg: string) => (
    <span className="rounded px-1 text-[10px] font-bold text-white" style={{ background: bg }}>
      {text}
    </span>
  );
  // One row: the cars in the pits, then the cars not running (wrapping on a narrow screen). Beside
  // the map on a wide screen: a column, each group under its heading.
  return (
    <div
      className={`custom-scroll flex flex-wrap items-center gap-1.5 border-t px-3 py-2 text-xs sm:px-6 xl:w-44 xl:shrink-0 xl:content-start xl:overflow-y-auto xl:border-l xl:border-t-0 xl:px-2 ${className}`}
      style={{ borderColor: C.line, color: C.muted }}
    >
      {stopping.length > 0 && (
        <>
          <span className="mr-1 flex items-center gap-1.5 font-semibold xl:w-full" style={{ color: C.text }}>
            {tag("PIT", C.pit)} In the pits ({stopping.length})
          </span>
          {stopping.map((k) => chip(k, false))}
        </>
      )}
      {stopping.length > 0 && notRunning.length > 0 && <span aria-hidden className="mx-1.5 h-4 w-px xl:hidden" style={{ background: C.chip }} />}
      {notRunning.length > 0 && (
        <span className="contents" title="Not running: no lap for over 15 minutes (retired, in the garage, parked)">
          <span className="mr-1 flex items-center gap-1.5 font-semibold xl:mt-2 xl:w-full" style={{ color: C.text }}>
            {tag("OUT", C.out)} Not running ({notRunning.length})
          </span>
          {notRunning.map((k) => chip(k, true))}
        </span>
      )}
    </div>
  );
}

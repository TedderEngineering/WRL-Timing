import type { AnnotationData, CarData, PitMarker, RaceChartData } from "@shared/types";
import { carNo } from "./car-number";
import { formatLapTime, getCompColor } from "./chart-renderer";
import { CLASS_COLORS, TRACE } from "./constants";

const C = {
  bg: "#0b0b18",
  card: "#10101f",
  head: "#15152c",
  line: "#22223f",
  text: "#e0e0e8",
  muted: "#9a9ab4",
  pit: "#2563eb",
  pitText: "#93b4ff",
  personal: "#4ade80",
  classBest: "#e879f9",
};

/** A class's colour (the WRL classes have their own; any other a neutral grey). */
export function classColor(cls: string): string {
  return CLASS_COLORS[cls] ?? "#9a9ab4";
}

/** A car's visit to the pit lane now, as the map saw it. */
export interface PitVisit {
  /** When the map saw it go in (ms); null when it was already in the pits at the first reading. */
  since: number | null;
  /** The car's completed laps when it went in. */
  afterLap: number;
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

/** A car's last completed lap and its best lap (seconds), or null before it has one. */
export function lapTimes(car: CarData | undefined): { last: number | null; best: number | null } {
  const xs = (car?.laps ?? []).filter((l) => l.ltSec > 0);
  if (!xs.length) return { last: null, best: null };
  return { last: xs[xs.length - 1].ltSec, best: Math.min(...xs.map((l) => l.ltSec)) };
}

/** Each class's best lap so far (seconds). */
export function classBests(data: RaceChartData): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of Object.values(data.cars)) {
    const { best } = lapTimes(c);
    if (best !== null && best < (out.get(c.cls) ?? Infinity)) out.set(c.cls, best);
  }
  return out;
}

/** A lap time (seconds) as M:SS.mmm. */
export function lapText(sec: number | null): string {
  if (sec === null) return "–";
  const m = Math.floor(sec / 60);
  return formatLapTime(`${m}:${(sec - m * 60).toFixed(3)}`);
}

/** How long, as M:SS. */
export function spanText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * What to say about a car in the pit lane now: which stop this is (the timing may already have
 * recorded it from the in-lap; otherwise it is the next one), the lap it came in after, the stint
 * it ends, and how long it has been in the lane (when the map saw it go in).
 */
export function pitDetail(pits: PitMarker[] | undefined, visit: PitVisit, now: number): string {
  const stops = [...(pits ?? [])].sort((a, b) => a.l - b.l);
  const recorded = stops.findIndex((m) => m.l >= visit.afterLap);
  const stopNo = recorded >= 0 ? recorded + 1 : stops.length + 1;
  const before = stops.filter((m) => m.l < visit.afterLap);
  const stint = visit.afterLap - (before.length ? before[before.length - 1].l : 0);
  return [
    `Stop ${stopNo}`,
    visit.since !== null ? `${spanText(now - visit.since)} in the lane` : null,
    visit.afterLap > 0 ? `in after lap ${visit.afterLap}` : null,
    stint > 0 ? `${stint}-lap stint` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * RaceTrace Live, beside the track map: the running order now. Position, number, class and place
 * in class, last and best lap, and stops, each row marked in its class colour. A car in the pit
 * lane carries a P and a line on its stop. Tapping a row makes it the focus car.
 */
export function RunningOrder({
  data,
  annotations,
  focusNum,
  setFocusNum,
  compSet,
  classView,
  pits,
  now,
}: {
  data: RaceChartData;
  annotations: AnnotationData | null;
  focusNum: number;
  setFocusNum: (n: number) => void;
  compSet: Set<number>;
  classView: string;
  /** The cars in the pit lane now, by chart key. */
  pits: Map<number, PitVisit>;
  now: number;
}) {
  const rows = runningOrder(data);
  const bests = classBests(data);
  const th = "px-1.5 py-2 font-semibold";
  return (
    <div className="flex flex-col px-3 pb-3 pt-1 md:min-h-0 md:w-[440px] md:shrink-0 md:py-4 md:pl-2 md:pr-5 lg:w-[540px]">
      <div
        className="custom-scroll overflow-hidden rounded-lg border text-xs md:min-h-0 md:flex-1 md:overflow-y-auto"
        style={{ background: C.card, borderColor: C.line, color: C.text }}
      >
        <table className="w-full border-collapse tabular-nums">
          <thead className="sticky top-0 z-10" style={{ background: C.head, color: C.muted }}>
            <tr className="text-left">
              <th className={`${th} w-6 text-center`} aria-label="In the pits" />
              <th className={`${th} text-right`}>P</th>
              <th className={th}>#</th>
              <th className={th}>Class</th>
              <th className={`${th} text-right`} title="Position in class">
                PIC
              </th>
              <th className={`${th} text-right`}>Last</th>
              <th className={`${th} text-right`}>Best</th>
              <th className={`${th} text-right`} title="Pit stops">
                Pits
              </th>
              <th className={`${th} hidden w-full sm:table-cell`}>Team</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const focus = r.key === focusNum;
              const compared = !focus && compSet.has(r.key);
              const other = !!classView && r.cls !== classView && !focus;
              const color = classColor(r.cls);
              const visit = pits.get(r.key);
              const carPits = annotations?.[String(r.key)]?.pits;
              const { last, best } = lapTimes(data.cars[String(r.key)]);
              const classBest = best !== null && best === bests.get(r.cls);
              const rowStyle = {
                borderColor: C.line,
                opacity: other ? 0.35 : 1,
                background: focus ? "rgba(244,140,52,0.16)" : `${color}26`,
              };
              const cells = [
                <tr
                  key={r.key}
                  onClick={() => setFocusNum(r.key)}
                  className={`cursor-pointer hover:bg-white/5 ${visit ? "" : "border-b"}`}
                  style={rowStyle}
                  aria-current={focus ? "true" : undefined}
                >
                  <td className="px-1 py-1 text-center" style={{ borderLeft: `5px solid ${color}` }}>
                    {visit && (
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
                    style={{ color: focus ? TRACE.focus : compared ? getCompColor(compSet, focusNum, r.key) : C.text }}
                  >
                    {carNo(data, r.key)}
                  </td>
                  <td className="px-1.5 py-1">
                    <span className="rounded px-1 text-[10px] font-bold" style={{ background: color, color: C.bg }}>
                      {r.cls || "–"}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-right font-semibold" style={{ color }}>
                    {r.posClass ?? "–"}
                  </td>
                  <td
                    className="px-1.5 py-1 text-right"
                    style={{ color: last !== null && last === best ? C.personal : C.text }}
                    title={last !== null && last === best ? "Its best lap" : undefined}
                  >
                    {lapText(last)}
                  </td>
                  <td
                    className="px-1.5 py-1 text-right"
                    style={{ color: classBest ? C.classBest : C.muted }}
                    title={classBest ? "Best lap in class" : undefined}
                  >
                    {lapText(best)}
                  </td>
                  <td className="px-1.5 py-1 text-right">{carPits?.length ?? 0}</td>
                  <td className="hidden max-w-0 truncate px-1.5 py-1 sm:table-cell" style={{ color: C.muted }} title={r.team}>
                    {r.team}
                  </td>
                </tr>,
              ];
              if (visit)
                cells.push(
                  <tr
                    key={`${r.key}-pit`}
                    onClick={() => setFocusNum(r.key)}
                    className="cursor-pointer border-b"
                    style={rowStyle}
                  >
                    <td className="p-0" style={{ borderLeft: `5px solid ${color}` }} />
                    <td colSpan={8} className="px-1.5 pb-1.5 pt-0 text-[11px]" style={{ color: C.pitText }}>
                      {pitDetail(carPits, visit, now)}
                    </td>
                  </tr>
                );
              return cells;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

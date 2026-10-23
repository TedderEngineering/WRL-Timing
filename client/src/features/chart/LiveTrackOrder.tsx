/**
 * RaceTrace Live: the Live Crossing Order. Every car on the track in the order it is round the
 * circuit now (from the moving map positions), around a reference car (the focus car): the cars
 * ahead of it on the road above, with the time they are ahead (−), the cars behind below (+),
 * half a lap each way, whatever lap each car is on. As timing screens show it:
 *
 *   - a square on the lead lap of its class, a circle a lap or more down (laps-down.ts), in the
 *     class colour; a thin bar in the class colour over the class leader;
 *   - car number, the driver in the car now, laps in the stint, the gap on the road, and whether
 *     the reference car is gaining or losing time to the car now (its pace against the car's, over
 *     each one's last 5 green laps, as the Strategy tab's Δ pace).
 *
 * The gap is the distance between the two cars on the lap at the reference car's pace: how long
 * it takes the reference car to reach where the other car is now (or the other car to reach it).
 * Cars in the pit lane are listed after the ones on track.
 */
import type { RaceChartData } from "@shared/types";
import { carNo } from "./car-number";
import { liveClassColor } from "./constants";
import { recentPace } from "./live-battles";

const C = { card: "#10101f", head: "#15152c", line: "#22223f", text: "#e0e0e8", muted: "#9a9ab4", focus: "#F48C34", pit: "#2563eb", gain: "#4ade80", lose: "#f87171" };

/** A car's place on the map now. */
export interface TrackPlace {
  key: number;
  /** Metres past the line. */
  d: number;
  /** In the pit lane (or going into it). */
  inPit: boolean;
}

export interface TrackOrderRow {
  key: number;
  /** Seconds ahead (−) or behind (+) the reference car on the road; null in the pit lane. */
  gapS: number | null;
  inPit: boolean;
  isRef: boolean;
}

/**
 * The cars round the circuit from the reference car: ahead (most first) to behind, within half a
 * lap each way; the pit lane after. `speed`: the reference car's pace (m/s).
 */
export function trackOrder(places: TrackPlace[], refKey: number, len: number, speed: number): TrackOrderRow[] {
  const ref = places.find((p) => p.key === refKey);
  if (!ref || !(len > 0) || !(speed > 0)) return [];
  const onTrack: TrackOrderRow[] = [];
  const pits: TrackOrderRow[] = [];
  for (const p of places) {
    if (p.key === refKey) {
      onTrack.push({ key: p.key, gapS: 0, inPit: p.inPit, isRef: true });
      continue;
    }
    if (p.inPit) {
      pits.push({ key: p.key, gapS: null, inPit: true, isRef: false });
      continue;
    }
    // Forward distance from the reference car to this one, folded into (−len/2, len/2]: ahead > 0.
    let fwd = (((p.d - ref.d) % len) + len) % len;
    if (fwd > len / 2) fwd -= len;
    onTrack.push({ key: p.key, gapS: -fwd / speed, inPit: false, isRef: false });
  }
  onTrack.sort((a, b) => a.gapS! - b.gapS! || a.key - b.key);
  pits.sort((a, b) => a.key - b.key);
  return [...onTrack, ...pits];
}

/** Laps since the car's last stop (its laps when it has not stopped). */
export function stintLaps(data: RaceChartData, key: number): number {
  const laps = data.cars[String(key)]?.laps ?? [];
  if (!laps.length) return 0;
  const last = laps[laps.length - 1].l;
  for (let i = laps.length - 1; i >= 0; i--) if (laps[i].pit === 1) return last - laps[i].l;
  return last;
}

/** The class leader of each class (class position 1). */
function classLeaders(data: RaceChartData): Set<number> {
  const s = new Set<number>();
  for (const [k, c] of Object.entries(data.cars)) if (c.finishPosClass === 1) s.add(Number(k));
  return s;
}

/**
 * Seconds a lap the reference car is gaining (+) or losing (−) to another car now: the other car's
 * pace less the reference car's, each over its last 5 green laps. Null when either has none.
 */
export function gainPerLap(data: RaceChartData, refKey: number, key: number): number | null {
  const ref = recentPace(data, refKey).now;
  const other = recentPace(data, key).now;
  return ref === null || other === null ? null : other - ref;
}

/** Gaining: green ▲, losing: red ▼, under 0.05 s a lap: "=". */
function Trend({ s }: { s: number | null }) {
  if (s === null) return <span style={{ color: C.muted }}>—</span>;
  if (Math.abs(s) < 0.05) return <span style={{ color: C.muted }}>=</span>;
  const up = s > 0;
  return (
    <span className="inline-flex items-center justify-end gap-1" style={{ color: up ? C.gain : C.lose }}>
      <svg viewBox="0 0 8 7" className="h-[7px] w-[8px]" fill="currentColor" aria-hidden>
        {up ? <path d="M4 0 8 7H0z" /> : <path d="M4 7 0 0h8z" />}
      </svg>
      {Math.abs(s).toFixed(1)}
    </span>
  );
}

const gapText = (g: number) => (Math.abs(g) < 0.05 ? "0.0" : `${g < 0 ? "−" : "+"}${Math.abs(g).toFixed(1)}`);

export function LiveTrackOrder({
  data,
  rows,
  lapsDown,
  drivers,
  followed,
  onRowTap,
  refMissing,
}: {
  data: RaceChartData;
  rows: TrackOrderRow[];
  lapsDown: Map<number, number>;
  /** The driver in each car now, by chart key. */
  drivers: Map<string, string>;
  followed: Set<number>;
  onRowTap: (key: number) => void;
  /** The reference car is not placed on the map now. */
  refMissing: boolean;
}) {
  const leaders = classLeaders(data);
  const ref = rows.find((r) => r.isRef)?.key;
  const trend = new Map(ref === undefined ? [] : rows.filter((r) => !r.isRef).map((r) => [r.key, gainPerLap(data, ref, r.key)]));
  if (refMissing || !rows.length) {
    return (
      <p className="m-0 px-3 py-6 text-center text-xs" style={{ color: C.muted }}>
        The Live Crossing Order is measured from the focus car&apos;s place on the track, which is not known right now. Pick a car on track with Focus.
      </p>
    );
  }
  const th = "px-1.5 py-2 font-semibold";
  return (
    <table className="w-full border-collapse tabular-nums">
      <caption className="px-2 pb-1 pt-2 text-left text-[11px]" style={{ color: C.muted }}>
        On the road round the circuit now, from the focus car: ahead (−) and behind (+) in seconds at its pace. Trend: the time the focus car is gaining (▲) or losing (▼) to each car a lap.
      </caption>
      <thead className="sticky top-0 z-10" style={{ background: C.head, color: C.muted }}>
        <tr className="text-left">
          <th className="w-6 p-0" aria-label="Class, lead lap or lapped" />
          <th className={th}>#</th>
          <th className={th}>Driver</th>
          <th className={`${th} text-right`} title="Laps since the car's last stop">
            Stint
          </th>
          <th className={`${th} text-right`} title="Seconds ahead (−) or behind (+) the focus car on the road">
            Gap
          </th>
          <th
            className={`${th} text-right`}
            title="Seconds a lap the focus car is gaining (▲) or losing (▼) to the car now: their pace over each one's last 5 green laps"
          >
            Trend
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const car = data.cars[String(r.key)];
          if (!car) return null;
          const color = liveClassColor(car.cls);
          const lapped = (lapsDown.get(r.key) ?? 0) > 0;
          const isFollowed = !r.isRef && followed.has(r.key);
          const leader = leaders.has(r.key);
          return (
            <tr
              key={r.key}
              onClick={() => onRowTap(r.key)}
              className="cursor-pointer hover:bg-white/5"
              style={{
                borderTop: leader ? `2px solid ${color}` : `1px solid ${C.line}`,
                background: r.isRef ? "rgba(37,99,235,0.45)" : isFollowed ? "rgba(255,255,255,0.08)" : undefined,
              }}
              aria-current={r.isRef ? "true" : undefined}
              aria-pressed={r.isRef ? undefined : isFollowed}
              title={r.isRef ? "The focus car (change it with Focus)" : isFollowed ? "Following on the map: tap to stop" : "Tap to follow on the map"}
            >
              <td className="p-0 text-center" title={`${car.cls}${leader ? " leader" : ""} · ${lapped ? `${lapsDown.get(r.key)} down` : "lead lap"}`}>
                <span
                  className={`inline-block h-2.5 w-2.5 align-middle ${lapped ? "rounded-full" : "rounded-[1px]"}`}
                  style={{ background: color, transform: lapped ? "scale(0.8)" : undefined }}
                />
              </td>
              <td className="px-1.5 py-1 font-bold" style={{ color: r.isRef ? "#ffffff" : C.text }}>
                {isFollowed ? <span className="-mx-1 rounded-full border-2 border-white px-1">{carNo(data, r.key)}</span> : carNo(data, r.key)}
              </td>
              <td className="max-w-[160px] truncate px-1.5 py-1" style={{ color: r.isRef ? "#ffffff" : C.text }} title={drivers.get(String(r.key)) ?? car.team}>
                {drivers.get(String(r.key)) ?? <span style={{ color: C.muted }}>{car.team}</span>}
              </td>
              <td className="px-1.5 py-1 text-right" style={{ color: C.muted }}>
                {stintLaps(data, r.key)}
              </td>
              <td className="px-1.5 py-1 text-right font-semibold">
                {r.isRef ? (
                  ""
                ) : r.inPit ? (
                  <span className="rounded px-1 text-[10px] font-bold text-white" style={{ background: C.pit }}>
                    PIT
                  </span>
                ) : (
                  gapText(r.gapS!)
                )}
              </td>
              <td className="py-1 pl-1.5 pr-2 text-right text-xs font-semibold">{r.isRef ? "" : <Trend s={trend.get(r.key) ?? null} />}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

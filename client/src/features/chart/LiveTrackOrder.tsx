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
import { InfoTip } from "../../components/InfoTip";
import { GHOST_KEY } from "./pit-ghost";
import { clockText, ghostLabel, type GhostTraffic } from "./ghost-traffic";
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

/**
 * The cars round the circuit from the overall leader, as a timing screen lists them: the leader
 * first, then every car on track in the order it follows the leader on the road (the whole lap),
 * each with how far behind it is (+, at `speed`); the pit lane after. With the leader in the pit
 * lane (or not placed), it still heads the list (in the pits), and the road is measured from the
 * best-placed car on track (`place`: the running order). Returns no rows with no car on track.
 */
export function leaderOrder(places: TrackPlace[], leaderKey: number | null, place: (key: number) => number, len: number, speed: number): TrackOrderRow[] {
  if (!(len > 0) || !(speed > 0)) return [];
  const onTrack = places.filter((p) => !p.inPit);
  const refKey = leaderRef(places, leaderKey, place);
  const ref = onTrack.find((p) => p.key === refKey);
  if (!ref) return [];
  const rows: TrackOrderRow[] = onTrack.map((p) => {
    const behind = (((ref.d - p.d) % len) + len) % len;
    return { key: p.key, gapS: p.key === ref.key ? 0 : behind / speed, inPit: false, isRef: p.key === ref.key };
  });
  rows.sort((a, b) => a.gapS! - b.gapS! || a.key - b.key);
  const pits = places
    .filter((p) => p.inPit && p.key !== leaderKey)
    .sort((a, b) => a.key - b.key)
    .map((p) => ({ key: p.key, gapS: null, inPit: true, isRef: false }));
  const leaderAway = leaderKey !== null && ref.key !== leaderKey ? [{ key: leaderKey, gapS: null, inPit: true, isRef: false }] : [];
  return [...leaderAway, ...rows, ...pits];
}

/** The car the leader's list is measured from: the leader on track, else the best-placed car on track (null: none). */
export function leaderRef(places: TrackPlace[], leaderKey: number | null, place: (key: number) => number): number | null {
  const onTrack = places.filter((p) => !p.inPit);
  if (onTrack.some((p) => p.key === leaderKey)) return leaderKey;
  return [...onTrack].sort((a, b) => (place(a.key) || 1e6) - (place(b.key) || 1e6) || a.key - b.key)[0]?.key ?? null;
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
  focusKey,
  leaderKey,
  from,
  onFrom,
  note = null,
  ghostLossS = null,
  ghostTraffic = null,
  lapS = null,
}: {
  data: RaceChartData;
  rows: TrackOrderRow[];
  lapsDown: Map<number, number>;
  /** The driver in each car now, by chart key. */
  drivers: Map<string, string>;
  followed: Set<number>;
  onRowTap: (key: number) => void;
  /** No car to measure from is placed on the map now. */
  refMissing: boolean;
  /** The focus car: highlighted wherever it is in the list. */
  focusKey: number;
  /** The overall leader. */
  leaderKey: number | null;
  /** Measured from the focus car (the cars round it) or from the leader (the leader on top). */
  from: "focus" | "leader";
  /** The viewer's choice (the list may be from the leader for now: see `note`). */
  onFrom?: (f: "focus" | "leader") => void;
  /** Why the list is not what the viewer chose ("#246 is in the pits: …"). */
  note?: string | null;
  /** The pit ghost's time (s), when it is in the rows. */
  ghostLossS?: number | null;
  /** The traffic it would come out in (ghost-traffic.ts). */
  ghostTraffic?: GhostTraffic | null;
  /** A lap at the pace the gaps are measured at (s): from the leader, gaps to the focus car go the nearer way round. */
  lapS?: number | null;
}) {
  const leaders = classLeaders(data);
  const fromLeader = from === "leader";
  // From the leader, the gaps are still the focus car's (the leader is on top, the order follows
  // it round the lap): each car's place behind the leader less the focus car's. With the focus car
  // off the track for now (in the pits), from the leader.
  const focusRow = rows.find((r) => r.key === focusKey);
  const base = fromLeader && focusRow && !focusRow.inPit && focusRow.gapS !== null ? focusRow.gapS : null;
  const ref = base !== null ? focusKey : rows.find((r) => r.isRef)?.key;
  // Ahead or behind the focus car the nearer way round the lap, as in Focus car mode (a car just
  // behind the leader can be just ahead of a focus car nearly a lap down on it).
  const gapOf = (r: TrackOrderRow) => {
    if (base === null) return r.gapS!;
    let g = r.gapS! - base;
    if (lapS && lapS > 0) {
      g = ((g % lapS) + lapS) % lapS;
      if (g > lapS / 2) g -= lapS;
    }
    return g;
  };
  const trend = new Map(ref === undefined ? [] : rows.filter((r) => r.key !== ref && r.key !== GHOST_KEY).map((r) => [r.key, gainPerLap(data, ref, r.key)]));
  const who = fromLeader && base === null ? "the leader" : "the focus car";
  const picker = onFrom && (
    <span className="ml-auto inline-flex shrink-0 overflow-hidden rounded-md border" role="radiogroup" aria-label="Measure the order from" style={{ borderColor: C.line }}>
      {(
        [
          ["focus", "Focus car"],
          ["leader", "Leader"],
        ] as const
      ).map(([f, label]) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={from === f && !note}
          onClick={() => onFrom(f)}
          className="px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: from === f && !note ? "#2a2a48" : "transparent", color: from === f && !note ? C.text : C.muted }}
        >
          {label}
        </button>
      ))}
    </span>
  );
  if (refMissing || !rows.length) {
    return (
      <div className="px-2 pt-2">
        <div className="flex items-center gap-2 text-[11px]" style={{ color: C.muted }}>
          From {picker}
        </div>
        <p className="m-0 px-1 py-6 text-center text-xs" style={{ color: C.muted }}>
          The Live Crossing Order is measured from the cars&apos; places on the track, which are not known right now.
        </p>
      </div>
    );
  }
  const th = "px-1.5 py-2 font-semibold";
  return (
    <table className="w-full border-collapse tabular-nums">
      <caption className="px-2 pb-1 pt-2 text-left text-[11px]" style={{ color: C.muted }}>
        {/* What the list shows, behind an (i); the note when it is not what the viewer chose stays in view. */}
        <span className="flex items-center gap-1">
          From
          <InfoTip
            label="Live Crossing Order"
            text={`${
              fromLeader && base !== null
                ? "On the road round the circuit now, the overall leader on top, then every car in the order it follows on the road (the whole lap). Gap: ahead of (−) or behind (+) the focus car, in seconds at its pace."
                : fromLeader
                  ? "On the road round the circuit now, the overall leader on top: every car behind it on the road (+), the whole lap, in seconds at its pace."
                  : "On the road round the circuit now, from the focus car: ahead (−) and behind (+) in seconds at its pace."
            } Trend: the time ${who} is gaining (▲) or losing (▼) to each car a lap.`}
          />
          {picker}
        </span>
        {note && (
          <span className="mt-1 block font-semibold" style={{ color: "#fab219" }}>
            {note}
          </span>
        )}
      </caption>
      <thead className="sticky top-0 z-10" style={{ background: C.head, color: C.muted }}>
        <tr className="text-left">
          <th className="w-6 p-0" aria-label="Class, lead lap or lapped" />
          <th className={th}>#</th>
          <th className={th}>Driver</th>
          <th className={`${th} text-right`} title="Laps since the car's last stop">
            Stint
          </th>
          <th className={`${th} text-right`} title="Laps down to the class leader, counted when the car last crossed the line (0: on the lead lap)">
            LD
          </th>
          <th className={`${th} text-right`} title={fromLeader && base === null ? "Seconds behind the leader on the road" : "Seconds ahead (−) or behind (+) the focus car on the road"}>
            Gap
          </th>
          <th
            className={`${th} text-right`}
            title={`Seconds a lap ${who} is gaining (▲) or losing (▼) to the car now: their pace over each one's last 5 green laps`}
          >
            Trend
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          if (r.key === GHOST_KEY) {
            // The pit ghost (pit-ghost.ts): where the focus car would rejoin after a stop, in its place on the road.
            return (
              <tr key="ghost" style={{ borderTop: `1px dashed ${C.focus}`, borderBottom: `1px dashed ${C.focus}`, background: "rgba(244,140,52,0.10)" }} title={`Pit ghost: where #${carNo(data, focusKey)} would rejoin if it stopped now and lost ${ghostLossS ?? 0} s`}>
                <td className="p-0 text-center">
                  <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed align-middle" style={{ borderColor: C.focus }} />
                </td>
                <td className="px-1.5 py-1 text-[10px] font-extrabold uppercase tracking-wider" style={{ color: C.focus }}>
                  Pit
                </td>
                <td className="px-1.5 py-1" style={{ color: C.focus }}>
                  <span className="italic">
                    #{carNo(data, focusKey)} after a stop (+{ghostLossS ?? 0} s)
                  </span>
                  {ghostTraffic && (
                    <span
                      className="block text-[11px] font-semibold"
                      style={{ color: ghostTraffic.near.length ? "#fab219" : "#4ade80" }}
                      title={
                        ghostTraffic.near.length
                          ? `It would come out among ${ghostTraffic.near.map((n) => `#${carNo(data, n.key)} (${n.gapS < 0 ? "−" : "+"}${Math.abs(n.gapS).toFixed(1)} s)`).join(", ")}.${ghostTraffic.clearInS !== null ? ` Stopping in ${clockText(ghostTraffic.clearInS)} it would come out clear${ghostTraffic.clearForS !== null ? `, for ${clockText(ghostTraffic.clearForS)}` : ""}.` : ""}`
                          : `It would come out in clear air${ghostTraffic.clearForS !== null ? ` (for ${clockText(ghostTraffic.clearForS)} from now)` : ""}.`
                      }
                    >
                      {ghostTraffic.near.length ? `${ghostTraffic.near.map((n) => `#${carNo(data, n.key)}`).join(" ")} · ${ghostLabel(ghostTraffic).replace(/^\d+ cars? · ?/, "") || "in traffic"}` : "clear air"}
                    </span>
                  )}
                </td>
                <td />
                <td />
                <td className="px-1.5 py-1 text-right font-semibold" style={{ color: C.focus }}>
                  {r.gapS === null ? "" : gapText(gapOf(r))}
                </td>
                <td />
              </tr>
            );
          }
          const car = data.cars[String(r.key)];
          if (!car) return null;
          const color = liveClassColor(car.cls);
          const lapped = (lapsDown.get(r.key) ?? 0) > 0;
          const isFocus = r.key === focusKey;
          const isFollowed = !isFocus && followed.has(r.key);
          const leader = leaders.has(r.key);
          return (
            <tr
              key={r.key}
              onClick={() => onRowTap(r.key)}
              className="cursor-pointer hover:bg-white/5"
              style={{
                borderTop: leader ? `2px solid ${color}` : `1px solid ${C.line}`,
                background: isFocus ? "rgba(37,99,235,0.45)" : isFollowed ? "rgba(255,255,255,0.08)" : undefined,
              }}
              aria-current={isFocus ? "true" : undefined}
              aria-pressed={isFocus ? undefined : isFollowed}
              title={isFocus ? "The focus car (change it with Focus)" : isFollowed ? "Following on the map: tap to stop" : "Tap to follow on the map"}
            >
              <td className="p-0 text-center" title={`${car.cls}${leader ? " leader" : ""} · ${lapped ? `${lapsDown.get(r.key)} down` : "lead lap"}`}>
                <span
                  className={`inline-block h-2.5 w-2.5 align-middle ${lapped ? "rounded-full" : "rounded-[1px]"}`}
                  style={{ background: color, transform: lapped ? "scale(0.8)" : undefined }}
                />
              </td>
              <td className="px-1.5 py-1 font-bold" style={{ color: isFocus ? "#ffffff" : C.text }}>
                {isFollowed ? <span className="-mx-1 rounded-full border-2 border-white px-1">{carNo(data, r.key)}</span> : carNo(data, r.key)}
              </td>
              <td className="max-w-[160px] truncate px-1.5 py-1" style={{ color: isFocus ? "#ffffff" : C.text }} title={drivers.get(String(r.key)) ?? car.team}>
                {drivers.get(String(r.key)) ?? <span style={{ color: C.muted }}>{car.team}</span>}
              </td>
              <td className="px-1.5 py-1 text-right" style={{ color: C.muted }}>
                {stintLaps(data, r.key)}
              </td>
              <td className="px-1.5 py-1 text-right" style={{ color: (lapsDown.get(r.key) ?? 0) > 0 ? C.text : C.muted }}>
                {lapsDown.get(r.key) ?? "–"}
              </td>
              <td className="px-1.5 py-1 text-right font-semibold">
                {r.inPit ? (
                  <span className="rounded px-1 text-[10px] font-bold text-white" style={{ background: C.pit }}>
                    PIT
                  </span>
                ) : r.key === ref ? (
                  fromLeader && r.key === leaderKey ? <span style={{ color: C.muted }}>Leader</span> : ""
                ) : (
                  gapText(gapOf(r))
                )}
              </td>
              <td className="py-1 pl-1.5 pr-2 text-right text-xs font-semibold">{r.key === ref || r.inPit ? "" : <Trend s={trend.get(r.key) ?? null} />}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

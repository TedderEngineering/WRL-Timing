import { useEffect, useMemo, useRef, useState } from "react";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { getPublic } from "../../hooks/useLiveChartData";
import { carKey, carNo } from "./car-number";
import { getCompColor } from "./chart-renderer";
import { RunningOrder, type PitVisit } from "./RunningOrder";
import { TRACE } from "./constants";
import { IN_PIT, NO_GPS, OFF_TRACK, STALE, isFrozen, isStopped, pointAt, signedGap, step, takeReading, type CarLaps, type CarMotion, type CarPlace } from "./track-motion";

/** The circuit's outline from the server (metres; points ordered from the start/finish line). */
interface TrackOutline {
  len: number;
  w: number;
  h: number;
  pts: [number, number][];
  ds: number[];
}

/** How often the map asks for positions (the server reads them every 5 s; the edge keeps them 2 s). */
const POLL_MS = 5_000;
/** Older than this, the map says how old its positions are. */
const OLD_MS = 20_000;

const C = {
  bg: "#0b0b18",
  track: "#23233f",
  trackIn: "#2e2e54",
  line: "#e0e0e8",
  muted: "#9a9ab4",
  dim: "#6b6b88",
  text: "#e0e0e8",
  /** The overall leader's ring and tag, and its dot when it is not a compare car. */
  leader: "#fbbf24",
  leaderDot: "#d4d4e2",
  /** The dashed ring round a car off the track. */
  offTrack: "#f97316",
  /** The ring round a stopped car. */
  stopped: "#ef4444",
};

/**
 * RaceTrace Live: the circuit with every car as a numbered dot moving round it ("marching ants").
 * The focus car is the biggest and brightest, compare cars are in their trace colours, the rest
 * small and dim; another class is dimmer still. Beside it, the running order (position, number,
 * place in class, by class colour); cars in the pit lane are listed under the map. Tapping a dot
 * or a row makes it the focus car.
 */
export function TrackMap({
  slug,
  data,
  focusNum,
  setFocusNum,
  compSet,
  classView,
  flag = null,
  annotations = null,
}: {
  slug: string;
  data: RaceChartData;
  focusNum: number;
  setFocusNum: (n: number) => void;
  compSet: Set<number>;
  classView: string;
  /** The session's flag now ("Yellow", "Code 35"…): under a caution the safety car is shown. */
  flag?: string | null;
  /** The race's notes (its pit stops), for the running order. */
  annotations?: AnnotationData | null;
}) {
  const [track, setTrack] = useState<TrackOutline | null>(null);
  const [trackMissing, setTrackMissing] = useState(false);
  const [readingAt, setReadingAt] = useState<number | null>(null);
  const [pits, setPits] = useState<string[]>([]);
  const [unplaced, setUnplaced] = useState<string[]>([]);
  const [offTrack, setOffTrack] = useState<string[]>([]);
  const [pitVisits, setPitVisits] = useState<Map<number, PitVisit>>(() => new Map());
  /** Whether a reading has come yet (a car in the pits at the first one went in before the page saw it). */
  const seenReading = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [now, setNow] = useState(() => Date.now());
  const motions = useRef(new Map<string, CarMotion>());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hits = useRef<{ key: number; x: number; y: number; r: number }[]>([]);

  // The outline: once, and again every minute until the timing has learned the circuit.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      getPublic<TrackOutline>(`/live/${encodeURIComponent(slug)}/track`)
        .then(({ body }) => alive && (setTrack(body), setTrackMissing(false)))
        .catch(() => {
          if (!alive) return;
          setTrackMissing(true);
          timer = setTimeout(load, 60_000);
        });
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [slug]);

  // A typical pace (m/s) for a car until its own is known: the lap over the field's median green lap.
  const typicalSpeed = useMemo(() => {
    if (!track) return 40;
    const xs = Object.values(data.cars)
      .map((c) => c.laps[c.laps.length - 1]?.ltSec)
      .filter((v): v is number => typeof v === "number" && v > 30 && (data.greenPaceCutoff <= 0 || v < data.greenPaceCutoff))
      .sort((a, b) => a - b);
    return xs.length ? track.len / xs[Math.floor(xs.length / 2)] : 40;
  }, [data, track]);

  // Each car's own pace (m/s) from its laps: the median of its last five laps out of the pits,
  // within 60-140% of the typical pace; and its completed laps. Read through a ref so the readings
  // always use the latest.
  const lapPace = useMemo(() => {
    const out = new Map<string, CarLaps>();
    if (!track) return out;
    for (const [k, c] of Object.entries(data.cars)) {
      const xs = c.laps
        .filter((l) => l.ltSec > 30 && !l.pit)
        .slice(-5)
        .map((l) => l.ltSec)
        .sort((a, b) => a - b);
      const pace = xs.length ? Math.max(0.6 * typicalSpeed, Math.min(1.4 * typicalSpeed, track.len / xs[Math.floor(xs.length / 2)])) : null;
      const last = c.laps[c.laps.length - 1];
      out.set(carNo(data, Number(k)), { pace, laps: last ? last.l : 0, lastLapS: last && last.ltSec > 0 ? last.ltSec : null });
    }
    return out;
  }, [data, track, typicalSpeed]);
  const lapPaceRef = useRef(lapPace);
  lapPaceRef.current = lapPace;
  // Under a caution cars really do slow: the motion allows their pace to fall further.
  const cautionRef = useRef(isCaution(flag));
  cautionRef.current = isCaution(flag);

  // Positions every 5 s while the page is visible.
  useEffect(() => {
    if (!track) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      getPublic<{ ageMs: number; cars: CarPlace[] }>(`/live/${encodeURIComponent(slug)}/pos`)
        .then(({ body, edgeAgeMs }) => {
          if (!alive) return;
          const t = Date.now();
          const age = body.ageMs + edgeAgeMs;
          const onTrack = body.cars.filter((c) => !(c[3] & IN_PIT));
          motions.current = takeReading(motions.current, onTrack, t, age, track.len, typicalSpeed, (n) => lapPaceRef.current.get(n) ?? null, cautionRef.current);
          setReadingAt(t - age);
          const inPit = body.cars.filter((c) => c[3] & IN_PIT).map((c) => c[0]);
          setPits(inPit);
          // When a car new to the pit lane went in: unknown at the first reading (it was there already).
          const wentIn = seenReading.current ? t - age : null;
          seenReading.current = true;
          setPitVisits((prev) => pitVisitsNow(prev, inPit, dataRef.current, wentIn));
          setUnplaced(body.cars.filter((c) => !(c[3] & IN_PIT) && c[1] === null).map((c) => c[0]));
          setOffTrack(body.cars.filter((c) => !(c[3] & IN_PIT) && c[3] & OFF_TRACK).map((c) => c[0]));
        })
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(tick);
    };
  }, [slug, track, typicalSpeed]);

  // Drawing: every frame, each car eased towards where it should be.
  const lastFrame = useRef(Date.now());
  /** The estimated safety car's own place, moving on at its pace between frames. */
  const scState = useRef<SafetyCarState>({ d: 0, active: false });
  const draw = useRef<() => void>(() => undefined);
  draw.current = () => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !track) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const pad = 28;
    const scale = Math.min((W - 2 * pad) / track.w, (H - 2 * pad) / track.h);
    const ox = (W - track.w * scale) / 2;
    const oy = (H - track.h * scale) / 2;
    const px = ([x, y]: [number, number]): [number, number] => [ox + x * scale, oy + y * scale];

    // The circuit.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    track.pts.forEach((p, i) => {
      const [x, y] = px(p);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = C.track;
    ctx.lineWidth = 16;
    ctx.stroke();
    ctx.strokeStyle = C.trackIn;
    ctx.lineWidth = 10;
    ctx.stroke();

    // The start/finish line, across the track.
    const [sx, sy] = px(pointAt(track.pts, track.ds, track.len, 0));
    const [tx, ty] = px(pointAt(track.pts, track.ds, track.len, 20));
    const ang = Math.atan2(ty - sy, tx - sx) + Math.PI / 2;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(ang) * 11, sy - Math.sin(ang) * 11);
    ctx.lineTo(sx + Math.cos(ang) * 11, sy + Math.sin(ang) * 11);
    ctx.stroke();

    // The cars: the rest, then compare cars, the overall leader, then the focus car on top.
    const t = Date.now();
    const dt = Math.min(100, t - lastFrame.current);
    step(motions.current, t, dt, track.len);
    lastFrame.current = t;
    const inClass = classView ? new Set(data.classGroups[classView] ?? []) : null;
    const leaderKey = overallLeader(data);
    const dots = [...motions.current.values()]
      .map((m) => {
        const key = carKey(data, m.num);
        if (key === null || !data.cars[String(key)]) return null;
        const focus = key === focusNum;
        const compared = !focus && compSet.has(key);
        const leader = key === leaderKey;
        const other = inClass !== null && !inClass.has(key) && !focus && !leader;
        return { m, key, focus, compared, leader, other, rank: focus ? 3 : leader ? 2 : compared ? 1 : 0 };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.rank - b.rank || (b.other ? 1 : 0) - (a.other ? 1 : 0));
    const many = compSet.size > 8;
    hits.current = [];
    let leaderAt: { x: number; y: number; r: number } | null = null;
    for (const d of dots) {
      const offTrack = !!d.m.off;
      const [x, y] = offTrack ? px(d.m.offShown ?? d.m.off!) : px(pointAt(track.pts, track.ds, track.len, d.m.shown));
      // The leader is always drawn full size with its number, even when not a compare car.
      const r = d.focus ? 12 : d.compared || d.leader ? (many && !d.leader ? 8 : 9) : 5;
      const color = d.focus ? TRACE.focus : d.compared ? getCompColor(compSet, focusNum, d.key) : d.leader ? C.leaderDot : C.dim;
      const hollow = (d.m.flags & (NO_GPS | STALE)) !== 0 || isFrozen(d.m, t);
      if (d.leader) leaderAt = { x, y, r };
      ctx.globalAlpha = d.other ? 0.3 : d.compared || d.focus || d.leader ? 1 : 0.7;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (hollow) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
      if (d.focus) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      if (!offTrack && isStopped(d.m, t, track.len)) {
        // Stopped (frozen fix, next lap overdue): a solid red ring at its last real fix.
        ctx.strokeStyle = C.stopped;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (offTrack) {
        // Off the track: a dashed orange ring round the dot.
        ctx.setLineDash([3, 2.5]);
        ctx.strokeStyle = C.offTrack;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (d.focus || d.compared || d.leader) {
        const label = carNo(data, d.key);
        ctx.fillStyle = hollow ? color : d.focus || (d.leader && !d.compared) ? "#0b0b18" : "#ffffff";
        ctx.font = `${d.focus ? 700 : 600} ${label.length > 2 ? (d.focus ? 9 : 7) : d.focus ? 11 : 8.5}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x, y + 0.5);
      }
      ctx.globalAlpha = 1;
      hits.current.push({ key: d.key, x, y, r: Math.max(r, 10) });
    }

    // The overall leader: a gold ring round its dot and a P1 tag above it, on top of everything.
    if (leaderAt) {
      const { x, y, r } = leaderAt;
      ctx.strokeStyle = C.leader;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
      ctx.stroke();
      const ty = y - r - 13;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = C.leader;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x - 11, ty - 7, 22, 14, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#0b0b18";
      ctx.font = "800 9.5px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("P1", x, ty + 0.5);
    }

    // The safety car under a caution: where the timing places it when it sends one; otherwise an
    // estimate moving steadily at safety car pace just ahead of the field, drawn dashed (the
    // timing does not track it).
    let sc: { d: number; estimated: boolean } | null = null;
    const own = isCaution(flag) ? findSafetyCar(motions.current) : null;
    if (!isCaution(flag)) scState.current = { d: 0, active: false };
    else if (own) sc = { d: own.shown, estimated: false };
    else {
      scState.current = stepSafetyCar(scState.current, scTarget(motions.current, data, track.len), scSpeed(motions.current), dt, track.len);
      if (scState.current.active) sc = { d: scState.current.d, estimated: true };
    }
    if (sc) {
      const [x, y] = px(pointAt(track.pts, track.ds, track.len, sc.d));
      ctx.fillStyle = "#fab219";
      ctx.strokeStyle = "#0b0b18";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x - 13, y - 8, 26, 16, 4);
      ctx.fill();
      ctx.stroke();
      if (sc.estimated) {
        ctx.setLineDash([3, 2]);
        ctx.strokeStyle = "#fab219";
        ctx.beginPath();
        ctx.roundRect(x - 16, y - 11, 32, 22, 6);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = "#0b0b18";
      ctx.font = "700 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("SC", x, y + 0.5);
    }
  };
  useEffect(() => {
    if (!track) return;
    let raf = 0;
    const frame = () => {
      draw.current();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [track]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    // The top-most dot under the tap (the focus car is drawn last).
    const hit = [...hits.current].reverse().find((h) => Math.hypot(h.x - x, h.y - y) <= h.r);
    if (hit) setFocusNum(hit.key);
  };

  const age = readingAt !== null ? now - readingAt : null;
  const keys = (nums: string[]) => nums.map((n) => carKey(data, n)).filter((k): k is number => k !== null && !!data.cars[String(k)]);
  const leader = overallLeader(data);
  const leaderInPits = leader !== null && keys(pits).includes(leader) ? leader : null;
  // Cars stopped now (frozen fix, next lap overdue), refreshed with the clock every second.
  const stopped = track ? [...motions.current.values()].filter((m) => isStopped(m, now, track.len)).map((m) => m.num) : [];
  const label = (nums: string[]) =>
    keys(nums)
      .map((k) => `#${carNo(data, k)}`)
      .join(", ");

  return (
    <div className="flex flex-col md:min-h-0 md:flex-1">
      <div className="flex flex-col md:min-h-0 md:flex-1 md:flex-row">
        <div ref={wrapRef} className="relative h-[80vw] max-h-[560px] min-h-[300px] md:h-auto md:max-h-none md:min-h-0 md:min-w-0 md:flex-1" style={{ background: C.bg }}>
          <canvas
            ref={canvasRef}
            onClick={onClick}
            role="img"
            aria-label={`Track map: every car's place on the circuit, ${focusNum ? `focus car #${carNo(data, focusNum)} highlighted` : ""}. Tap a car to focus it.`}
            className="absolute inset-0 cursor-pointer"
          />
          {!track && (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm" style={{ color: C.muted }}>
              {trackMissing ? "The track map appears once the timing has learned the circuit from a few clean laps." : "Loading the track map…"}
            </p>
          )}
        </div>
        <RunningOrder data={data} focusNum={focusNum} setFocusNum={setFocusNum} compSet={compSet} classView={classView} annotations={annotations} pits={pitVisits} now={now} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-xs sm:px-6" style={{ borderColor: "#1e1e38", color: C.muted }}>
        {label(pits) && (
          <span>
            <span style={{ color: C.text }}>In the pits:</span> {label(pits)}
          </span>
        )}
        {label(unplaced) && <span>No position: {label(unplaced)}</span>}
        {label(stopped) && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px]" style={{ borderColor: C.stopped }} />
            Stopped: {label(stopped)}
          </span>
        )}
        {label(offTrack) && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-dashed" style={{ borderColor: C.offTrack }} />
            Off track: {label(offTrack)}
          </span>
        )}
        {age !== null && age > OLD_MS && <span>Positions {Math.round(age / 1000)} s old</span>}
        <span className="flex items-center gap-1.5">
          <span className="rounded-full border-[1.5px] bg-white px-1.5 text-[9.5px] font-extrabold leading-[13px]" style={{ borderColor: C.leader, color: C.bg }}>
            P1
          </span>
          {leaderInPits ? `overall leader #${carNo(data, leaderInPits)} in the pits` : "overall leader"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ borderColor: C.muted }} /> faint signal
        </span>
        {isCaution(flag) && (
          <span className="flex items-center gap-1.5" style={{ color: "#fab219" }}>
            <span className="rounded px-1 text-[10px] font-bold" style={{ background: "#fab219", color: "#0b0b18" }}>
              SC
            </span>
            safety car
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The cars in the pit lane after a reading: one already there keeps its visit; one new to it went
 * in at `at` (null when unknown: already there at the page's first reading), after its laps so far.
 */
export function pitVisitsNow(prev: Map<number, PitVisit>, inPit: string[], data: RaceChartData, at: number | null): Map<number, PitVisit> {
  const out = new Map<number, PitVisit>();
  for (const n of inPit) {
    const key = carKey(data, n);
    if (key === null || !data.cars[String(key)]) continue;
    const laps = data.cars[String(key)].laps;
    out.set(key, prev.get(key) ?? { since: at, afterLap: laps.length ? laps[laps.length - 1].l : 0 });
  }
  return out;
}

/** The overall leader now (the timing's running order), if it has one. */
export function overallLeader(data: RaceChartData): number | null {
  for (const [k, c] of Object.entries(data.cars)) if (c.finishPos === 1) return Number(k);
  return null;
}

/** Flags that bring out the safety car (a full-course caution). */
const CAUTION_FLAGS = new Set(["Yellow", "Code 35", "Code 60", "FCY"]);
export function isCaution(flag: string | null | undefined): boolean {
  return !!flag && CAUTION_FLAGS.has(flag);
}

/** A safety car the timing sends as a car of its own ("SC", "PC1"…), if any. */
export function findSafetyCar(motions: Map<string, CarMotion>): CarMotion | null {
  for (const m of motions.values()) if (/^(SC|PC)\d*$/i.test(m.num.trim())) return m;
  return null;
}

/** How far ahead of the first car on track the estimated safety car runs (m). */
export const SC_AHEAD_M = 120;
/** Safety car pace when the field's speed is not known, and the bounds of its pace (mph). */
export const SC_DEFAULT_MPH = 65;
const SC_MIN_MPH = 40;
const SC_MAX_MPH = 90;
/** The estimate's pace is nudged by at most this share towards the head of the field. */
const SC_NUDGE = 0.25;
/** Further than this from the head of the field (m), the estimate is placed there again. */
export const SC_RESET_M = 800;

export interface SafetyCarState {
  /** Metres past the line. */
  d: number;
  /** Placed (under a caution, once there was a car to place it ahead of). */
  active: boolean;
}

/** Where the safety car should be: just ahead of the first car in the running order still on track. */
export function scTarget(motions: Map<string, CarMotion>, data: RaceChartData, len: number): number | null {
  const order = Object.entries(data.cars)
    .filter(([, c]) => (c.finishPos ?? 0) > 0)
    .sort((a, b) => a[1].finishPos - b[1].finishPos);
  for (const [k] of order) {
    const m = motions.get(carNo(data, Number(k))) ?? motions.get(k);
    if (m && !(m.flags & (IN_PIT | OFF_TRACK))) return (m.shown + SC_AHEAD_M) % len;
  }
  return null;
}

/** Safety car pace (m/s): the median speed of the cars on track (under a caution they run at its pace), within 40-90 mph. */
export function scSpeed(motions: Map<string, CarMotion>): number {
  const xs = [...motions.values()]
    .filter((m) => !(m.flags & IN_PIT) && m.mph !== null && m.mph > 0)
    .map((m) => m.mph as number)
    .sort((a, b) => a - b);
  const mph = xs.length ? xs[Math.floor(xs.length / 2)] : SC_DEFAULT_MPH;
  return Math.min(SC_MAX_MPH, Math.max(SC_MIN_MPH, mph)) * 0.44704;
}

/**
 * The estimated safety car `dtMs` on: it keeps moving at safety car pace, its pace nudged (at most
 * ±25%) towards just ahead of the field, never backwards; placed there on the first frame of a
 * caution, and again only if it ends up over 800 m away. With no car to follow it keeps going.
 */
export function stepSafetyCar(sc: SafetyCarState, target: number | null, v: number, dtMs: number, len: number): SafetyCarState {
  const move = (k: number) => ((sc.d + (v * k * Math.max(0, dtMs)) / 1000) % len + len) % len;
  if (target === null) return sc.active ? { d: move(1), active: true } : sc;
  if (!sc.active) return { d: target, active: true };
  const gap = signedGap(sc.d, target, len);
  if (Math.abs(gap) > SC_RESET_M) return { d: target, active: true };
  return { d: move(Math.max(1 - SC_NUDGE, Math.min(1 + SC_NUDGE, 1 + gap / 600))), active: true };
}

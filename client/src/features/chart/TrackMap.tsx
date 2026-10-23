import { useEffect, useMemo, useRef, useState } from "react";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { getPublic } from "../../hooks/useLiveChartData";
import { carKey, carNo } from "./car-number";
import { TRACE, labelOn, liveClassColor } from "./constants";
import { readFollowedCars, saveFollowedCars, toggleFollow } from "../live/my-car";
import { RunningOrder, outCars, type PitVisit } from "./RunningOrder";
import { lapsDown } from "./laps-down";
import { PitList } from "./PitList";
import { virtualCars } from "../live/race-laps";
import { RaceControl } from "./RaceControl";
import { LiveTrackOrder, trackOrder } from "./LiveTrackOrder";
import { driversInCars } from "./DriverReportTab";
import {
  IN_PIT,
  NO_GPS,
  OFF_TRACK,
  STALE,
  isFrozen,
  isStopped,
  pointAt,
  signedGap,
  step,
  takeReading,
  visibility,
  type CarLaps,
  type CarMotion,
  type CarPlace,
  type PitLane,
} from "./track-motion";

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
  text: "#e0e0e8",
  /** The overall leader's ring and tag. */
  leader: "#fbbf24",
  /** The dashed ring round a car off the track. */
  offTrack: "#f97316",
  /** The ring round a stopped car. */
  stopped: "#ef4444",
  /** The ring round a car on its out-lap from the pits. */
  outLap: "#22d3ee",
  /** The pit entry tag (the running order's blue P). */
  pit: "#2563eb",
};

/**
 * RaceTrace Live: the circuit with every car as a numbered dot moving round it ("marching ants").
 * Every dot is in its class colour (GTU grey, GTO blue, GP1 red, GP2 green). The focus car is the
 * biggest, with a white ring; compare cars are larger, numbered; the rest small; with one class
 * picked, the other classes are faint. Beside it, the running order (position, number,
 * place in class, by class colour); cars in the pit lane are listed under the map. Tapping a dot or
 * a row follows that car (or stops following it); the focus car is set with Focus. Followed cars
 * are drawn like the focus car, large with a glow and a ring, so several cars can be tracked at
 * once, and their rows are highlighted.
 */
export function TrackMap({
  slug,
  data,
  focusNum,
  setFocusNum,
  compSet,
  classView,
  flag = null,
  clock = null,
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
  /** The race clock: time to go (s) at a moment (client clock), frozen under a red flag. For the virtual cars. */
  clock?: { ttgS: number; at: number; frozen: boolean } | null;
  /** The race's notes (its pit stops), for the running order. */
  annotations?: AnnotationData | null;
}) {
  const [track, setTrack] = useState<TrackOutline | null>(null);
  const [trackMissing, setTrackMissing] = useState(false);
  const [readingAt, setReadingAt] = useState<number | null>(null);
  const [pits, setPits] = useState<string[]>([]);
  /** The pit lane on the lap, once the server has learned it from the pit flags. */
  const pitLane = useRef<PitLane | null>(null);
  const [unplaced, setUnplaced] = useState<string[]>([]);
  const [offTrack, setOffTrack] = useState<string[]>([]);
  const [pitVisits, setPitVisits] = useState<Map<number, PitVisit>>(() => new Map());
  /** The cars not running (no lap for over 15 minutes): OUT, not drawn on the track. */
  const out = useMemo(() => outCars(data), [data]);
  /** Laps down to the class leader (the LD column): a lapped car is drawn as a ghost dot. */
  const lapped = useMemo(() => lapsDown(data), [data]);
  /** What the map leaves out, picked with the key's chips under it (kept on this device). */
  const [hidden, setHidden] = useState<Set<string>>(readHiddenLayers);
  const toggleLayer = (k: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(k)) next.add(k);
      saveHiddenLayers(next);
      return next;
    });
  /** Beside the map: the running order (timing) or the Live Crossing Order (on the road now). */
  const [orderView, setOrderView] = useState<"timing" | "live">(() => {
    try {
      return localStorage.getItem(ORDER_VIEW_KEY) === "live" ? "live" : "timing";
    } catch {
      return "timing";
    }
  });
  const pickOrderView = (v: "timing" | "live") => {
    setOrderView(v);
    try {
      localStorage.setItem(ORDER_VIEW_KEY, v);
    } catch {
      /* private window: for this visit only */
    }
  };
  const drivers = useMemo(() => (orderView === "live" ? driversInCars(data, annotations ?? {}) : new Map<string, string>()), [orderView, data, annotations]);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [now, setNow] = useState(() => Date.now());
  const motions = useRef(new Map<string, CarMotion>());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hits = useRef<{ key: number; x: number; y: number; r: number }[]>([]);
  /** The cars this viewer follows on the map (published numbers), kept per race on this device. */
  const [followed, setFollowed] = useState<string[]>(() => readFollowedCars(slug));
  useEffect(() => setFollowed(readFollowedCars(slug)), [slug]);
  const follow = (cars: string[]) => {
    setFollowed(cars);
    saveFollowedCars(slug, cars);
  };
  const followKeys = useMemo(() => new Set(followed.map((n) => carKey(data, n)).filter((k): k is number => k !== null)), [followed, data]);

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
      getPublic<{ ageMs: number; cars: CarPlace[]; pit?: PitLane | null }>(`/live/${encodeURIComponent(slug)}/pos`)
        .then(({ body, edgeAgeMs }) => {
          if (!alive) return;
          const t = Date.now();
          const age = body.ageMs + edgeAgeMs;
          const onTrack = body.cars.filter((c) => !(c[3] & IN_PIT));
          pitLane.current = body.pit ?? null;
          motions.current = takeReading(
            motions.current,
            onTrack,
            t,
            age,
            track.len,
            typicalSpeed,
            (n) => lapPaceRef.current.get(n) ?? null,
            cautionRef.current,
            pitLane.current
          );
          setReadingAt(t - age);
          const inPit = body.cars.filter((c) => c[3] & IN_PIT).map((c) => c[0]);
          setPits(inPit);
          setPitVisits((prev) => pitVisitsNow(prev, inPit, dataRef.current));
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

    // The pit entry: a PIT tag beside the track where the pit flag comes on, with the cars in the
    // pits; pitting cars fade into it.
    if (pitLane.current) {
      const [ex, ey] = px(pointAt(track.pts, track.ds, track.len, pitLane.current.in));
      const [fx, fy] = px(pointAt(track.pts, track.ds, track.len, pitLane.current.in + 20));
      const a = Math.atan2(fy - ey, fx - ex) + Math.PI / 2;
      const off = 22;
      const lx = ex + Math.cos(a) * off;
      const ly = ey + Math.sin(a) * off;
      ctx.strokeStyle = C.pit;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(a) * 9, ey + Math.sin(a) * 9);
      ctx.lineTo(lx - Math.cos(a) * 7, ly - Math.sin(a) * 7);
      ctx.stroke();
      const stopping = [...pitVisits.keys()].filter((k) => !out.has(k)).length;
      const text = stopping ? `PIT ${stopping}` : "PIT";
      ctx.font = "700 9px system-ui, sans-serif";
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = C.pit;
      ctx.beginPath();
      ctx.roundRect(lx - w / 2, ly - 7, w, 14, 4);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, lx, ly + 0.5);
    }

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
        // Not running (OUT): listed under the map, not drawn on the track.
        if (key === null || !data.cars[String(key)] || out.has(key)) return null;
        const focus = key === focusNum;
        const compared = !focus && compSet.has(key);
        const leader = key === leaderKey;
        const followed = !focus && followKeys.has(key);
        const other = inClass !== null && !inClass.has(key) && !focus && !followed && !leader;
        const ghost = (lapped.get(key) ?? 0) > 0;
        // Left out with the key's chips (the focus car and followed cars are always drawn).
        if (!focus && !followed && (hidden.has(`cls:${data.cars[String(key)].cls}`) || (ghost && hidden.has("lapped")))) return null;
        return { m, key, focus, followed, compared, leader, other, ghost, outLap: onOutLap(data, key, pitVisits), rank: focus ? 4 : followed ? 3 : leader ? 2 : compared ? 1 : 0 };
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
      const tracked = d.focus || d.followed;
      const r = tracked ? 13 : d.compared || d.leader ? (many && !d.leader ? 8 : 9) : 5;
      // Every dot in its class colour; the focus car and followed cars are the large ones, with a
      // glow and a ring (orange on the focus car, white on the followed ones).
      const color = liveClassColor(data.cars[String(d.key)]?.cls);
      const hollow = (d.m.flags & (NO_GPS | STALE)) !== 0 || isFrozen(d.m, t);
      if (hollow && !tracked && hidden.has("faint")) continue;
      // Fading in onto the map, or out into the pit lane.
      const vis = offTrack ? 1 : visibility(d.m, t, track.len);
      if (vis < 0.02) continue;
      if (d.leader && vis > 0.5 && !hidden.has("leader")) leaderAt = { x, y, r };
      if (tracked) {
        ctx.globalAlpha = 0.3 * vis;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r + 9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = (d.other ? 0.3 : d.compared || tracked || d.leader ? 1 : 0.7) * vis;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (hollow) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (d.ghost) {
        // A lap down or more: a ghost of the dot (see-through, with a thin edge).
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * 0.3;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25;
        ctx.stroke();
        ctx.globalAlpha = a;
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
      if (tracked) {
        ctx.strokeStyle = d.focus ? TRACE.focus : "#ffffff";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      const stoppedNow = !offTrack && isStopped(d.m, t, track.len);
      if (d.outLap && !offTrack && !stoppedNow && !hidden.has("outLap")) {
        // On its out-lap from the pits: a solid cyan ring.
        ctx.strokeStyle = C.outLap;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (stoppedNow) {
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
      if (tracked || d.compared || d.leader) {
        const label = carNo(data, d.key);
        ctx.fillStyle = hollow || d.ghost ? "#ffffff" : labelOn(color);
        const size = tracked ? (label.length > 3 ? 8 : label.length > 2 ? 9.5 : 11.5) : label.length > 2 ? 7 : 8.5;
        ctx.font = `${tracked ? 700 : 600} ${size}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x, y + 0.5);
      }
      ctx.globalAlpha = 1;
      if (vis > 0.5) hits.current.push({ key: d.key, x, y, r: Math.max(r, 10) });
    }

    // The virtual car of each class (race-laps.ts): its leader's last-laps pace, crossing the line
    // as the clock runs out. A hollow diamond in the class colour.
    if (clock && !hidden.has("virtual")) {
      const ttgNow = clock.frozen ? clock.ttgS : clock.ttgS - (t - clock.at) / 1000;
      for (const v of virtualCars(data, ttgNow, track.len, out)) {
        if ((classView && v.cls !== classView) || hidden.has(`cls:${v.cls}`)) continue;
        const [x, y] = px(pointAt(track.pts, track.ds, track.len, v.d));
        const color = liveClassColor(v.cls);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = color;
        ctx.fillRect(-6, -6, 12, 12);
        ctx.globalAlpha = 1;
        ctx.setLineDash([2.5, 2]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(-6, -6, 12, 12);
        ctx.restore();
        ctx.fillStyle = "#ffffff";
        ctx.font = "800 8px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("V", x, y + 0.5);
      }
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
    if (sc && !hidden.has("sc")) {
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
    // Follow the car tapped, or stop following it (the focus car is always shown large).
    if (hit && hit.key !== focusNum) follow(toggleFollow(followed, carNo(data, hit.key)));
  };

  const age = readingAt !== null ? now - readingAt : null;
  const keys = (nums: string[]) => nums.map((n) => carKey(data, n)).filter((k): k is number => k !== null && !!data.cars[String(k)]);
  const leader = overallLeader(data);
  const leaderInPits = leader !== null && keys(pits).includes(leader) ? leader : null;
  // Cars stopped now (frozen fix, next lap overdue), refreshed with the clock every second.
  const stopped = track
    ? [...motions.current.values()].filter((m) => isStopped(m, now, track.len) && !out.has(carKey(data, m.num) ?? -1)).map((m) => m.num)
    : [];
  const label = (nums: string[]) =>
    keys(nums)
      .map((k) => `#${carNo(data, k)}`)
      .join(", ");

  return (
    <div className="flex flex-col md:min-h-0 md:flex-1">
      <div className="flex flex-col md:min-h-0 md:flex-1 md:flex-row">
        <div className="flex flex-col md:min-h-0 md:min-w-0 md:flex-1">
        {/* The map, with its key and the pit / not-running cars: beside it on a wide screen (key left,
            pits right), under it otherwise. */}
        <div className="flex flex-col md:min-h-0 md:flex-1 xl:flex-row">
        <div ref={wrapRef} className="relative order-1 h-[80vw] max-h-[560px] min-h-[300px] md:h-auto md:max-h-none md:min-h-0 md:min-w-0 md:flex-1 xl:order-2" style={{ background: C.bg }}>
          <canvas
            ref={canvasRef}
            onClick={onClick}
            role="img"
            aria-label={`Track map: every car's place on the circuit, ${focusNum ? `focus car #${carNo(data, focusNum)} highlighted` : ""}. Tap a car to follow it.`}
            className="absolute inset-0 cursor-pointer"
          />
          {!track && (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm" style={{ color: C.muted }}>
              {trackMissing ? "The track map appears once the timing has learned the circuit from a few clean laps." : "Loading the track map…"}
            </p>
          )}
        </div>
        <MapKey
          className="order-2 xl:order-1"
          classes={Object.keys(data.classGroups).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))}
          hidden={hidden}
          onToggle={toggleLayer}
          virtual={!!clock}
          caution={isCaution(flag)}
          leaderNote={leaderInPits ? `overall leader #${carNo(data, leaderInPits)} in the pits` : "overall leader"}
          status={[
            label(unplaced) ? `No position: ${label(unplaced)}` : "",
            label(stopped) ? `Stopped: ${label(stopped)}` : "",
            label(offTrack) ? `Off track: ${label(offTrack)}` : "",
            age !== null && age > OLD_MS ? `Positions ${Math.round(age / 1000)} s old` : "",
          ].filter(Boolean)}
        />
        <PitList data={data} pits={pitVisits} out={out} focusNum={focusNum} setFocusNum={setFocusNum} className="order-3" />
        </div>
        <FollowBar data={data} focusNum={focusNum} followed={followed} out={out} onChange={follow} />
        <RaceControl slug={slug} data={data} focusNum={focusNum} followed={followKeys} />
        </div>
        <RunningOrder
          above={
            <div role="tablist" aria-label="Running order view" className="mb-1.5 flex gap-1 text-xs">
              {(
                [
                  ["timing", "Running Order"],
                  ["live", "Live Crossing Order"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={orderView === v}
                  onClick={() => pickOrderView(v)}
                  className="rounded-md px-2.5 py-1 font-semibold"
                  style={{ background: orderView === v ? "#2a2a48" : "transparent", color: orderView === v ? C.text : C.muted }}
                >
                  {label}
                </button>
              ))}
            </div>
          }
          swap={
            orderView === "live" && track ? (
              (() => {
                const places = [...motions.current.values()].flatMap((m) => {
                  const k = carKey(data, m.num);
                  if (k === null || !data.cars[String(k)] || out.has(k)) return [];
                  return [{ key: k, d: m.shown, inPit: (m.flags & IN_PIT) !== 0 || pitVisits.has(k) }];
                });
                const refM = [...motions.current.values()].find((m) => carKey(data, m.num) === focusNum);
                const speed = refM && refM.base > 0 ? refM.base : typicalSpeed;
                const rows = trackOrder(places, focusNum, track.len, speed);
                return (
                  <LiveTrackOrder
                    data={data}
                    rows={rows}
                    lapsDown={lapped}
                    drivers={drivers}
                    followed={followKeys}
                    refMissing={!refM}
                    onRowTap={(k) => {
                      if (k !== focusNum) follow(toggleFollow(followed, carNo(data, k)));
                    }}
                  />
                );
              })()
            ) : undefined
          }
          data={data}
          focusNum={focusNum}
          setFocusNum={setFocusNum}
          compSet={compSet}
          classView={classView}
          annotations={annotations}
          pits={pitVisits}
          out={out}
          followed={followKeys}
          onRowTap={(k) => {
            if (k !== focusNum) follow(toggleFollow(followed, carNo(data, k)));
          }}
        />
      </div>
    </div>
  );
}

/** The cars in the pit lane after a reading: one already there keeps its visit; one new to it went in after its laps so far. */
export function pitVisitsNow(prev: Map<number, PitVisit>, inPit: string[], data: RaceChartData): Map<number, PitVisit> {
  const out = new Map<number, PitVisit>();
  for (const n of inPit) {
    const key = carKey(data, n);
    if (key === null || !data.cars[String(key)]) continue;
    const laps = data.cars[String(key)].laps;
    out.set(key, prev.get(key) ?? { afterLap: laps.length ? laps[laps.length - 1].l : 0 });
  }
  return out;
}

/** The overall leader now (the timing's running order), if it has one. */
export function overallLeader(data: RaceChartData): number | null {
  for (const [k, c] of Object.entries(data.cars)) if (c.finishPos === 1) return Number(k);
  return null;
}

/**
 * A car on its out-lap: its last completed lap is the one it pitted on (the chart's pit flag sits
 * on the in-lap), and it is out of the pit lane now. Ends when it completes the lap.
 */
export function onOutLap(data: RaceChartData, key: number, inPits: Map<number, PitVisit>): boolean {
  const laps = data.cars[String(key)]?.laps ?? [];
  return laps.length > 0 && laps[laps.length - 1].pit === 1 && !inPits.has(key);
}

/** What the map leaves out (the key's chips), kept on this device. */
const HIDDEN_KEY = "rt.live.mapHidden";
function readHiddenLayers(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function saveHiddenLayers(s: Set<string>) {
  try {
    if (s.size) localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]));
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    /* private window: for this visit only */
  }
}

/**
 * The map's key, under the map: a chip for each class and each marker, like the compare chips.
 * Tapping one hides it on the map (the chip dims) or shows it again. A class's cars, lapped cars and
 * cars with a faint signal are left off the map (the focus car and followed cars always stay); the
 * P1 tag, the virtual cars, the out-lap rings and the safety car are left off. Then what the map
 * cannot place right now (no position, stopped, off track).
 */
function MapKey({
  className = "",
  classes,
  hidden,
  onToggle,
  virtual,
  caution,
  leaderNote,
  status,
}: {
  className?: string;
  classes: string[];
  hidden: Set<string>;
  onToggle: (k: string) => void;
  virtual: boolean;
  caution: boolean;
  leaderNote: string;
  status: string[];
}) {
  const chip = (k: string, swatch: React.ReactNode, text: string, title?: string) => {
    const off = hidden.has(k);
    return (
      <button
        key={k}
        type="button"
        aria-pressed={!off}
        onClick={() => onToggle(k)}
        title={`${title ? `${title} ` : ""}${off ? "Hidden: tap to show it on the map." : "Tap to hide it on the map."}`}
        className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 hover:bg-white/5"
        style={{ borderColor: off ? "#2a2a48" : "#3a3a5c", color: off ? "#5c5c78" : C.text, textDecoration: off ? "line-through" : undefined }}
      >
        <span className="flex items-center" style={{ opacity: off ? 0.35 : 1 }}>
          {swatch}
        </span>
        {text}
      </button>
    );
  };
  const dot = (bg: string, extra = "") => <span className={`inline-block h-2.5 w-2.5 rounded-full ${extra}`} style={{ background: bg }} />;
  return (
    <div
      className={`custom-scroll flex flex-wrap items-center gap-1.5 border-t px-3 py-2 text-xs sm:px-6 xl:w-44 xl:shrink-0 xl:flex-col xl:flex-nowrap xl:items-stretch xl:overflow-y-auto xl:border-r xl:border-t-0 xl:px-2 ${className}`}
      style={{ borderColor: "#1e1e38", color: C.muted }}
    >
      {classes.map((cls) => chip(`cls:${cls}`, dot(liveClassColor(cls)), cls, `${cls} cars.`))}
      {chip(
        "leader",
        <span className="rounded-full border-[1.5px] bg-white px-1.5 text-[9.5px] font-extrabold leading-[13px]" style={{ borderColor: C.leader, color: C.bg }}>
          P1
        </span>,
        leaderNote,
        "The overall leader's tag."
      )}
      {virtual &&
        chip(
          "virtual",
          <span className="inline-block h-2.5 w-2.5 rotate-45 border-2 border-dashed" style={{ borderColor: C.muted }} />,
          "virtual car",
          "Each class's virtual car laps at its class leader's average over its last 3 laps and crosses the line exactly as the clock runs out: a leader ahead of it on the road has one more lap to run."
        )}
      {chip("lapped", <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ borderColor: C.muted, background: "rgba(154,154,180,0.3)" }} />, "lapped", "A lap or more down on its class leader (the LD column).")}
      {chip("outLap", <span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: C.outLap }} />, "out-lap", "Back on track from a pit stop, on the lap it rejoined.")}
      {chip("faint", <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ borderColor: C.muted }} />, "faint signal", "No fresh position from the car.")}
      {caution &&
        chip(
          "sc",
          <span className="rounded px-1 text-[10px] font-bold" style={{ background: "#fab219", color: "#0b0b18" }}>
            SC
          </span>,
          "safety car"
        )}
      {status.map((t) => (
        <span key={t} className="ml-1 xl:ml-0 xl:mt-1">
          {t}
        </span>
      ))}
    </div>
  );
}

/** The view beside the map, kept on this device. */
const ORDER_VIEW_KEY = "rt.live.orderView";

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

/** Under the map: the cars followed (tap × to stop following one), or how to follow one. */
function FollowBar({
  data,
  focusNum,
  followed,
  out,
  onChange,
}: {
  data: RaceChartData;
  focusNum: number;
  followed: string[];
  out: Set<number>;
  onChange: (cars: string[]) => void;
}) {
  const cars = followed.filter((n) => {
    const k = carKey(data, n);
    return k !== null && !!data.cars[String(k)] && k !== focusNum;
  });
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2 text-xs sm:px-6" style={{ borderColor: "#1e1e38", color: C.muted }}>
      <span className="mr-1 font-semibold" style={{ color: C.text }}>
        Following
      </span>
      {focusNum > 0 && (
        <span className="rounded-full border-2 px-2 py-0.5 font-bold tabular-nums" style={{ borderColor: TRACE.focus, color: C.text }} title="The focus car (change it with Focus)">
          #{carNo(data, focusNum)}
        </span>
      )}
      {cars.map((n) => {
        const k = carKey(data, n)!;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(followed.filter((c) => c !== n))}
            className="flex items-center gap-1 rounded-full border-2 border-white px-2 py-0.5 font-bold tabular-nums hover:bg-white/10"
            style={{ color: out.has(k) ? C.muted : C.text, background: `${liveClassColor(data.cars[String(k)]?.cls)}33` }}
            aria-label={`Stop following #${n}`}
          >
            #{n} <span aria-hidden>×</span>
          </button>
        );
      })}
      {cars.length > 0 ? (
        <button type="button" onClick={() => onChange([])} className="ml-1 underline hover:text-white">
          Clear
        </button>
      ) : (
        <span>Tap cars on the map or in the table to follow them.</span>
      )}
    </div>
  );
}

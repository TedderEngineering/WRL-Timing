import { useEffect, useMemo, useRef, useState } from "react";
import type { RaceChartData } from "@shared/types";
import { getPublic } from "../../hooks/useLiveChartData";
import { carKey, carNo } from "./car-number";
import { getCompColor } from "./chart-renderer";
import { TRACE } from "./constants";
import { IN_PIT, NO_GPS, STALE, pointAt, step, takeReading, type CarMotion, type CarPlace } from "./track-motion";

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

const C = { bg: "#0b0b18", track: "#23233f", trackIn: "#2e2e54", line: "#e0e0e8", muted: "#9a9ab4", dim: "#6b6b88", text: "#e0e0e8" };

/**
 * RaceTrace Live: the circuit with every car as a numbered dot moving round it ("marching ants").
 * The focus car is the biggest and brightest, compare cars are in their trace colours, the rest
 * small and dim; another class is dimmer still. Cars in the pit lane are listed beside the map.
 * Tapping a dot makes it the focus car.
 */
export function TrackMap({
  slug,
  data,
  focusNum,
  setFocusNum,
  compSet,
  classView,
  flag = null,
}: {
  slug: string;
  data: RaceChartData;
  focusNum: number;
  setFocusNum: (n: number) => void;
  compSet: Set<number>;
  classView: string;
  /** The session's flag now ("Yellow", "Code 35"…): under a caution the safety car is shown. */
  flag?: string | null;
}) {
  const [track, setTrack] = useState<TrackOutline | null>(null);
  const [trackMissing, setTrackMissing] = useState(false);
  const [readingAt, setReadingAt] = useState<number | null>(null);
  const [pits, setPits] = useState<string[]>([]);
  const [unplaced, setUnplaced] = useState<string[]>([]);
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
          motions.current = takeReading(motions.current, onTrack, t, age, track.len, typicalSpeed);
          setReadingAt(t - age);
          setPits(body.cars.filter((c) => c[3] & IN_PIT).map((c) => c[0]));
          setUnplaced(body.cars.filter((c) => !(c[3] & IN_PIT) && c[1] === null).map((c) => c[0]));
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

    // The cars: the rest, then compare cars, then the focus car on top.
    const t = Date.now();
    step(motions.current, t, Math.min(100, t - lastFrame.current), track.len);
    lastFrame.current = t;
    const inClass = classView ? new Set(data.classGroups[classView] ?? []) : null;
    const dots = [...motions.current.values()]
      .map((m) => {
        const key = carKey(data, m.num);
        if (key === null || !data.cars[String(key)]) return null;
        const focus = key === focusNum;
        const compared = !focus && compSet.has(key);
        const other = inClass !== null && !inClass.has(key) && !focus;
        return { m, key, focus, compared, other, rank: focus ? 2 : compared ? 1 : 0 };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.rank - b.rank || (b.other ? 1 : 0) - (a.other ? 1 : 0));
    const many = compSet.size > 8;
    hits.current = [];
    for (const d of dots) {
      const [x, y] = px(pointAt(track.pts, track.ds, track.len, d.m.shown));
      const r = d.focus ? 12 : d.compared ? (many ? 8 : 9) : 5;
      const color = d.focus ? TRACE.focus : d.compared ? getCompColor(compSet, focusNum, d.key) : C.dim;
      const hollow = (d.m.flags & (NO_GPS | STALE)) !== 0;
      ctx.globalAlpha = d.other ? 0.3 : d.compared || d.focus ? 1 : 0.7;
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
      if (d.focus || d.compared) {
        const label = carNo(data, d.key);
        ctx.fillStyle = hollow ? color : d.focus ? "#0b0b18" : "#ffffff";
        ctx.font = `${d.focus ? 700 : 600} ${label.length > 2 ? (d.focus ? 9 : 7) : d.focus ? 11 : 8.5}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x, y + 0.5);
      }
      ctx.globalAlpha = 1;
      hits.current.push({ key: d.key, x, y, r: Math.max(r, 10) });
    }

    // The safety car under a caution: where the timing places it when it sends one; otherwise an
    // estimate just ahead of the overall leader, drawn dashed (the timing does not track it).
    const sc = safetyCarAt(motions.current, data, flag, track.len);
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
  const scEstimated = !findSafetyCar(motions.current);
  const label = (nums: string[]) =>
    nums
      .map((n) => carKey(data, n))
      .filter((k): k is number => k !== null && !!data.cars[String(k)])
      .map((k) => `#${carNo(data, k)}`)
      .join(", ");

  return (
    <div className="flex flex-col md:min-h-0 md:flex-1">
      <div ref={wrapRef} className="relative h-[80vw] max-h-[560px] min-h-[300px] md:h-auto md:max-h-none md:min-h-0 md:flex-1" style={{ background: C.bg }}>
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-xs sm:px-6" style={{ borderColor: "#1e1e38", color: C.muted }}>
        {pits.length > 0 && (
          <span>
            <span style={{ color: C.text }}>In the pits:</span> {label(pits)}
          </span>
        )}
        {unplaced.length > 0 && <span>No position: {label(unplaced)}</span>}
        <span>
          {age === null ? "Waiting for positions…" : age > OLD_MS ? `Positions ${Math.round(age / 1000)} s old` : "Positions every 5 s; cars move at their own pace in between"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ borderColor: C.muted }} /> faint signal
        </span>
        {isCaution(flag) && (
          <span className="flex items-center gap-1.5" style={{ color: "#fab219" }}>
            <span className="rounded px-1 text-[10px] font-bold" style={{ background: "#fab219", color: "#0b0b18" }}>
              SC
            </span>
            {scEstimated ? "safety car, estimated just ahead of the leader (the timing does not track it)" : "safety car"}
          </span>
        )}
      </div>
    </div>
  );
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

/** How far ahead of the leader the safety car is drawn when it has to be estimated (m). */
export const SC_AHEAD_M = 120;

/**
 * Where to draw the safety car: under a caution only; the timing's own placement when it sends the
 * car, else just ahead of the overall leader (the safety car picks up the leader), marked estimated.
 */
export function safetyCarAt(
  motions: Map<string, CarMotion>,
  data: RaceChartData,
  flag: string | null | undefined,
  len: number
): { d: number; estimated: boolean } | null {
  if (!isCaution(flag)) return null;
  const own = findSafetyCar(motions);
  if (own) return { d: own.shown, estimated: false };
  const leader = Object.entries(data.cars).find(([, c]) => c.finishPos === 1)?.[0];
  if (!leader) return null;
  const label = carNo(data, Number(leader));
  const m = motions.get(label) ?? motions.get(leader);
  if (!m || m.flags & IN_PIT) return null;
  return { d: (m.shown + SC_AHEAD_M) % len, estimated: true };
}

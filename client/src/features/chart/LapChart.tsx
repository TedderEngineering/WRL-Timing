import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useLapZoomOnGrow } from "./live-zoom";
import { LiveGapsPanel } from "./LiveGapsPanel";
import { hasFullAccess } from "../../lib/utils";
import type {
  RaceChartData,
  AnnotationData,
} from "@shared/types";
import {
  drawChart,
  buildLapInfo,
  computeDimensions,
  lapOfX,
  type ChartState,
  type ChartDimensions,
  type LapInfoData,
} from "./chart-renderer";
import { LapDetailsPanel } from "./LapDetailsPanel";
import { LapScrubber } from "./LapScrubber";
import { AxisToggle, TraceControls } from "./TraceControls";
import type { TraceView } from "./trace-view";
import { PitCyclePanel } from "./PitCyclePanel";
import { GapEvolutionPanel } from "./GapEvolutionPanel";
import { HeadToHeadPanel } from "./HeadToHeadPanel";
import { PassEventPanel } from "./PassEventPanel";
import { CHART_STYLE, TRACE } from "./constants";
import { useAuth } from "../../features/auth/AuthContext";
import { hasTeamAccess } from "../../lib/utils";
import { carNo } from "./car-number";

// ─── Props ───────────────────────────────────────────────────────────────────

interface LapChartProps {
  data: RaceChartData;
  annotations: AnnotationData;
  watermarkEmail?: string;
  focusNum: number;
  setFocusNum: React.Dispatch<React.SetStateAction<number>>;
  compSet: Set<number>;
  setCompSet: React.Dispatch<React.SetStateAction<Set<number>>>;
  classView: string;
  setClassView: React.Dispatch<React.SetStateAction<string>>;
  activeLap: number | null;
  setActiveLap: React.Dispatch<React.SetStateAction<number | null>>;
  /** Class, makes and compare, shared with Lap Times (held by the race page). */
  view: TraceView;
  /** The bottom axis to start with (the user's chart defaults). */
  defaultAxis?: "laps" | "hours" | "both";
  /** RaceTrace Live: laps keep arriving (zoom follows the latest lap). */
  live?: boolean;
}

/** RaceTrace Live: a lap the viewer picked stays selected this long, then the latest lap returns. */
export const FOLLOW_AFTER_MS = 60_000;

// ─── Component ───────────────────────────────────────────────────────────────

export function LapChart({
  data, annotations, watermarkEmail,
  focusNum, setFocusNum, compSet,
  classView, activeLap, setActiveLap, view, defaultAxis, live = false,
}: LapChartProps) {
  const { user } = useAuth();
  const isPaid = hasFullAccess(user);
  const isTeam = hasTeamAccess(user);
  const [teamNote, setTeamNote] = useState(false);
  const { fieldCars } = view;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // ── Internal-only state ────────────────────────────────────────
  const [dim, setDim] = useState<ChartDimensions | null>(null);
  const [info, setInfo] = useState<LapInfoData | null>(null);
  const [xAxisMode, setXAxisMode] = useState<"laps" | "hours" | "both">(defaultAxis ?? "laps");
  // The user's default, also when it arrives after the chart opened (first visit on this device).
  useEffect(() => {
    if (defaultAxis) setXAxisMode(defaultAxis);
  }, [defaultAxis]);
  const [sidePanel, setSidePanel] = useState<string | null>(null);
  /** RaceTrace Live: the side panel's tab (the focus car's lap details, or the Gaps table). */
  const [liveTab, setLiveTab] = useState<"details" | "gaps">("details");
  const h2hDefaultCarRef = useRef<number | undefined>(undefined);

  // ── Zoom state ─────────────────────────────────────────────────
  const [lapStart, setLapStart] = useState(1);
  const [lapEnd, setLapEnd] = useState(data.maxLap);
  const [selectionRange, setSelectionRange] = useState<[number, number] | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const isZoomed = lapStart > 1 || lapEnd < data.maxLap;

  const activeLapRef = useRef(activeLap);
  activeLapRef.current = activeLap;
  const lapStartRef = useRef(lapStart);
  lapStartRef.current = lapStart;
  const lapEndRef = useRef(lapEnd);
  lapEndRef.current = lapEnd;
  const dimRef = useRef(dim);
  dimRef.current = dim;
  const maxLapRef = useRef(data.maxLap);
  maxLapRef.current = data.maxLap;

  // Reset zoom when race data changes; a live race keeps the viewer's zoom as laps arrive.
  useLapZoomOnGrow(data.maxLap, lapStart, lapEnd, setLapStart, setLapEnd, live);

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;

  const panState = useRef({ panning: false, startX: 0, startLapStart: 1, startLapEnd: 1 });
  const rangeSelectStart = useRef<number | null>(null);

  // ── Chart state object for renderer ─────────────────────────────
  const chartState = useMemo<ChartState>(
    () => ({ focusNum, compSet, activeLap, classView, showWatermark: !isPaid, xAxisMode, lapStart, lapEnd, selectionRange, fieldCars }),
    [focusNum, compSet, activeLap, classView, isPaid, xAxisMode, lapStart, lapEnd, selectionRange, fieldCars]
  );

  // ── Lap elapsed hours for time axis ────────────────────────────
  // Note: computeLapElapsedHours is called inside drawChart directly

  // ── Resize & draw ──────────────────────────────────────────────
  const resize = useCallback(() => {
    if (!wrapperRef.current) return;
    const containerW = wrapperRef.current.clientWidth;
    const containerH = wrapperRef.current.clientHeight;
    const newDim = computeDimensions(containerW, containerH, isMobile, xAxisMode, undefined, { pitTags: true });
    setDim(newDim);
    return newDim;
  }, [isMobile, xAxisMode]);

  // Draw whenever state or dimensions change
  useEffect(() => {
    const canvas = canvasRef.current;
    const d = dim || resize();
    if (!canvas || !d) return;
    drawChart(canvas, data, annotations, chartState, d, watermarkEmail);
  }, [data, annotations, chartState, dim, resize, watermarkEmail]);

  // Resize on window resize AND container reflow (e.g. side panel open/close)
  useEffect(() => {
    const onResize = () => {
      const d = resize();
      if (d) setDim(d);
    };
    window.addEventListener("resize", onResize);
    onResize();

    const wrapper = wrapperRef.current;
    let ro: ResizeObserver | undefined;
    if (wrapper) {
      ro = new ResizeObserver(onResize);
      ro.observe(wrapper);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [resize]);

  // ── Coordinate helpers ──────────────────────────────────────────
  const getCanvasX = useCallback(
    (clientX: number): number => {
      if (!wrapperRef.current) return 0;
      const r = wrapperRef.current.getBoundingClientRect();
      return clientX - r.left;
    },
    []
  );

  // ── Interaction: show info for a lap ────────────────────────────
  /** RaceTrace Live: when the viewer last picked a lap (null = following the latest lap). */
  const pickedAt = useRef<number | null>(null);
  const showLapInfo = useCallback(
    (lapNum: number, auto = false) => {
      const laps = data.cars[String(focusNum)]?.laps || [];
      const valid = laps.map((l) => l.l);
      if (!valid.length) return;
      if (!auto) pickedAt.current = Date.now();
      lapNum = Math.max(valid[0], Math.min(valid[valid.length - 1], lapNum));
      setActiveLap(lapNum);

      // Pace in the details panel is against the field in view, not just the compare cars.
      const infoData = buildLapInfo(data, annotations, { ...chartState, compSet: new Set(fieldCars) }, lapNum);
      setInfo(infoData);
    },
    [data, annotations, chartState, focusNum, setActiveLap, fieldCars]
  );

  // ── Auto-pan when active lap leaves visible range ──────────────
  const autoPan = useCallback(
    (lapNum: number) => {
      const ls = lapStartRef.current;
      const le = lapEndRef.current;
      const range = le - ls;
      const margin = range * 0.1;
      if (lapNum < ls + margin) {
        const newStart = Math.max(1, lapNum - margin);
        setLapStart(newStart);
        setLapEnd(newStart + range);
      } else if (lapNum > le - margin) {
        const newEnd = Math.min(data.maxLap, lapNum + margin);
        setLapEnd(newEnd);
        setLapStart(newEnd - range);
      }
    },
    [data.maxLap]
  );

  // ── Wheel zoom handler (imperative for passive:false) ──────────
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const d = dimRef.current;
      if (!d) return;
      const cx = e.clientX - wrapper.getBoundingClientRect().left;
      const ls = lapStartRef.current;
      const le = lapEndRef.current;
      const ml = maxLapRef.current;

      // Lap under cursor
      const cursorLap = lapOfX(cx, ls, le, d);

      // Zoom factor
      const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      const range = le - ls;
      let newRange = range * factor;

      // Clamp: min 5 laps visible, max full race
      newRange = Math.max(5, Math.min(ml - 1, newRange));

      // Preserve fraction under cursor
      const frac = (cursorLap - ls) / range;
      let newStart = cursorLap - frac * newRange;
      let newEnd = newStart + newRange;

      // Clamp to [1, maxLap]
      if (newStart < 1) { newStart = 1; newEnd = 1 + newRange; }
      if (newEnd > ml) { newEnd = ml; newStart = ml - newRange; }
      newStart = Math.max(1, newStart);

      setLapStart(newStart);
      setLapEnd(newEnd);
    };
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Data-space pan (mouse) ─────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // If in range-select mode (after dblclick), don't start pan
    if (rangeSelectStart.current !== null) return;
    panState.current = {
      panning: true,
      startX: e.clientX,
      startLapStart: lapStartRef.current,
      startLapEnd: lapEndRef.current,
    };
    setIsPanning(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Range selection mode
      if (rangeSelectStart.current !== null && dim && wrapperRef.current) {
        const cx = e.clientX - wrapperRef.current.getBoundingClientRect().left;
        const lap = lapOfX(cx, lapStartRef.current, lapEndRef.current, dim);
        setSelectionRange([rangeSelectStart.current, lap]);
        return;
      }

      if (!panState.current.panning || !dim) return;
      const dx = e.clientX - panState.current.startX;
      const { startLapStart, startLapEnd } = panState.current;
      const range = startLapEnd - startLapStart;
      const lapDelta = -(dx / dim.CW) * range;

      let newStart = startLapStart + lapDelta;
      let newEnd = startLapEnd + lapDelta;

      // Clamp to [1, maxLap]
      if (newStart < 1) { newStart = 1; newEnd = 1 + range; }
      if (newEnd > data.maxLap) { newEnd = data.maxLap; newStart = data.maxLap - range; }

      setLapStart(newStart);
      setLapEnd(newEnd);
    };

    const onUp = (e: MouseEvent) => {
      // Range selection finalize
      if (rangeSelectStart.current !== null && dim && wrapperRef.current) {
        const cx = e.clientX - wrapperRef.current.getBoundingClientRect().left;
        const endLap = lapOfX(cx, lapStartRef.current, lapEndRef.current, dim);
        const startLap = rangeSelectStart.current;
        const lo = Math.min(startLap, endLap);
        const hi = Math.max(startLap, endLap);

        rangeSelectStart.current = null;
        setSelectionRange(null);

        if (hi - lo >= 3) {
          setLapStart(Math.max(1, lo));
          setLapEnd(Math.min(data.maxLap, hi));
        }
        return;
      }

      if (!panState.current.panning) return;
      const dx = Math.abs(e.clientX - panState.current.startX);
      panState.current.panning = false;
      setIsPanning(false);

      // If barely moved, treat as click → select lap
      if (dx < 4 && wrapperRef.current && dim) {
        const r = wrapperRef.current.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const lap = Math.round(lapOfX(cx, lapStartRef.current, lapEndRef.current, dim));
        const clamped = Math.max(1, Math.min(data.maxLap, lap));
        showLapInfo(clamped);
      }
      // Transfer focus to chart so arrow keys advance laps instead of dropdown
      wrapperRef.current?.focus();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dim, data.maxLap, showLapInfo]);

  // ── Mouse move (hover) ─────────────────────────────────────────
  // Hover does not select a lap — click only (handled by mouseup in onMouseDown)
  const onMouseMove = useCallback((_e: React.MouseEvent) => {}, []);

  // ── Double-click range zoom ────────────────────────────────────
  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!dim) return;
      const cx = getCanvasX(e.clientX);
      const lap = lapOfX(cx, lapStart, lapEnd, dim);
      rangeSelectStart.current = lap;
      setSelectionRange([lap, lap]);
      e.preventDefault();
    },
    [dim, getCanvasX, lapStart, lapEnd]
  );

  // ── Escape: cancel range selection ─────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && rangeSelectStart.current !== null) {
        rangeSelectStart.current = null;
        setSelectionRange(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ── Touch: panning + lap selection ─────────────────────────────
  const touchState = useRef({ startX: 0, startLapStart: 1, startLapEnd: 1, moved: false });

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      touchState.current = {
        startX: e.touches[0].clientX,
        startLapStart: lapStartRef.current,
        startLapEnd: lapEndRef.current,
        moved: false,
      };
    },
    []
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!e.touches.length || !dim) return;
      const tx = e.touches[0].clientX;
      const dx = tx - touchState.current.startX;
      touchState.current.moved = true;

      const { startLapStart, startLapEnd } = touchState.current;
      const range = startLapEnd - startLapStart;
      const lapDelta = -(dx / dim.CW) * range;

      let newStart = startLapStart + lapDelta;
      let newEnd = startLapEnd + lapDelta;
      if (newStart < 1) { newStart = 1; newEnd = 1 + range; }
      if (newEnd > data.maxLap) { newEnd = data.maxLap; newStart = data.maxLap - range; }

      setLapStart(newStart);
      setLapEnd(newEnd);

      // Also show lap info at touch position
      const cx = getCanvasX(tx);
      const lap = Math.round(lapOfX(cx, newStart, newEnd, dim));
      showLapInfo(Math.max(1, Math.min(data.maxLap, lap)));
    },
    [dim, getCanvasX, data.maxLap, showLapInfo]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchState.current.moved && dim) {
        const ct = e.changedTouches[0];
        const cx = getCanvasX(ct.clientX);
        const lap = Math.round(lapOfX(cx, lapStartRef.current, lapEndRef.current, dim));
        showLapInfo(Math.max(1, Math.min(data.maxLap, lap)));
      }
    },
    [dim, getCanvasX, data.maxLap, showLapInfo]
  );

  // ── Keyboard navigation ─────────────────────────────────────────
  const navPrev = useCallback(() => {
    const laps = data.cars[String(focusNum)]?.laps || [];
    const valid = laps.map((l) => l.l);
    if (!valid.length) return;
    const cur = activeLapRef.current;
    if (cur === null) {
      showLapInfo(valid[0]);
    } else {
      const idx = valid.indexOf(cur);
      if (idx > 0) {
        const newLap = valid[idx - 1];
        showLapInfo(newLap);
        autoPan(newLap);
      }
    }
  }, [data, focusNum, showLapInfo, autoPan]);

  const navNext = useCallback(() => {
    const laps = data.cars[String(focusNum)]?.laps || [];
    const valid = laps.map((l) => l.l);
    if (!valid.length) return;
    const cur = activeLapRef.current;
    if (cur === null) {
      showLapInfo(valid[0]);
    } else {
      const idx = valid.indexOf(cur);
      if (idx < valid.length - 1) {
        const newLap = valid[idx + 1];
        showLapInfo(newLap);
        autoPan(newLap);
      }
    }
  }, [data, focusNum, showLapInfo, autoPan]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navNext();
      } else if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        setLapStart(1);
        setLapEnd(data.maxLap);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navPrev, navNext, data.maxLap]);

  // Clear info panel when focus car or class filter changes externally
  useEffect(() => { setInfo(null); }, [focusNum, classView]);

  // ── RaceTrace Live: follow the latest lap ──────────────────────
  // The focus car's latest lap is selected as laps arrive, unless the viewer picked a lap less
  // than FOLLOW_AFTER_MS ago or has a detail panel open; then it returns to the latest lap.
  const focusLaps = data.cars[String(focusNum)]?.laps;
  const latestLap = focusLaps && focusLaps.length ? focusLaps[focusLaps.length - 1].l : null;
  /** What the follow last selected (so a once-a-second check does nothing when nothing changed). */
  const followed = useRef<{ data: unknown; focusNum: number; lap: number } | null>(null);
  const [followTick, setFollowTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setFollowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  const pickedLap = live && pickedAt.current !== null && latestLap !== null && activeLap !== null && activeLap !== latestLap;
  const followIn = pickedLap ? Math.max(0, Math.ceil((pickedAt.current! + FOLLOW_AFTER_MS - Date.now()) / 1000)) : 0;
  useEffect(() => {
    if (!live || latestLap === null || sidePanel) return;
    if (pickedAt.current !== null) {
      if (Date.now() - pickedAt.current < FOLLOW_AFTER_MS) return;
      pickedAt.current = null;
      followed.current = null;
    }
    const f = followed.current;
    if (f && f.data === data && f.focusNum === focusNum && f.lap === latestLap) return;
    followed.current = { data, focusNum, lap: latestLap };
    showLapInfo(latestLap, true);
    // followTick re-checks each second, so a picked lap times out without waiting for a new lap.
  }, [live, latestLap, data, focusNum, sidePanel, followTick, showLapInfo]);
  const backToLatest = () => {
    pickedAt.current = null;
    followed.current = null;
    if (latestLap !== null) showLapInfo(latestLap, true);
  };

  // Close side panel when active lap changes — gap and h2h persist
  useEffect(() => {
    setSidePanel((prev) => {
      if (prev === "gap" || prev === "h2h") return prev;
      h2hDefaultCarRef.current = undefined;
      return null;
    });
  }, [activeLap]);

  // Cursor style
  const cursorStyle = rangeSelectStart.current !== null
    ? "crosshair"
    : isPanning
    ? "grabbing"
    : isZoomed
    ? "grab"
    : "default";

  // ─── RENDER ────────────────────────────────────────────────────────────────

  const openPanel = (panel: "pit" | "gap" | "h2h" | "event") => {
    if (!isTeam) {
      setTeamNote(true);
      return;
    }
    h2hDefaultCarRef.current = undefined;
    setSidePanel(panel);
  };
  const panelTitle: Record<string, string> = { pit: "Pit cycle", gap: "Gap evolution", h2h: "Head-to-head", event: "Position change" };
  const focusCar = data.cars[String(focusNum)];
  const viewLabel = classView ? `Class position (${classView}) · ${fieldCars.length} cars` : `Overall position · ${fieldCars.length} cars`;
  const lapFlag = info?.lap ? (info.lap.flag === "FCY" ? "FCY" : "Green") : null;
  // Under the chart on a phone; at the foot of the side panel from md up, so the trace keeps the height.
  const legend = (
    <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs" style={{ color: "#cbd5e1" }}>
      <li className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-[18px]" style={{ background: TRACE.focus }} />Focus car #{carNo(data, focusNum)}</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-[2px] w-[18px]" style={{ background: "#3987e5" }} />Compare cars</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-px w-[18px]" style={{ background: "rgba(224,224,232,0.5)" }} />Other cars{classView ? ` in ${classView}` : ""}</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5" style={{ background: "rgba(251,191,36,0.3)", borderTop: "2px solid #fbbf24" }} />Full Course Yellow (FCY)</li>
      <li>● Pit stop</li>
      <li><span style={{ color: TRACE.garage }}>●</span> Garage</li>
      <li>▲ Drive-through</li>
      <li><span style={{ color: TRACE.penalty }}>◆</span> Penalty</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-px" style={{ background: TRACE.fcyBar }} />Pit stop · driver out</li>
      <li><span style={{ color: TRACE.gain }}>↑</span> Settled: where the pit cycle left the car, gained or lost against where it ran before the cycle</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-px bg-white" />Selected lap</li>
      <li style={{ color: TRACE.axis }} title={`Lap time under ${data.greenPaceCutoff.toFixed(1)} s; no FCY laps.`}>Pace: green-flag laps only</li>
    </ul>
  );

  return (
    // From md up the trace fills the space it is given; only the side panel scrolls (invisibly).
    <div className="flex flex-col md:h-full md:min-h-0" style={{ background: CHART_STYLE.bg, color: CHART_STYLE.text }}>
      <TraceControls
        data={data}
        focusNum={focusNum}
        onFocus={(n) => setFocusNum(n)}
        classView={classView}
        compSet={compSet}
        view={view}
        xAxisMode={xAxisMode}
        setXAxisMode={setXAxisMode}
      />

      <div className="flex flex-col md:min-h-0 md:flex-1 md:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-2 py-2 sm:px-6 sm:py-3 md:min-h-0">
          <figure className="m-0 flex flex-col rounded-lg border p-2 sm:p-3 md:min-h-0 md:flex-1" style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border }}>
            <div
              ref={wrapperRef}
              tabIndex={0}
              aria-label={`Position trace for car ${focusNum}${focusCar ? `, ${focusCar.team}` : ""}. Click a lap for details; arrow keys step laps.`}
              className="relative h-[384px] overflow-hidden outline-none md:h-auto md:min-h-[220px] md:flex-1"
            >
              <canvas
                ref={canvasRef}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onDoubleClick={onDoubleClick}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                onContextMenu={(e) => e.preventDefault()}
                style={{ display: "block", cursor: cursorStyle }}
              />
            </div>
            <figcaption className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-1 pt-1.5 text-xs" style={{ color: TRACE.axis }}>
              <span className="flex items-center gap-3">
                {!isMobile && <AxisToggle small value={xAxisMode} onChange={setXAxisMode} />}
                {viewLabel}
              </span>
              <span>
                {isZoomed ? (
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => { setLapStart(1); setLapEnd(data.maxLap); }}>
                    Laps {Math.round(lapStart)}–{Math.round(lapEnd)} of {data.maxLap} · show all (W)
                  </button>
                ) : (
                  isMobile ? "Tap a lap for details · swipe to move along the race" : "Scroll to zoom · drag to pan · double-click and drag to zoom to a stretch"
                )}
              </span>
            </figcaption>
          </figure>

          <LapScrubber
            maxLap={data.maxLap}
            fcy={data.fcy || []}
            activeLap={activeLap}
            flagLabel={lapFlag}
            onLap={(l) => { showLapInfo(l); autoPan(l); }}
            navPrev={navPrev}
            navNext={navNext}
          />

          <div className="md:hidden">{legend}</div>
        </div>

        <aside
          aria-label={sidePanel ? panelTitle[sidePanel] : "Lap details"}
          className="flex flex-col border-t md:min-h-0 md:w-[360px] md:shrink-0 md:overflow-hidden md:border-l md:border-t-0 lg:w-[400px]"
          style={{ borderColor: CHART_STYLE.border, background: "#0e0e20" }}
        >
          {sidePanel ? (
            <div className="flex h-[70vh] flex-col md:h-auto md:min-h-0 md:flex-1">
              <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
                <span className="font-semibold">{panelTitle[sidePanel]}</span>
                <button type="button" onClick={() => setSidePanel(null)} className="min-h-[36px] text-[13px]" style={{ color: TRACE.focus }}>
                  ‹ Lap details
                </button>
              </div>
              {/* Each panel scrolls its own list, without a visible scrollbar */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ background: CHART_STYLE.card }}>
                {sidePanel === "pit" && activeLap !== null && (
                  <PitCyclePanel data={data} annotations={annotations} focusNum={focusNum} activeLap={activeLap} />
                )}
                {sidePanel === "gap" && activeLap !== null && (
                  <GapEvolutionPanel data={data} focusNum={focusNum} activeLap={activeLap} compSet={compSet} />
                )}
                {sidePanel === "h2h" && activeLap !== null && (
                  <HeadToHeadPanel data={data} focusNum={focusNum} activeLap={activeLap} defaultCompareNum={h2hDefaultCarRef.current} annotations={annotations} />
                )}
                {sidePanel === "event" && info && (
                  <PassEventPanel
                    reason={info.reason || ""}
                    posDelta={info.posDelta}
                    focusNum={focusNum}
                    isPit={info.isPit}
                    data={data}
                    annotations={annotations}
                    activeLap={activeLap}
                    onOpenH2H={(carNum) => {
                      h2hDefaultCarRef.current = carNum;
                      setSidePanel("h2h");
                    }}
                    onAddToCompare={view.addComp}
                  />
                )}
              </div>
            </div>
          ) : (
            <>
            {live && (
              <div role="tablist" aria-label="Side panel" className="flex shrink-0 gap-1 border-b px-2" style={{ borderColor: CHART_STYLE.border }}>
                {(["details", "gaps"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={liveTab === t}
                    onClick={() => setLiveTab(t)}
                    className="px-3 py-2 text-[13px]"
                    style={{ color: liveTab === t ? "#e0e0e8" : TRACE.axis, fontWeight: liveTab === t ? 600 : 400, borderBottom: `2px solid ${liveTab === t ? TRACE.focus : "transparent"}`, marginBottom: -1 }}
                  >
                    {t === "details" ? "Lap details" : "Gaps"}
                  </button>
                ))}
              </div>
            )}
            {pickedLap && (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-1.5 text-[12px]" style={{ borderColor: CHART_STYLE.border, color: TRACE.axis }}>
                <span>
                  Lap {activeLap} · back to the latest lap in {followIn} s
                </span>
                <button type="button" onClick={backToLatest} className="min-h-[28px] rounded border px-2" style={{ borderColor: CHART_STYLE.border, color: TRACE.focus }}>
                  Latest lap ›
                </button>
              </div>
            )}
            {live && liveTab === "gaps" ? (
              <LiveGapsPanel data={data} focusNum={focusNum} compSet={compSet} fieldCars={view.fieldCars} />
            ) : (
            <div className="no-scrollbar flex flex-col gap-3 p-4 md:min-h-0 md:flex-1 md:overflow-y-auto">
              {teamNote && (
                <div className="rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: CHART_STYLE.border, color: TRACE.axis }}>
                  These panels are part of the Team plan.
                </div>
              )}
              <LapDetailsPanel data={data} annotations={annotations} info={info} focusNum={focusNum} classView={classView} onOpen={openPanel} />
              <div className="mt-auto hidden border-t pt-3 md:block" style={{ borderColor: CHART_STYLE.border }}>{legend}</div>
            </div>
            )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}


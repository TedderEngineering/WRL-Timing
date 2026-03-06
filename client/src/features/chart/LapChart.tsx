import { useRef, useState, useEffect, useCallback, useMemo } from "react";
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
  getVisibleCars,
  getCompColor,
  type ChartState,
  type ChartDimensions,
  type LapInfoData,
} from "./chart-renderer";
import { DataPanel } from "./DataPanel";
import { PitCyclePanel } from "./PitCyclePanel";
import { GapEvolutionPanel } from "./GapEvolutionPanel";
import { HeadToHeadPanel } from "./HeadToHeadPanel";
import { PassEventPanel } from "./PassEventPanel";
import { CHART_STYLE } from "./constants";
import { useAuth } from "../../features/auth/AuthContext";

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
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LapChart({
  data, annotations, watermarkEmail,
  focusNum, compSet, setCompSet,
  classView, activeLap, setActiveLap,
}: LapChartProps) {
  const { user } = useAuth();
  const isPaid = hasFullAccess(user);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // ── Internal-only state ────────────────────────────────────────
  const [dim, setDim] = useState<ChartDimensions | null>(null);
  const [info, setInfo] = useState<LapInfoData | null>(null);
  const [xAxisMode, setXAxisMode] = useState<"laps" | "hours" | "both">("laps");
  const [sidePanel, setSidePanel] = useState<string | null>(null);
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

  // Reset zoom when race data changes
  useEffect(() => { setLapStart(1); setLapEnd(data.maxLap); }, [data.maxLap]);

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;

  const panState = useRef({ panning: false, startX: 0, startLapStart: 1, startLapEnd: 1 });
  const rangeSelectStart = useRef<number | null>(null);

  // ── Chart state object for renderer ─────────────────────────────
  const chartState = useMemo<ChartState>(
    () => ({ focusNum, compSet, activeLap, classView, showWatermark: !isPaid, xAxisMode, lapStart, lapEnd, selectionRange }),
    [focusNum, compSet, activeLap, classView, isPaid, xAxisMode, lapStart, lapEnd, selectionRange]
  );

  // ── Lap elapsed hours for time axis ────────────────────────────
  // Note: computeLapElapsedHours is called inside drawChart directly

  // ── Resize & draw ──────────────────────────────────────────────
  const resize = useCallback(() => {
    if (!wrapperRef.current) return;
    const containerW = wrapperRef.current.clientWidth;
    const containerH = wrapperRef.current.clientHeight;
    const newDim = computeDimensions(containerW, containerH, isMobile, xAxisMode);
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

  // Resize on window resize
  useEffect(() => {
    const onResize = () => {
      const d = resize();
      if (d) setDim(d);
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
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
  const showLapInfo = useCallback(
    (lapNum: number) => {
      const laps = data.cars[String(focusNum)]?.laps || [];
      const valid = laps.map((l) => l.l);
      if (!valid.length) return;
      lapNum = Math.max(valid[0], Math.min(valid[valid.length - 1], lapNum));
      setActiveLap(lapNum);

      const infoData = buildLapInfo(data, annotations, chartState, lapNum);
      setInfo(infoData);
    },
    [data, annotations, chartState, focusNum, setActiveLap]
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

  // Close side panel when active lap changes — gap and h2h persist
  useEffect(() => {
    setSidePanel((prev) => {
      if (prev === "gap" || prev === "h2h") return prev;
      h2hDefaultCarRef.current = undefined;
      return null;
    });
  }, [activeLap]);

  // ── Comparison toggles ──────────────────────────────────────────
  const toggleComp = useCallback(
    (num: number) => {
      setCompSet((prev) => {
        const next = new Set(prev);
        if (next.has(num)) next.delete(num);
        else next.add(num);
        return next;
      });
    },
    []
  );

  const setPreset = useCallback(
    (cars: number[]) => {
      const relevant = cars.filter((n) => n !== focusNum);
      setCompSet((prev) => {
        const allOn = relevant.every((n) => prev.has(n));
        const next = new Set(prev);
        if (allOn) {
          relevant.forEach((n) => next.delete(n));
        } else {
          relevant.forEach((n) => next.add(n));
        }
        next.delete(focusNum);
        return next;
      });
    },
    [focusNum]
  );

  const clearComp = useCallback(() => setCompSet(new Set()), []);

  // ── Visible cars list ───────────────────────────────────────────
  const visibleCars = useMemo(
    () => getVisibleCars(data, classView).sort((a, b) => a - b),
    [data, classView]
  );


  // ── Presets ─────────────────────────────────────────────────────
  const presets = useMemo(() => {
    if (classView) {
      const classCars = data.classGroups[classView] || [];
      const result: Array<{ label: string; cars: number[] }> = [
        { label: `All ${classView}`, cars: classCars },
      ];
      // Show manufacturer presets within the selected class (IMSA races)
      if ((data as any).makeGroups) {
        const mg = (data as any).makeGroups as Record<string, number[]>;
        for (const [make, makeCars] of Object.entries(mg).sort()) {
          const inClass = makeCars.filter((n) => classCars.includes(n));
          if (inClass.length > 0) {
            result.push({ label: make, cars: inClass });
          }
        }
      }
      return result;
    }
    return [
      { label: "All Classes", cars: Object.keys(data.cars).map(Number) },
      ...Object.entries(data.classGroups)
        .sort()
        .map(([cls, cars]) => ({ label: cls, cars })),
    ];
  }, [data, classView]);

  // Cursor style
  const cursorStyle = rangeSelectStart.current !== null
    ? "crosshair"
    : isPanning
    ? "grabbing"
    : isZoomed
    ? "grab"
    : "default";

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-1" style={{ background: CHART_STYLE.bg, color: CHART_STYLE.text }}>
      {/* ── Compare controls ──────────────────────────────────────── */}
      <div className="px-1">
        <div>
          {/* Label + preset pills on one row */}
          <div className="flex flex-wrap items-center gap-1 mb-1">
            <span className="text-[11px] uppercase tracking-wider font-semibold shrink-0 mr-1" style={{ color: "#cbd5e1" }}>
              Compare
            </span>
            {presets.map((p) => {
              const relevant = p.cars.filter((n) => n !== focusNum);
              const isActive = relevant.length > 0 && relevant.every((n) => compSet.has(n));
              return (
                <button
                  key={p.label}
                  onClick={() => setPreset(p.cars)}
                  className="px-2.5 py-0.5 rounded-xl text-[11px] border transition-all cursor-pointer"
                  style={{
                    background: isActive ? "#4472C4" : CHART_STYLE.card,
                    borderColor: isActive ? "#4472C4" : CHART_STYLE.border,
                    color: isActive ? "#fff" : CHART_STYLE.muted,
                  }}
                >
                  {p.label} ({p.cars.length})
                </button>
              );
            })}
            <button
              onClick={clearComp}
              className="px-2.5 py-0.5 rounded-xl text-[11px] border transition-all cursor-pointer"
              style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, color: CHART_STYLE.muted }}
            >
              Clear
            </button>
          </div>
          {/* Car chips */}
          <div className="flex flex-wrap gap-1">
            {visibleCars.map((n) => {
              const isOn = compSet.has(n);
              const isFocus = n === focusNum;
              const col = isOn && !isFocus ? getCompColor(compSet, focusNum, n) : undefined;
              return (
                <button
                  key={n}
                  onClick={() => !isFocus && toggleComp(n)}
                  disabled={isFocus}
                  className="px-2 py-0.5 rounded-lg text-[11px] font-mono border transition-all cursor-pointer"
                  style={{
                    borderColor: col || CHART_STYLE.border,
                    background: col ? `${col}33` : "transparent",
                    color: isFocus ? CHART_STYLE.dim : isOn ? "#fff" : CHART_STYLE.dim,
                    opacity: isFocus ? 0.3 : 1,
                    pointerEvents: isFocus ? "none" : undefined,
                  }}
                  title={`${data.cars[String(n)]?.team}${data.cars[String(n)]?.make ? ` · ${data.cars[String(n)]?.make}` : ''} (${data.cars[String(n)]?.cls})`}
                >
                  #{n}
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {/* ── Chart + side panel row ─────────────────────────────── */}
      <div className="flex" style={{ height: isMobile ? "calc(100vh - 280px)" : "calc(100vh - 340px)", minHeight: 300 }}>
        {/* Chart canvas */}
        <div
          ref={wrapperRef}
          className="rounded-lg border relative overflow-hidden flex-1 min-w-0"
          style={{
            background: CHART_STYLE.card,
            borderColor: CHART_STYLE.border,
          }}
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
          {/* X-axis mode toggle + zoom indicator */}
          <div className="absolute left-0 right-0 flex items-end gap-2 px-1" style={{ bottom: 3, zIndex: 2 }}>
            {/* Toggle pill */}
            <div
              className="flex rounded-full overflow-hidden shrink-0"
              style={{
                marginLeft: (dim?.ML ?? 50) - 6,
                background: `${CHART_STYLE.card}cc`,
                border: `1px solid ${CHART_STYLE.border}`,
              }}
            >
              {(["laps", "hours", "both"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setXAxisMode(mode)}
                  className="px-1.5 py-0.5 text-[10px] font-mono cursor-pointer transition-colors leading-tight"
                  style={{
                    background: xAxisMode === mode ? CHART_STYLE.border : "transparent",
                    color: xAxisMode === mode ? "#fff" : CHART_STYLE.muted,
                  }}
                >
                  {mode === "laps" ? "Laps" : mode === "hours" ? "Hrs" : "Both"}
                </button>
              ))}
            </div>
            {/* Zoom indicator */}
            {isZoomed && (
              <div
                className="text-[10px] font-mono"
                style={{ color: CHART_STYLE.muted, marginBottom: 1 }}
              >
                L{Math.round(lapStart)}-{Math.round(lapEnd)} / {data.maxLap} (W to reset)
              </div>
            )}
          </div>
        </div>

        {/* Side panel */}
        <div
          className="shrink-0 overflow-hidden border-l rounded-r-lg"
          style={{
            width: sidePanel ? 480 : 0,
            borderColor: sidePanel ? CHART_STYLE.border : "transparent",
            background: CHART_STYLE.card,
            transition: "width 0.18s ease-out",
          }}
        >
          {sidePanel && (
            <div className="w-[480px] h-full flex flex-col">
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: CHART_STYLE.border }}>
                <span className="text-sm font-semibold text-white">
                  {sidePanel === "pit" ? "Pit Cycle Comparison" : sidePanel === "gap" ? "Gap Evolution" : sidePanel === "h2h" ? "Head-to-Head" : sidePanel === "event" ? "Position Change" : sidePanel}
                </span>
                <button
                  onClick={() => setSidePanel(null)}
                  className="text-xs cursor-pointer hover:text-white transition-colors"
                  style={{ color: CHART_STYLE.muted }}
                >
                  ✕
                </button>
              </div>
              {/* Panel content */}
              {sidePanel === "pit" && activeLap !== null && (
                <PitCyclePanel
                  data={data}
                  annotations={annotations}
                  focusNum={focusNum}
                  activeLap={activeLap}
                />
              )}
              {sidePanel === "gap" && activeLap !== null && (
                <GapEvolutionPanel
                  data={data}
                  focusNum={focusNum}
                  activeLap={activeLap}
                />
              )}
              {sidePanel === "h2h" && activeLap !== null && (
                <HeadToHeadPanel
                  data={data}
                  focusNum={focusNum}
                  activeLap={activeLap}
                  defaultCompareNum={h2hDefaultCarRef.current}
                />
              )}
              {sidePanel === "event" && info && (
                <PassEventPanel
                  reason={info.reason || ""}
                  posDelta={info.posDelta}
                  focusNum={focusNum}
                  onOpenH2H={(carNum) => {
                    h2hDefaultCarRef.current = carNum;
                    setSidePanel("h2h");
                  }}
                  onAddToCompare={(carNum) => {
                    setCompSet((prev) => {
                      const next = new Set(prev);
                      next.add(carNum);
                      return next;
                    });
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Data panel ───────────────────────────────────────────── */}
      <DataPanel info={info} focusNum={focusNum} navPrev={navPrev} navNext={navNext} setSidePanel={(panel) => {
        h2hDefaultCarRef.current = undefined;
        setSidePanel(panel);
      }} />

      {/* ── Legend ────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap gap-3 px-3 py-1 rounded-md text-[11px] border"
        style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, color: CHART_STYLE.muted }}
      >
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 h-2 rounded-sm" style={{ background: "#fbbf24", opacity: 0.2 }} />
          FCY
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#fbbf24", border: "1px solid #000" }} />
          Pit
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 h-0.5" style={{ background: "#f87171" }} />
          Penalty/Issue
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#f87171", border: "2px solid " + CHART_STYLE.bg }} />
          Settle
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 h-0.5 rounded-sm" style={{ background: "linear-gradient(90deg,#f87171,#fbbf24,#34d399,#60a5fa,#a78bfa)", opacity: 0.5 }} />
          Comp. cars
        </span>
      </div>

      {/* ── Footnote ─────────────────────────────────────────────── */}
      <div
        className="px-3 py-1 rounded-md text-[11px] leading-relaxed border"
        style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, color: CHART_STYLE.dim }}
      >
        Green-flag laps only for pace comparison (lap time &lt; {data.greenPaceCutoff}s). Comparison average excludes focus car.
        Use "Class View" to filter by class and see in-class positions with better resolution.
      </div>
    </div>
  );
}

// InfoPanel replaced by DataPanel component

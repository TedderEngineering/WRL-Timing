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
  focusNum, setFocusNum, compSet, setCompSet,
  classView, setClassView, activeLap, setActiveLap,
}: LapChartProps) {
  const { user } = useAuth();
  const isPaid = hasFullAccess(user);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Internal-only state ────────────────────────────────────────
  const [dim, setDim] = useState<ChartDimensions | null>(null);
  const [info, setInfo] = useState<LapInfoData | null>(null);

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;

  // ── Chart state object for renderer ─────────────────────────────
  const chartState = useMemo<ChartState>(
    () => ({ focusNum, compSet, activeLap, classView, showWatermark: !isPaid }),
    [focusNum, compSet, activeLap, classView, isPaid]
  );

  // ── Resize & draw ──────────────────────────────────────────────
  const resize = useCallback(() => {
    if (!wrapperRef.current || !scrollRef.current) return;
    const containerW = scrollRef.current.clientWidth;
    const containerH = wrapperRef.current.clientHeight;
    const newDim = computeDimensions(containerW, containerH, data.maxLap, isMobile);
    setDim(newDim);
    return newDim;
  }, [data.maxLap, isMobile]);

  // Draw whenever state or dimensions change
  useEffect(() => {
    const canvas = canvasRef.current;
    const d = dim || resize();
    if (!canvas || !d) return;

    // Update scroll container width for overflow
    const inner = canvas.parentElement;
    if (inner) {
      inner.style.width = d.W + "px";
      inner.style.height = d.H + "px";
    }

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

      // Auto-scroll canvas to keep crosshair visible
      if (dim && scrollRef.current) {
        const ax = dim.ML + ((lapNum - 1) / (data.maxLap - 1)) * dim.CW;
        const sl = scrollRef.current.scrollLeft;
        const sw = scrollRef.current.clientWidth;
        if (ax < sl + 60) scrollRef.current.scrollLeft = Math.max(0, ax - 80);
        else if (ax > sl + sw - 60) scrollRef.current.scrollLeft = ax - sw + 80;
      }
    },
    [data, annotations, chartState, focusNum, dim]
  );

  // ── Mouse/touch handlers ────────────────────────────────────────
  const getCanvasX = useCallback(
    (clientX: number): number => {
      if (!scrollRef.current) return 0;
      const r = scrollRef.current.getBoundingClientRect();
      return clientX - r.left + scrollRef.current.scrollLeft;
    },
    []
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dim) return;
      const cx = getCanvasX(e.clientX);
      const lap = Math.max(1, Math.min(data.maxLap, lapOfX(cx, data.maxLap, dim)));
      showLapInfo(lap);
    },
    [dim, getCanvasX, data.maxLap, showLapInfo]
  );

  const onMouseLeave = useCallback(() => {
    // Keep the last active lap visible (don't clear)
  }, []);

  // Touch: panning + lap selection
  const touchState = useRef({ startX: 0, startScroll: 0, moved: false });

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      touchState.current = {
        startX: e.touches[0].clientX,
        startScroll: scrollRef.current?.scrollLeft || 0,
        moved: false,
      };
    },
    []
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!e.touches.length || !scrollRef.current || !dim) return;
      const tx = e.touches[0].clientX;
      scrollRef.current.scrollLeft =
        touchState.current.startScroll + (touchState.current.startX - tx);
      touchState.current.moved = true;
      const cx = getCanvasX(tx);
      const lap = Math.max(1, Math.min(data.maxLap, lapOfX(cx, data.maxLap, dim)));
      showLapInfo(lap);
    },
    [dim, getCanvasX, data.maxLap, showLapInfo]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchState.current.moved && dim) {
        const ct = e.changedTouches[0];
        const cx = getCanvasX(ct.clientX);
        const lap = Math.max(1, Math.min(data.maxLap, lapOfX(cx, data.maxLap, dim)));
        showLapInfo(lap);
      }
    },
    [dim, getCanvasX, data.maxLap, showLapInfo]
  );

  // ── Keyboard navigation ─────────────────────────────────────────
  const navPrev = useCallback(() => {
    const laps = data.cars[String(focusNum)]?.laps || [];
    const valid = laps.map((l) => l.l);
    if (!valid.length) return;
    if (activeLap === null) {
      showLapInfo(valid[0]);
    } else {
      const idx = valid.indexOf(activeLap);
      if (idx > 0) showLapInfo(valid[idx - 1]);
    }
  }, [data, focusNum, activeLap, showLapInfo]);

  const navNext = useCallback(() => {
    const laps = data.cars[String(focusNum)]?.laps || [];
    const valid = laps.map((l) => l.l);
    if (!valid.length) return;
    if (activeLap === null) {
      showLapInfo(valid[0]);
    } else {
      const idx = valid.indexOf(activeLap);
      if (idx < valid.length - 1) showLapInfo(valid[idx + 1]);
    }
  }, [data, focusNum, activeLap, showLapInfo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navNext();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navPrev, navNext]);

  // ── Class filter change ────────────────────────────────────────
  const handleClassChange = useCallback(
    (cls: string) => {
      setClassView(cls);
      if (cls) {
        const focusCls = data.cars[String(focusNum)]?.cls;
        let newFocus = focusNum;
        if (focusCls !== cls) {
          newFocus = (data.classGroups[cls] || [])[0] || focusNum;
          setFocusNum(newFocus);
        }
        const newComp = new Set<number>();
        (data.classGroups[cls] || []).forEach((n) => {
          if (n !== newFocus) newComp.add(n);
        });
        setCompSet(newComp);
      }
      setActiveLap(null);
      setInfo(null);
    },
    [data, focusNum]
  );

  // ── Focus car change ───────────────────────────────────────────
  const handleFocusChange = useCallback(
    (num: number) => {
      setFocusNum(num);
      setCompSet((prev) => {
        const next = new Set(prev);
        next.delete(num);
        return next;
      });
      setActiveLap(null);
      setInfo(null);
    },
    []
  );

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

  // ── Class summary for header ────────────────────────────────────
  const classSummary = useMemo(() => {
    return Object.entries(data.classCarCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cls, count]) => `${cls}:${count}`)
      .join(" · ");
  }, [data]);

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
      { label: "All Cars", cars: Object.keys(data.cars).map(Number) },
      ...Object.entries(data.classGroups)
        .sort()
        .map(([cls, cars]) => ({ label: cls, cars })),
    ];
  }, [data, classView]);

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-1.5" style={{ background: CHART_STYLE.bg, color: CHART_STYLE.text }}>
      {/* ── Header subtitle ──────────────────────────────────────── */}
      <div className="hidden sm:flex items-baseline gap-3 text-xs font-mono px-1" style={{ color: CHART_STYLE.muted }}>
        <span>{classSummary}</span>
        <span>·</span>
        <span>{data.maxLap} Laps</span>
        <span>·</span>
        <span>{data.totalCars} Entries</span>
      </div>

      {/* ── Controls row ─────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-start px-1">
        {/* Class filter */}
        <div className="shrink-0" style={{ minWidth: 140 }}>
          <label className="block text-[11px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: CHART_STYLE.muted }}>
            Class View
          </label>
          <select
            value={classView}
            onChange={(e) => handleClassChange(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md text-sm font-mono text-white border cursor-pointer appearance-none"
            style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border }}
          >
            <option value="">All Classes ({data.totalCars})</option>
            {Object.entries(data.classGroups)
              .sort()
              .map(([cls, cars]) => (
                <option key={cls} value={cls}>
                  {cls} ({cars.length} cars)
                </option>
              ))}
          </select>
        </div>

        {/* Focus car */}
        <div className="shrink-0 flex-1" style={{ minWidth: 200 }}>
          <label className="block text-[11px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: CHART_STYLE.muted }}>
            Focus Car
          </label>
          <select
            value={focusNum}
            onChange={(e) => handleFocusChange(Number(e.target.value))}
            className="w-full px-2.5 py-1.5 rounded-md text-sm font-mono text-white border cursor-pointer appearance-none"
            style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border }}
          >
            {visibleCars.map((n) => {
              const c = data.cars[String(n)];
              const posLabel = classView ? `P${c.finishPosClass} in class` : `P${c.finishPos}`;
              const tag = c.make || c.cls;
              return (
                <option key={n} value={n}>
                  #{n} {c.team} ({tag}) — {posLabel}
                </option>
              );
            })}
          </select>
        </div>

        {/* Comparison area */}
        <div className="flex-[2] min-w-[280px]">
          <label className="block text-[11px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: CHART_STYLE.muted }}>
            Compare Against (avg lap time)
          </label>
          {/* Preset buttons */}
          <div className="flex flex-wrap gap-1 mb-1">
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
          <div className="flex flex-wrap gap-1 max-h-[60px] overflow-y-auto">
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

      {/* ── Chart canvas ────────────────────────────────────────── */}
      <div
        ref={wrapperRef}
        className="rounded-lg border relative overflow-hidden"
        style={{
          background: CHART_STYLE.card,
          borderColor: CHART_STYLE.border,
          height: isMobile ? "calc(100vh - 320px)" : "calc(100vh - 420px)",
          minHeight: 300,
        }}
      >
        <div
          ref={scrollRef}
          className="overflow-x-auto overflow-y-hidden h-full"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div style={{ width: dim?.W, height: dim?.H }}>
            <canvas
              ref={canvasRef}
              onMouseMove={onMouseMove}
              onMouseLeave={onMouseLeave}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onContextMenu={(e) => e.preventDefault()}
              style={{ display: "block", cursor: "crosshair" }}
            />
          </div>
        </div>
      </div>

      {/* ── Navigation buttons ──────────────────────────────────── */}
      <div className="hidden sm:flex gap-1.5">
        <button
          onClick={navPrev}
          className="flex-1 py-2 rounded-md text-sm font-semibold border cursor-pointer transition-colors active:brightness-125"
          style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, color: CHART_STYLE.text }}
        >
          ◀ Prev Lap
        </button>
        <button
          onClick={navNext}
          className="flex-1 py-2 rounded-md text-sm font-semibold border cursor-pointer transition-colors active:brightness-125"
          style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, color: CHART_STYLE.text }}
        >
          Next Lap ▶
        </button>
      </div>

      {/* ── Info panel ───────────────────────────────────────────── */}
      <InfoPanel info={info} activeLap={activeLap} focusNum={focusNum} navPrev={navPrev} navNext={navNext} />

      {/* ── Legend ────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap gap-3 px-3 py-2 rounded-md text-[11px] border"
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
        className="px-3 py-2 rounded-md text-[11px] leading-relaxed border"
        style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, color: CHART_STYLE.dim }}
      >
        Green-flag laps only for pace comparison (lap time &lt; {data.greenPaceCutoff}s). Comparison average excludes focus car.
        Use "Class View" to filter by class and see in-class positions with better resolution.
      </div>
    </div>
  );
}

// ─── Info Panel sub-component ────────────────────────────────────────────────

function InfoPanel({
  info,
  activeLap: _activeLap,
  focusNum,
  navPrev,
  navNext,
}: {
  info: LapInfoData | null;
  activeLap: number | null;
  focusNum: number;
  navPrev: () => void;
  navNext: () => void;
}) {
  if (!info) {
    return (
      <div
        className="flex items-center sm:block rounded-md border overflow-hidden"
        style={{
          background: CHART_STYLE.card,
          borderColor: CHART_STYLE.border,
          height: isMobileCheck() ? 80 : 68,
          opacity: 0.4,
        }}
      >
        {/* Mobile nav buttons */}
        <button onClick={navPrev} className="sm:hidden flex items-center justify-center w-9 shrink-0 h-full border-r text-sm" style={{ borderColor: CHART_STYLE.border, color: CHART_STYLE.text }}>
          ◀
        </button>
        <div className="flex-1 text-center text-sm py-4" style={{ color: CHART_STYLE.dim }}>
          Tap a lap or use ◀ ▶ to step
        </div>
        <button onClick={navNext} className="sm:hidden flex items-center justify-center w-9 shrink-0 h-full border-l text-sm" style={{ borderColor: CHART_STYLE.border, color: CHART_STYLE.text }}>
          ▶
        </button>
      </div>
    );
  }

  const dc = info.posDelta > 0 ? "#4ade80" : info.posDelta < 0 ? "#f87171" : "#666";
  const dt = info.posDelta > 0 ? `▲${info.posDelta}` : info.posDelta < 0 ? `▼${Math.abs(info.posDelta)}` : "—";

  return (
    <div
      className="flex items-stretch sm:block rounded-md border overflow-hidden"
      style={{
        background: CHART_STYLE.card,
        borderColor: CHART_STYLE.border,
        minHeight: isMobileCheck() ? 80 : 68,
      }}
    >
      {/* Mobile prev */}
      <button onClick={navPrev} className="sm:hidden flex items-center justify-center w-9 shrink-0 border-r cursor-pointer active:bg-[#1f1f3a]" style={{ borderColor: CHART_STYLE.border, color: CHART_STYLE.text }}>
        ◀
      </button>

      <div className="flex-1 min-w-0 px-3 py-2 overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-2 sm:gap-4">
          {/* Left: lap/pos info */}
          <div className="flex items-baseline gap-2.5 shrink-0 flex-wrap">
            <span className="font-bold text-[15px] font-mono text-white">L{info.lap.l}</span>
            <span className="font-bold text-[15px] font-mono text-white">{info.posLabel}</span>
            <span className="text-xs" style={{ color: CHART_STYLE.muted }}>
              {info.flagLabel}{info.isPit ? " — PIT" : ""}
            </span>
            <span className="font-bold text-[13px] shrink-0" style={{ color: dc }}>{dt}</span>
          </div>

          {/* Mid: reason + pace */}
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            {info.reason && (
              <div
                className="rounded px-2.5 py-1 text-xs truncate"
                style={{ background: "#1a1a35", borderLeft: `3px solid ${dc}`, color: "#ccc" }}
                title={info.reason}
              >
                {info.reason}
              </div>
            )}
            {info.paceInfo && (
              <div className="flex items-baseline gap-3 text-xs flex-wrap" style={{ color: "#aaa" }}>
                <span>
                  #{focusNum}: <b className="text-white font-mono font-semibold">{info.paceInfo.focusTime}</b>
                </span>
                {info.paceInfo.compAvg && (
                  <>
                    <span>
                      Comp: <b className="text-white font-mono font-semibold">{info.paceInfo.compAvg}</b>
                    </span>
                    <span className="font-semibold" style={{ color: info.paceInfo.deltaColor }}>
                      Δ{info.paceInfo.delta! > 0 ? "+" : ""}
                      {info.paceInfo.delta!.toFixed(2)}s vs {info.paceInfo.compLabel} (n={info.paceInfo.compN})
                    </span>
                  </>
                )}
                {!info.paceInfo.compAvg && info.speed && (
                  <span>{info.speed.toFixed(1)} mph</span>
                )}
              </div>
            )}
          </div>

          {/* Right: car metadata */}
          <div className="shrink-0 text-right text-[11px]" style={{ color: CHART_STYLE.dim }}>
            #{focusNum} {info.carTeam} · {info.carClass} · Finish P{info.finishPos}
          </div>
        </div>
      </div>

      {/* Mobile next */}
      <button onClick={navNext} className="sm:hidden flex items-center justify-center w-9 shrink-0 border-l cursor-pointer active:bg-[#1f1f3a]" style={{ borderColor: CHART_STYLE.border, color: CHART_STYLE.text }}>
        ▶
      </button>
    </div>
  );
}

function isMobileCheck() {
  return typeof window !== "undefined" && window.innerWidth <= 640;
}

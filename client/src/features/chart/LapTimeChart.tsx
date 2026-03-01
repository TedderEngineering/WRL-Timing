import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { hasFullAccess } from "../../lib/utils";
import type { RaceChartData, AnnotationData } from "@shared/types";
import {
  computeDimensions,
  lapOfX,
  getVisibleCars,
  getCompColor,
  getMaxPos,
  type ChartDimensions,
} from "./chart-renderer";
import { CHART_STYLE, CLASS_COLORS } from "./constants";
import { useAuth } from "../../features/auth/AuthContext";
import {
  computeLapTimeRankings,
  computeClassLapTimeRankings,
} from "./lap-time-rankings";

// ─── Coordinate helpers (duplicated for module independence) ─────────────────

function xOf(lap: number, maxLap: number, dim: ChartDimensions): number {
  return dim.ML + ((lap - 1) / (maxLap - 1)) * dim.CW;
}

function yOf(rank: number, maxRank: number, dim: ChartDimensions): number {
  return dim.MT + ((rank - 1) / maxRank) * dim.CH;
}

function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function secToStr(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ":" + sec.toFixed(3).padStart(6, "0");
}

// ─── Ranking segment helpers ────────────────────────────────────────────────

interface RankPt {
  lap: number;
  rank: number;
}

function getCarSegments(
  carNum: number,
  rankings: Map<number, Map<number, number>>,
  maxLap: number,
): RankPt[] {
  const pts: RankPt[] = [];
  for (let l = 1; l <= maxLap; l++) {
    const rank = rankings.get(l)?.get(carNum);
    if (rank !== undefined) pts.push({ lap: l, rank });
  }
  return pts;
}

function traceStepWithGaps(
  ctx: CanvasRenderingContext2D,
  pts: RankPt[],
  maxLap: number,
  maxRank: number,
  dim: ChartDimensions,
) {
  for (let i = 0; i < pts.length; i++) {
    const px = xOf(pts[i].lap, maxLap, dim);
    const py = yOf(pts[i].rank, maxRank, dim);
    if (i === 0 || pts[i].lap !== pts[i - 1].lap + 1) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, yOf(pts[i - 1].rank, maxRank, dim));
      ctx.lineTo(px, py);
    }
  }
}

// ─── Canvas draw ────────────────────────────────────────────────────────────

function drawLapTimeChart(
  canvas: HTMLCanvasElement,
  data: RaceChartData,
  annotations: AnnotationData,
  rankings: Map<number, Map<number, number>>,
  focusNum: number,
  compSet: Set<number>,
  activeLap: number | null,
  classView: string,
  dim: ChartDimensions,
  showWatermark: boolean,
  watermarkEmail?: string,
) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = dim.W * dpr;
  canvas.height = dim.H * dpr;
  canvas.style.width = dim.W + "px";
  canvas.style.height = dim.H + "px";

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, dim.W, dim.H);

  const maxLap = data.maxLap;
  const maxRank = getMaxPos(data, classView);
  const focusCar = data.cars[String(focusNum)];
  if (!focusCar) return;

  const x = (l: number) => xOf(l, maxLap, dim);
  const y = (r: number) => yOf(r, maxRank, dim);

  // 1. Grid
  ctx.strokeStyle = CHART_STYLE.gridLine;
  ctx.lineWidth = 0.5;
  const step = maxRank <= 20 ? 1 : maxRank <= 40 ? 2 : 5;
  for (let r = 1; r <= maxRank; r += step) {
    ctx.beginPath();
    ctx.moveTo(dim.ML, y(r));
    ctx.lineTo(dim.W - dim.MR, y(r));
    ctx.stroke();
  }
  for (let l = 1; l <= maxLap; l += 10) {
    ctx.beginPath();
    ctx.moveTo(x(l), dim.MT);
    ctx.lineTo(x(l), dim.H - dim.MB);
    ctx.stroke();
  }

  // 2. FCY bands
  for (const [s, e] of data.fcy || []) {
    ctx.fillStyle = CHART_STYLE.fcyBand;
    ctx.fillRect(x(s - 0.4), dim.MT, x(e + 0.4) - x(s - 0.4), dim.CH);
  }

  // 3. Pit vertical lines
  const ann = annotations[String(focusNum)] || { reasons: {}, pits: [], settles: [] };
  for (const p of ann.pits || []) {
    ctx.save();
    ctx.strokeStyle = p.c;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x(p.l), dim.MT);
    ctx.lineTo(x(p.l), dim.H - dim.MB);
    ctx.stroke();
    ctx.font = "500 9px system-ui";
    ctx.fillStyle = p.c;
    ctx.textAlign = "left";
    ctx.fillText(p.lb, x(p.l) + 3, dim.MT + 10 + (p.yo || 0));
    ctx.restore();
  }

  // 4. Comparison traces
  compSet.forEach((cn) => {
    if (cn === focusNum) return;
    const pts = getCarSegments(cn, rankings, maxLap);
    if (!pts.length) return;
    ctx.beginPath();
    ctx.strokeStyle = hexA(getCompColor(compSet, focusNum, cn), 0.28);
    ctx.lineWidth = 1.2;
    traceStepWithGaps(ctx, pts, maxLap, maxRank, dim);
    ctx.stroke();
  });

  // 5. Focus car trace
  const focusPts = getCarSegments(focusNum, rankings, maxLap);
  const clsColor = CLASS_COLORS[focusCar.cls] || "#4472C4";
  ctx.beginPath();
  ctx.strokeStyle = clsColor;
  ctx.lineWidth = 2.5;
  traceStepWithGaps(ctx, focusPts, maxLap, maxRank, dim);
  ctx.stroke();

  // 6. Pit dots along bottom edge
  for (const d of focusCar.laps) {
    if (d.pit) {
      ctx.beginPath();
      ctx.arc(x(d.l), dim.H - dim.MB, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#fbbf24";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }
  }

  // 7. Crosshair + active dot
  if (activeLap !== null) {
    const ax = x(activeLap);
    ctx.beginPath();
    ctx.strokeStyle = CHART_STYLE.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.moveTo(ax, dim.MT);
    ctx.lineTo(ax, dim.H - dim.MB);
    ctx.stroke();
    ctx.setLineDash([]);

    const lapRanks = rankings.get(activeLap);
    const rank = lapRanks?.get(focusNum);
    if (rank !== undefined) {
      const ay = y(rank);
      ctx.beginPath();
      ctx.arc(ax, ay, 8, 0, Math.PI * 2);
      ctx.fillStyle = clsColor + "4D";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ax, ay, 5, 0, Math.PI * 2);
      ctx.fillStyle = clsColor;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      compSet.forEach((cn) => {
        if (cn === focusNum) return;
        const cr = lapRanks?.get(cn);
        if (cr === undefined) return;
        const col = getCompColor(compSet, focusNum, cn);
        ctx.beginPath();
        ctx.arc(ax, y(cr), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = hexA(col, 0.7);
        ctx.fill();
        ctx.strokeStyle = hexA(col, 0.35);
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }

  // 8. Axis labels
  ctx.font = "500 10px monospace";
  ctx.fillStyle = CHART_STYLE.muted;
  ctx.textAlign = "right";
  for (let r = 1; r <= maxRank; r += step) {
    ctx.fillText(String(r), dim.ML - 6, y(r) + 4);
  }
  ctx.textAlign = "center";
  for (let l = 1; l <= maxLap; l += 10) {
    ctx.fillText(String(l), x(l), dim.H - dim.MB + 16);
  }
  ctx.font = "500 12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("Lap", dim.ML + dim.CW / 2, dim.H - 4);
  ctx.save();
  ctx.translate(14, dim.MT + dim.CH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(classView ? `${classView} Lap Time Rank` : "Lap Time Rank", 0, 0);
  ctx.restore();

  // 9. Watermark
  if (watermarkEmail && showWatermark) {
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.font = "14px system-ui";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const angle = (-30 * Math.PI) / 180;
    const spacing = 240;
    const lineH = 80;
    const diag = Math.sqrt(dim.W * dim.W + dim.H * dim.H);
    const cols = Math.ceil(diag / spacing) + 2;
    const rows = Math.ceil(diag / lineH) + 2;
    ctx.translate(dim.W / 2, dim.H / 2);
    ctx.rotate(angle);
    for (let row = -rows; row <= rows; row++) {
      for (let col = -cols; col <= cols; col++) {
        ctx.fillText(watermarkEmail, col * spacing, row * lineH);
      }
    }
    ctx.restore();
  }
}

// ─── Info panel data ────────────────────────────────────────────────────────

interface LapTimeInfo {
  lapNum: number;
  lapTime: string;
  lapTimeSec: number;
  rank: number | null;
  totalRanked: number;
  fastestTime: string | null;
  deltaToFastest: number | null;
  flagLabel: string;
  isPit: boolean;
  isFcy: boolean;
  carNum: number;
  carTeam: string;
  carClass: string;
  compAvg: string | null;
  compDelta: number | null;
  compDeltaColor: string;
  compLabel: string;
  compN: number;
}

function buildLapTimeInfo(
  data: RaceChartData,
  rankings: Map<number, Map<number, number>>,
  focusNum: number,
  lapNum: number,
  compSet: Set<number>,
): LapTimeInfo | null {
  const car = data.cars[String(focusNum)];
  if (!car) return null;
  const ld = car.laps.find((l) => l.l === lapNum);
  if (!ld) return null;

  const lapRanks = rankings.get(lapNum);
  const rank = lapRanks?.get(focusNum) ?? null;
  const totalRanked = lapRanks?.size ?? 0;

  let fastestTime: string | null = null;
  let deltaToFastest: number | null = null;
  if (rank !== null && lapRanks) {
    for (const [cn, r] of lapRanks) {
      if (r === 1) {
        const fl = data.cars[String(cn)]?.laps.find((l) => l.l === lapNum);
        if (fl) {
          fastestTime = secToStr(fl.ltSec);
          deltaToFastest = ld.ltSec - fl.ltSec;
        }
        break;
      }
    }
  }

  const isFcy = (data.fcy || []).some(([s, e]) => lapNum >= s && lapNum <= e);

  // Pace comparison against comp set
  let compAvg: string | null = null;
  let compDelta: number | null = null;
  let compDeltaColor = "#888";
  let compLabel = "";
  let compN = 0;

  if (ld.ltSec > 1 && ld.ltSec < data.greenPaceCutoff && ld.flag === "GREEN") {
    let sum = 0;
    let cnt = 0;
    compSet.forEach((cn) => {
      if (cn === focusNum) return;
      const cl = data.cars[String(cn)]?.laps;
      const cld = cl?.find((l) => l.l === lapNum);
      if (cld && cld.ltSec > 1 && cld.ltSec < data.greenPaceCutoff && cld.flag === "GREEN") {
        sum += cld.ltSec;
        cnt++;
      }
    });
    if (cnt > 0) {
      const avg = sum / cnt;
      compAvg = secToStr(avg);
      compDelta = ld.ltSec - avg;
      compDeltaColor = compDelta <= 0 ? "#4ade80" : compDelta < 0.5 ? "#fbbf24" : "#f87171";
      const compNums = [...compSet].filter((n) => n !== focusNum);
      compLabel = compNums.length <= 3 ? compNums.map((n) => "#" + n).join(", ") : `${compNums.length} cars`;
      compN = cnt;
    }
  }

  return {
    lapNum,
    lapTime: ld.lt,
    lapTimeSec: ld.ltSec,
    rank,
    totalRanked,
    fastestTime,
    deltaToFastest,
    flagLabel: isFcy ? "🟡 FCY" : "🟢 Grn",
    isPit: ld.pit === 1,
    isFcy,
    carNum: focusNum,
    carTeam: car.team,
    carClass: car.cls,
    compAvg,
    compDelta,
    compDeltaColor,
    compLabel,
    compN,
  };
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface LapTimeChartProps {
  data: RaceChartData;
  annotations: AnnotationData;
  raceId?: string;
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

// ─── Component ──────────────────────────────────────────────────────────────

export function LapTimeChart({
  data, annotations, watermarkEmail,
  focusNum, setFocusNum, compSet, setCompSet,
  classView, setClassView, activeLap, setActiveLap,
}: LapTimeChartProps) {
  const { user } = useAuth();
  const isPaid = hasFullAccess(user);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [dim, setDim] = useState<ChartDimensions | null>(null);
  const [info, setInfo] = useState<LapTimeInfo | null>(null);
  const activeLapRef = useRef(activeLap);
  activeLapRef.current = activeLap;

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;

  // ── Compute rankings (recomputes when data or class filter changes) ──
  const rankings = useMemo(
    () => classView
      ? computeClassLapTimeRankings(data, classView)
      : computeLapTimeRankings(data),
    [data, classView],
  );

  // ── Resize ────────────────────────────────────────────────────────────
  const resize = useCallback(() => {
    if (!wrapperRef.current || !scrollRef.current) return;
    const containerW = scrollRef.current.clientWidth;
    const containerH = wrapperRef.current.clientHeight;
    const newDim = computeDimensions(containerW, containerH, data.maxLap, isMobile);
    setDim(newDim);
    return newDim;
  }, [data.maxLap, isMobile]);

  // ── Draw ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const d = dim || resize();
    if (!canvas || !d) return;
    const inner = canvas.parentElement;
    if (inner) { inner.style.width = d.W + "px"; inner.style.height = d.H + "px"; }
    drawLapTimeChart(canvas, data, annotations, rankings, focusNum, compSet, activeLap, classView, d, !isPaid, watermarkEmail);
  }, [data, annotations, rankings, focusNum, compSet, activeLap, classView, dim, resize, isPaid, watermarkEmail]);

  useEffect(() => {
    const onResize = () => { const d = resize(); if (d) setDim(d); };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [resize]);

  // ── Interaction ───────────────────────────────────────────────────────
  const showLapInfo = useCallback(
    (lapNum: number) => {
      const laps = data.cars[String(focusNum)]?.laps || [];
      const valid = laps.map((l) => l.l);
      if (!valid.length) return;
      lapNum = Math.max(valid[0], Math.min(valid[valid.length - 1], lapNum));
      setActiveLap(lapNum);
      setInfo(buildLapTimeInfo(data, rankings, focusNum, lapNum, compSet));
      if (dim && scrollRef.current) {
        const ax = dim.ML + ((lapNum - 1) / (data.maxLap - 1)) * dim.CW;
        const sl = scrollRef.current.scrollLeft;
        const sw = scrollRef.current.clientWidth;
        if (ax < sl + 60) scrollRef.current.scrollLeft = Math.max(0, ax - 80);
        else if (ax > sl + sw - 60) scrollRef.current.scrollLeft = ax - sw + 80;
      }
    },
    [data, rankings, focusNum, compSet, dim, setActiveLap],
  );

  const getCanvasX = useCallback(
    (clientX: number): number => {
      if (!scrollRef.current) return 0;
      const r = scrollRef.current.getBoundingClientRect();
      return clientX - r.left + scrollRef.current.scrollLeft;
    },
    [],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dim) return;
      const cx = getCanvasX(e.clientX);
      showLapInfo(Math.max(1, Math.min(data.maxLap, lapOfX(cx, data.maxLap, dim))));
    },
    [dim, getCanvasX, data.maxLap, showLapInfo],
  );

  const onMouseLeave = useCallback(() => {}, []);

  const touchState = useRef({ startX: 0, startScroll: 0, moved: false });

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchState.current = { startX: e.touches[0].clientX, startScroll: scrollRef.current?.scrollLeft || 0, moved: false };
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!e.touches.length || !scrollRef.current || !dim) return;
      const tx = e.touches[0].clientX;
      scrollRef.current.scrollLeft = touchState.current.startScroll + (touchState.current.startX - tx);
      touchState.current.moved = true;
      showLapInfo(Math.max(1, Math.min(data.maxLap, lapOfX(getCanvasX(tx), data.maxLap, dim))));
    },
    [dim, getCanvasX, data.maxLap, showLapInfo],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchState.current.moved && dim) {
        const ct = e.changedTouches[0];
        showLapInfo(Math.max(1, Math.min(data.maxLap, lapOfX(getCanvasX(ct.clientX), data.maxLap, dim))));
      }
    },
    [dim, getCanvasX, data.maxLap, showLapInfo],
  );

  // ── Keyboard navigation ───────────────────────────────────────────────
  const navPrev = useCallback(() => {
    const valid = (data.cars[String(focusNum)]?.laps || []).map((l) => l.l);
    if (!valid.length) return;
    const cur = activeLapRef.current;
    if (cur === null) showLapInfo(valid[0]);
    else { const idx = valid.indexOf(cur); if (idx > 0) showLapInfo(valid[idx - 1]); }
  }, [data, focusNum, showLapInfo]);

  const navNext = useCallback(() => {
    const valid = (data.cars[String(focusNum)]?.laps || []).map((l) => l.l);
    if (!valid.length) return;
    const cur = activeLapRef.current;
    if (cur === null) showLapInfo(valid[0]);
    else { const idx = valid.indexOf(cur); if (idx < valid.length - 1) showLapInfo(valid[idx + 1]); }
  }, [data, focusNum, showLapInfo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); navPrev(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); navNext(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navPrev, navNext]);

  // ── Controls state ────────────────────────────────────────────────────
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
        (data.classGroups[cls] || []).forEach((n) => { if (n !== newFocus) newComp.add(n); });
        setCompSet(newComp);
      }
      setActiveLap(null);
      setInfo(null);
    },
    [data, focusNum, setClassView, setFocusNum, setCompSet, setActiveLap],
  );

  const handleFocusChange = useCallback(
    (num: number) => {
      setFocusNum(num);
      setCompSet((prev) => { const next = new Set(prev); next.delete(num); return next; });
      setActiveLap(null);
      setInfo(null);
    },
    [setFocusNum, setCompSet, setActiveLap],
  );

  const toggleComp = useCallback(
    (num: number) => {
      setCompSet((prev) => { const next = new Set(prev); if (next.has(num)) next.delete(num); else next.add(num); return next; });
    },
    [setCompSet],
  );

  const setPreset = useCallback(
    (cars: number[]) => {
      const relevant = cars.filter((n) => n !== focusNum);
      setCompSet((prev) => {
        const allOn = relevant.every((n) => prev.has(n));
        const next = new Set(prev);
        if (allOn) relevant.forEach((n) => next.delete(n));
        else relevant.forEach((n) => next.add(n));
        next.delete(focusNum);
        return next;
      });
    },
    [focusNum, setCompSet],
  );

  const clearComp = useCallback(() => setCompSet(new Set()), [setCompSet]);

  const visibleCars = useMemo(
    () => getVisibleCars(data, classView).sort((a, b) => a - b),
    [data, classView],
  );

  const classSummary = useMemo(() =>
    Object.entries(data.classCarCounts).sort(([a], [b]) => a.localeCompare(b)).map(([cls, count]) => `${cls}:${count}`).join(" · "),
    [data],
  );

  const presets = useMemo(() => {
    if (classView) {
      const classCars = data.classGroups[classView] || [];
      const result: Array<{ label: string; cars: number[] }> = [{ label: `All ${classView}`, cars: classCars }];
      if ((data as any).makeGroups) {
        const mg = (data as any).makeGroups as Record<string, number[]>;
        for (const [make, makeCars] of Object.entries(mg).sort()) {
          const inClass = makeCars.filter((n) => classCars.includes(n));
          if (inClass.length > 0) result.push({ label: make, cars: inClass });
        }
      }
      return result;
    }
    return [
      { label: "All Cars", cars: Object.keys(data.cars).map(Number) },
      ...Object.entries(data.classGroups).sort().map(([cls, cars]) => ({ label: cls, cars })),
    ];
  }, [data, classView]);

  // ─── RENDER ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-1.5" style={{ background: CHART_STYLE.bg, color: CHART_STYLE.text }}>
      {/* Header subtitle */}
      <div className="hidden sm:flex items-baseline gap-3 text-xs font-mono px-1" style={{ color: CHART_STYLE.muted }}>
        <span>{classSummary}</span>
        <span>·</span>
        <span>{data.maxLap} Laps</span>
        <span>·</span>
        <span>{data.totalCars} Entries</span>
      </div>

      {/* Controls row */}
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
            {Object.entries(data.classGroups).sort().map(([cls, cars]) => (
              <option key={cls} value={cls}>{cls} ({cars.length} cars)</option>
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
                <option key={n} value={n}>#{n} {c.team} ({tag}) — {posLabel}</option>
              );
            })}
          </select>
        </div>

        {/* Comparison area */}
        <div className="flex-[2] min-w-[280px]">
          <label className="block text-[11px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: CHART_STYLE.muted }}>
            Compare Against
          </label>
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

      {/* Chart canvas */}
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

      {/* Navigation buttons */}
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

      {/* Info panel */}
      <LapTimeInfoPanel info={info} focusNum={focusNum} navPrev={navPrev} navNext={navNext} />

      {/* Legend */}
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
          <span className="inline-block w-4 h-0.5 rounded-sm" style={{ background: "linear-gradient(90deg,#f87171,#fbbf24,#34d399,#60a5fa,#a78bfa)", opacity: 0.5 }} />
          Comp. cars
        </span>
      </div>

      {/* Footnote */}
      <div
        className="px-3 py-2 rounded-md text-[11px] leading-relaxed border"
        style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, color: CHART_STYLE.dim }}
      >
        Rank 1 = fastest lap time. Pit laps and FCY laps excluded from ranking.
        Use "Class View" to rank within a single class.
      </div>
    </div>
  );
}

// ─── Info Panel ─────────────────────────────────────────────────────────────

function LapTimeInfoPanel({
  info,
  focusNum,
  navPrev,
  navNext,
}: {
  info: LapTimeInfo | null;
  focusNum: number;
  navPrev: () => void;
  navNext: () => void;
}) {
  const mobile = typeof window !== "undefined" && window.innerWidth <= 640;

  if (!info) {
    return (
      <div
        className="flex items-center sm:block rounded-md border overflow-hidden"
        style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, height: mobile ? 80 : 68, opacity: 0.4 }}
      >
        <button onClick={navPrev} className="sm:hidden flex items-center justify-center w-9 shrink-0 h-full border-r text-sm" style={{ borderColor: CHART_STYLE.border, color: CHART_STYLE.text }}>◀</button>
        <div className="flex-1 text-center text-sm py-4" style={{ color: CHART_STYLE.dim }}>
          Tap a lap or use ◀ ▶ to step
        </div>
        <button onClick={navNext} className="sm:hidden flex items-center justify-center w-9 shrink-0 h-full border-l text-sm" style={{ borderColor: CHART_STYLE.border, color: CHART_STYLE.text }}>▶</button>
      </div>
    );
  }

  return (
    <div
      className="flex items-stretch sm:block rounded-md border overflow-hidden"
      style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border, minHeight: mobile ? 80 : 68 }}
    >
      <button onClick={navPrev} className="sm:hidden flex items-center justify-center w-9 shrink-0 border-r cursor-pointer active:bg-[#1f1f3a]" style={{ borderColor: CHART_STYLE.border, color: CHART_STYLE.text }}>◀</button>

      <div className="flex-1 min-w-0 px-3 py-2 overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-2 sm:gap-4">
          {/* Lap + rank */}
          <div className="flex items-baseline gap-2.5 shrink-0 flex-wrap">
            <span className="font-bold text-[15px] font-mono text-white">L{info.lapNum}</span>
            {info.rank !== null ? (
              <span className="font-bold text-[15px] font-mono text-white">
                Rank {info.rank}/{info.totalRanked}
              </span>
            ) : (
              <span className="text-[13px] font-mono" style={{ color: CHART_STYLE.muted }}>
                {info.isPit ? "PIT" : info.isFcy ? "FCY" : "No rank"}
              </span>
            )}
            <span className="text-xs" style={{ color: CHART_STYLE.muted }}>
              {info.flagLabel}{info.isPit ? " — PIT" : ""}
            </span>
          </div>

          {/* Lap time + delta */}
          <div className="flex-1 min-w-0 flex items-baseline gap-3 text-xs flex-wrap" style={{ color: "#aaa" }}>
            {info.lapTimeSec > 1 && (
              <span>
                Time: <b className="text-white font-mono font-semibold">{info.lapTime}</b>
              </span>
            )}
            {info.deltaToFastest !== null && info.deltaToFastest > 0 && (
              <span
                className="font-semibold"
                style={{ color: info.deltaToFastest < 0.5 ? "#4ade80" : info.deltaToFastest < 1.5 ? "#fbbf24" : "#f87171" }}
              >
                +{info.deltaToFastest.toFixed(3)}s to P1
              </span>
            )}
            {info.rank === 1 && (
              <span className="font-semibold" style={{ color: "#4ade80" }}>Fastest</span>
            )}
            {info.fastestTime && info.rank !== 1 && (
              <span>
                P1: <b className="text-white font-mono font-semibold">{info.fastestTime}</b>
              </span>
            )}
            {info.compAvg && (
              <>
                <span className="text-[10px]" style={{ color: CHART_STYLE.border }}>│</span>
                <span>
                  Avg: <b className="text-white font-mono font-semibold">{info.compAvg}</b>
                  <span style={{ color: CHART_STYLE.dim }}> ({info.compN} car{info.compN !== 1 ? "s" : ""})</span>
                </span>
                <span className="font-semibold" style={{ color: info.compDeltaColor }}>
                  Δ{info.compDelta! > 0 ? "+" : ""}{info.compDelta!.toFixed(2)}s
                </span>
              </>
            )}
          </div>

          {/* Car metadata */}
          <div className="shrink-0 text-right text-[11px]" style={{ color: CHART_STYLE.dim }}>
            #{focusNum} {info.carTeam} · {info.carClass}
          </div>
        </div>
      </div>

      <button onClick={navNext} className="sm:hidden flex items-center justify-center w-9 shrink-0 border-l cursor-pointer active:bg-[#1f1f3a]" style={{ borderColor: CHART_STYLE.border, color: CHART_STYLE.text }}>▶</button>
    </div>
  );
}

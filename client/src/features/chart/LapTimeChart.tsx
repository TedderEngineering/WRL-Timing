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
  formatLapTime,
} from "./chart-renderer";
import { CHART_STYLE, CLASS_COLORS } from "./constants";
import { useAuth } from "../../features/auth/AuthContext";
import {
  computeLapTimeRankings,
  computeClassLapTimeRankings,
} from "./lap-time-rankings";

// ─── Coordinate helpers (duplicated for module independence) ─────────────────

function xOf(lap: number, lapStart: number, lapEnd: number, dim: ChartDimensions): number {
  const range = lapEnd - lapStart;
  if (range <= 0) return dim.ML;
  return dim.ML + ((lap - lapStart) / range) * dim.CW;
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
  lapStart: number,
  lapEnd: number,
  maxRank: number,
  dim: ChartDimensions,
) {
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].lap < lapStart - 1 || pts[i].lap > lapEnd + 1) continue;
    const px = xOf(pts[i].lap, lapStart, lapEnd, dim);
    const py = yOf(pts[i].rank, maxRank, dim);
    if (i === 0 || pts[i].lap !== pts[i - 1].lap + 1 || pts[i - 1].lap < lapStart - 1) {
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
  lapStart: number,
  lapEnd: number,
  selectionRange: [number, number] | null,
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

  const visLaps = lapEnd - lapStart;
  const x = (l: number) => xOf(l, lapStart, lapEnd, dim);
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
  const gridStep = visLaps < 15 ? 1 : visLaps < 50 ? 5 : 10;
  const gridStart = Math.max(1, Math.ceil(lapStart / gridStep) * gridStep);
  for (let l = gridStart; l <= Math.min(maxLap, Math.ceil(lapEnd)); l += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x(l), dim.MT);
    ctx.lineTo(x(l), dim.H - dim.MB);
    ctx.stroke();
  }

  // 2. FCY bands
  for (const [s, e] of data.fcy || []) {
    if (e < lapStart || s > lapEnd) continue;
    ctx.fillStyle = CHART_STYLE.fcyBand;
    ctx.fillRect(x(s - 0.4), dim.MT, x(e + 0.4) - x(s - 0.4), dim.CH);
  }

  // 3. Pit vertical lines
  const ann = annotations[String(focusNum)] || { reasons: {}, pits: [], settles: [] };
  for (const p of ann.pits || []) {
    if (p.l < lapStart || p.l > lapEnd) continue;
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
    traceStepWithGaps(ctx, pts, lapStart, lapEnd, maxRank, dim);
    ctx.stroke();
  });

  // 5. Focus car trace
  const focusPts = getCarSegments(focusNum, rankings, maxLap);
  const clsColor = CLASS_COLORS[focusCar.cls] || "#4472C4";
  ctx.beginPath();
  ctx.strokeStyle = clsColor;
  ctx.lineWidth = 2.5;
  traceStepWithGaps(ctx, focusPts, lapStart, lapEnd, maxRank, dim);
  ctx.stroke();

  // 6. Pit dots along bottom edge
  for (const d of focusCar.laps) {
    if (d.pit && d.l >= lapStart && d.l <= lapEnd) {
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
  if (activeLap !== null && activeLap >= lapStart && activeLap <= lapEnd) {
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
  const labelStep = visLaps < 15 ? 1 : visLaps < 50 ? 5 : 10;
  const labelStart = Math.max(1, Math.ceil(lapStart / labelStep) * labelStep);
  for (let l = labelStart; l <= Math.min(maxLap, Math.ceil(lapEnd)); l += labelStep) {
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

  // 9. Selection rectangle
  if (selectionRange) {
    const [s, e] = selectionRange;
    const sx = x(Math.min(s, e));
    const ex = x(Math.max(s, e));
    ctx.fillStyle = "rgba(68,114,196,0.18)";
    ctx.fillRect(sx, dim.MT, ex - sx, dim.CH);
    ctx.strokeStyle = "rgba(68,114,196,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, dim.MT, ex - sx, dim.CH);
  }

  // 10. Watermark
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
    lapTime: formatLapTime(ld.lt),
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
  focusNum, compSet, setCompSet,
  classView, activeLap, setActiveLap,
}: LapTimeChartProps) {
  const { user } = useAuth();
  const isPaid = hasFullAccess(user);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [dim, setDim] = useState<ChartDimensions | null>(null);
  const [info, setInfo] = useState<LapTimeInfo | null>(null);

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

  // ── Compute rankings (recomputes when data or class filter changes) ──
  const rankings = useMemo(
    () => classView
      ? computeClassLapTimeRankings(data, classView)
      : computeLapTimeRankings(data),
    [data, classView],
  );

  // ── Resize ────────────────────────────────────────────────────────────
  const resize = useCallback(() => {
    if (!wrapperRef.current) return;
    const containerW = wrapperRef.current.clientWidth;
    const containerH = wrapperRef.current.clientHeight;
    const newDim = computeDimensions(containerW, containerH, isMobile);
    setDim(newDim);
    return newDim;
  }, [isMobile]);

  // ── Draw ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const d = dim || resize();
    if (!canvas || !d) return;
    drawLapTimeChart(canvas, data, annotations, rankings, focusNum, compSet, activeLap, classView, d, !isPaid, lapStart, lapEnd, selectionRange, watermarkEmail);
  }, [data, annotations, rankings, focusNum, compSet, activeLap, classView, dim, resize, isPaid, lapStart, lapEnd, selectionRange, watermarkEmail]);

  useEffect(() => {
    const onResize = () => { const d = resize(); if (d) setDim(d); };
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
    [],
  );

  // ── Interaction ───────────────────────────────────────────────────────
  const showLapInfo = useCallback(
    (lapNum: number) => {
      const laps = data.cars[String(focusNum)]?.laps || [];
      const valid = laps.map((l) => l.l);
      if (!valid.length) return;
      lapNum = Math.max(valid[0], Math.min(valid[valid.length - 1], lapNum));
      setActiveLap(lapNum);
      setInfo(buildLapTimeInfo(data, rankings, focusNum, lapNum, compSet));
    },
    [data, rankings, focusNum, compSet, setActiveLap],
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
    [data.maxLap],
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

      const cursorLap = lapOfX(cx, ls, le, d);
      const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      const range = le - ls;
      let newRange = range * factor;
      newRange = Math.max(5, Math.min(ml - 1, newRange));

      const frac = (cursorLap - ls) / range;
      let newStart = cursorLap - frac * newRange;
      let newEnd = newStart + newRange;

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
      if (rangeSelectStart.current !== null && dimRef.current && wrapperRef.current) {
        const cx = e.clientX - wrapperRef.current.getBoundingClientRect().left;
        const lap = lapOfX(cx, lapStartRef.current, lapEndRef.current, dimRef.current);
        setSelectionRange([rangeSelectStart.current, lap]);
        return;
      }

      if (!panState.current.panning || !dimRef.current) return;
      const dx = e.clientX - panState.current.startX;
      const { startLapStart, startLapEnd } = panState.current;
      const range = startLapEnd - startLapStart;
      const lapDelta = -(dx / dimRef.current.CW) * range;

      let newStart = startLapStart + lapDelta;
      let newEnd = startLapEnd + lapDelta;

      if (newStart < 1) { newStart = 1; newEnd = 1 + range; }
      if (newEnd > data.maxLap) { newEnd = data.maxLap; newStart = data.maxLap - range; }

      setLapStart(newStart);
      setLapEnd(newEnd);
    };

    const onUp = (e: MouseEvent) => {
      // Range selection finalize
      if (rangeSelectStart.current !== null && dimRef.current && wrapperRef.current) {
        const cx = e.clientX - wrapperRef.current.getBoundingClientRect().left;
        const endLap = lapOfX(cx, lapStartRef.current, lapEndRef.current, dimRef.current);
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

      if (dx < 4 && wrapperRef.current && dimRef.current) {
        const r = wrapperRef.current.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const lap = Math.round(lapOfX(cx, lapStartRef.current, lapEndRef.current, dimRef.current));
        showLapInfo(Math.max(1, Math.min(data.maxLap, lap)));
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [data.maxLap, showLapInfo]);

  // ── Mouse move (hover) ─────────────────────────────────────────
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dim || panState.current.panning || rangeSelectStart.current !== null) return;
      const cx = getCanvasX(e.clientX);
      const lap = Math.round(lapOfX(cx, lapStart, lapEnd, dim));
      showLapInfo(Math.max(1, Math.min(data.maxLap, lap)));
    },
    [dim, getCanvasX, lapStart, lapEnd, data.maxLap, showLapInfo],
  );

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
    [dim, getCanvasX, lapStart, lapEnd],
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

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchState.current = {
      startX: e.touches[0].clientX,
      startLapStart: lapStartRef.current,
      startLapEnd: lapEndRef.current,
      moved: false,
    };
  }, []);

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

      const cx = getCanvasX(tx);
      const lap = Math.round(lapOfX(cx, newStart, newEnd, dim));
      showLapInfo(Math.max(1, Math.min(data.maxLap, lap)));
    },
    [dim, getCanvasX, data.maxLap, showLapInfo],
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
    [dim, getCanvasX, data.maxLap, showLapInfo],
  );

  // ── Keyboard navigation ───────────────────────────────────────────────
  const navPrev = useCallback(() => {
    const valid = (data.cars[String(focusNum)]?.laps || []).map((l) => l.l);
    if (!valid.length) return;
    const cur = activeLapRef.current;
    if (cur === null) showLapInfo(valid[0]);
    else {
      const idx = valid.indexOf(cur);
      if (idx > 0) {
        const newLap = valid[idx - 1];
        showLapInfo(newLap);
        autoPan(newLap);
      }
    }
  }, [data, focusNum, showLapInfo, autoPan]);

  const navNext = useCallback(() => {
    const valid = (data.cars[String(focusNum)]?.laps || []).map((l) => l.l);
    if (!valid.length) return;
    const cur = activeLapRef.current;
    if (cur === null) showLapInfo(valid[0]);
    else {
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

      if (e.key === "ArrowLeft") { e.preventDefault(); navPrev(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); navNext(); }
      else if (e.key === "w" || e.key === "W") {
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
      { label: "All Classes", cars: Object.keys(data.cars).map(Number) },
      ...Object.entries(data.classGroups).sort().map(([cls, cars]) => ({ label: cls, cars })),
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

  // ─── RENDER ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-1" style={{ background: CHART_STYLE.bg, color: CHART_STYLE.text }}>
      {/* Compare controls */}
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

      {/* Chart canvas */}
      <div
        ref={wrapperRef}
        className="rounded-lg border relative overflow-hidden"
        style={{
          background: CHART_STYLE.card,
          borderColor: CHART_STYLE.border,
          height: isMobile ? "calc(100vh - 280px)" : "calc(100vh - 340px)",
          minHeight: 300,
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
        {/* Zoom indicator */}
        {isZoomed && (
          <div
            className="absolute text-[10px] font-mono"
            style={{ bottom: 5, left: (dim?.ML ?? 50) - 2, color: CHART_STYLE.muted, zIndex: 2 }}
          >
            L{Math.round(lapStart)}-{Math.round(lapEnd)} / {data.maxLap} (W to reset)
          </div>
        )}
      </div>

      {/* Info panel */}
      <LapTimeInfoPanel info={info} focusNum={focusNum} navPrev={navPrev} navNext={navNext} />

      {/* Legend */}
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
          <span className="inline-block w-4 h-0.5 rounded-sm" style={{ background: "linear-gradient(90deg,#f87171,#fbbf24,#34d399,#60a5fa,#a78bfa)", opacity: 0.5 }} />
          Comp. cars
        </span>
      </div>

      {/* Footnote */}
      <div
        className="px-3 py-1 rounded-md text-[11px] leading-relaxed border"
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

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { hasFullAccess } from "../../lib/utils";
import type { RaceChartData, AnnotationData } from "@shared/types";
import {
  computeDimensions,
  compareStroke,
  lapOfX,
  getCompColor,
  getMaxPos,
  type ChartDimensions,
  formatLapTime,
} from "./chart-renderer";
import { CHART_STYLE, COMPARE_PALETTE, TRACE } from "./constants";
import { drawPitTags } from "./pit-band";
import { TraceControls } from "./TraceControls";
import { LapScrubber } from "./LapScrubber";
import { CarSummary, Stat } from "./LapDetailsPanel";
import type { TraceView } from "./trace-view";
import { useAuth } from "../../features/auth/AuthContext";
import {
  computeLapTimeRankings,
  computeClassLapTimeRankings,
} from "./lap-time-rankings";
import { carNo } from "./car-number";
import { isGreenFlag } from "./flags";

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

  // 3. The focus car's pit and driver tags, as on the Position Trace
  const ann = annotations[String(focusNum)] || { reasons: {}, pits: [], settles: [] };
  if (dim.band) {
    drawPitTags(ctx, {
      markers: ann.pits || [],
      x,
      lapStart,
      lapEnd,
      plotLeft: dim.ML,
      plotRight: dim.W - dim.MR,
      plotTop: dim.MT,
      plotBottom: dim.H - dim.MB,
      band: dim.band,
      activeLap,
      background: CHART_STYLE.card,
    });
  }

  // 4. Comparison traces (compareStroke: the same lines as the Position Trace)
  const many = [...compSet].filter((n) => n !== focusNum).length > COMPARE_PALETTE.length;
  compSet.forEach((cn) => {
    if (cn === focusNum) return;
    const pts = getCarSegments(cn, rankings, maxLap);
    if (!pts.length) return;
    const cs = compareStroke(getCompColor(compSet, focusNum, cn), many);
    ctx.beginPath();
    ctx.strokeStyle = cs.stroke;
    ctx.lineWidth = cs.width;
    traceStepWithGaps(ctx, pts, lapStart, lapEnd, maxRank, dim);
    ctx.stroke();
  });

  // 5. Focus car trace: orange over a dark halo, as on the Position Trace
  const focusPts = getCarSegments(focusNum, rankings, maxLap);
  const clsColor = TRACE.focus;
  ctx.beginPath();
  traceStepWithGaps(ctx, focusPts, lapStart, lapEnd, maxRank, dim);
  ctx.lineJoin = "round";
  ctx.strokeStyle = CHART_STYLE.card;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = clsColor;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.lineJoin = "miter";

  // 6. Pit dots along bottom edge
  for (const d of focusCar.laps) {
    if (d.pit && d.l >= lapStart && d.l <= lapEnd) {
      const marker = ann.pits.find((p: any) => p.l === d.l);
      ctx.beginPath();
      ctx.arc(x(d.l), dim.H - dim.MB, 3, 0, Math.PI * 2);
      ctx.fillStyle = marker?.isGarage ? "#f97316" : "#fbbf24";
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

  if (ld.ltSec > 1 && ld.ltSec < data.greenPaceCutoff && isGreenFlag(ld.flag)) {
    let sum = 0;
    let cnt = 0;
    compSet.forEach((cn) => {
      if (cn === focusNum) return;
      const cl = data.cars[String(cn)]?.laps;
      const cld = cl?.find((l) => l.l === lapNum);
      if (cld && cld.ltSec > 1 && cld.ltSec < data.greenPaceCutoff && isGreenFlag(cld.flag)) {
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
      compLabel = compNums.length <= 3 ? compNums.map((n) => "#" + carNo(data, n)).join(", ") : `${compNums.length} cars`;
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
  setFocusNum: (n: number) => void;
  compSet: Set<number>;
  classView: string;
  activeLap: number | null;
  setActiveLap: React.Dispatch<React.SetStateAction<number | null>>;
  /** Class, makes and compare, shared with the Position Trace (held by the race page). */
  view: TraceView;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LapTimeChart({
  data, annotations, watermarkEmail,
  focusNum, setFocusNum, compSet,
  classView, activeLap, setActiveLap, view,
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
    const newDim = computeDimensions(containerW, containerH, isMobile, "laps", undefined, { pitTags: true });
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
      // Transfer focus to chart so arrow keys advance laps instead of dropdown
      wrapperRef.current?.focus();
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

  // Cursor style
  const cursorStyle = rangeSelectStart.current !== null
    ? "crosshair"
    : isPanning
    ? "grabbing"
    : isZoomed
    ? "grab"
    : "default";

  // ─── RENDER ───────────────────────────────────────────────────────────
  // The same frame as the Position Trace: shared controls, the chart with its caption and the
  // lap strip, and the lap details beside it from md up (below it on a phone).

  const lapFlag = info ? (info.isFcy ? "FCY" : "Green") : null;
  const legend = (
    <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs" style={{ color: "#cbd5e1" }}>
      <li className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-[18px]" style={{ background: TRACE.focus }} />Focus car #{carNo(data, focusNum)}</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-[2px] w-[18px]" style={{ background: "#3987e5" }} />Compare cars</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5" style={{ background: "rgba(251,191,36,0.3)" }} />Full Course Yellow (FCY)</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-px" style={{ background: TRACE.fcyBar }} />Pit stop · driver out</li>
      <li style={{ color: TRACE.axis }}>Rank 1 = fastest lap; pit and FCY laps are not ranked</li>
    </ul>
  );

  return (
    <div className="flex flex-col md:h-full md:min-h-0" style={{ background: CHART_STYLE.bg, color: CHART_STYLE.text }}>
      <TraceControls
        data={data}
        focusNum={focusNum}
        onFocus={setFocusNum}
        classView={classView}
        compSet={compSet}
        view={view}
      />

      <div className="flex flex-col md:min-h-0 md:flex-1 md:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-2 py-2 sm:px-6 sm:py-3 md:min-h-0">
          <figure className="m-0 flex flex-col rounded-lg border p-2 sm:p-3 md:min-h-0 md:flex-1" style={{ background: CHART_STYLE.card, borderColor: CHART_STYLE.border }}>
            <div
              ref={wrapperRef}
              tabIndex={0}
              aria-label={`Lap time rank for car ${focusNum}. Click a lap for details; arrow keys step laps.`}
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
              <span>{classView ? `Lap time rank in ${classView}` : "Lap time rank"} · {view.fieldCars.length} cars</span>
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
          aria-label="Lap details"
          className="flex flex-col border-t md:min-h-0 md:w-[360px] md:shrink-0 md:overflow-hidden md:border-l md:border-t-0 lg:w-[400px]"
          style={{ borderColor: CHART_STYLE.border, background: "#0e0e20" }}
        >
          <div className="no-scrollbar flex flex-col gap-3 p-4 md:min-h-0 md:flex-1 md:overflow-y-auto">
            <CarSummary data={data} focusNum={focusNum} annotations={annotations} />
            <LapTimeDetails info={info} classView={classView} />
            <div className="mt-auto hidden border-t pt-3 md:block" style={{ borderColor: CHART_STYLE.border }}>{legend}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Lap details (side panel) ───────────────────────────────────────────────

const LT = { card: "#12122a", line: "#1e1e38", muted: "#9a9ab4", good: "#4ade80", warn: "#fab219", bad: "#f87171" };

function LapTimeDetails({ info, classView }: { info: LapTimeInfo | null; classView: string }) {
  if (!info) {
    return (
      <p className="rounded-lg border p-3 text-[13px]" style={{ background: LT.card, borderColor: LT.line, color: LT.muted }}>
        Pick a lap: click or tap the chart, drag the strip under it, or use ◀ ▶ (arrow keys on a keyboard).
      </p>
    );
  }
  const toP1 = info.deltaToFastest;
  return (
    <div className="grid grid-cols-2 gap-2.5 rounded-lg border p-3" style={{ background: LT.card, borderColor: LT.line }}>
      <div className="col-span-2 flex justify-between">
        <span className="font-semibold">Lap {info.lapNum}</span>
        <span style={{ color: info.isFcy ? LT.warn : "#0ca30c" }}>● {info.isFcy ? "Full Course Yellow" : "Green"}</span>
      </div>
      <Stat
        label={classView ? `Rank in ${classView}` : "Rank"}
        value={info.rank !== null ? `${info.rank} of ${info.totalRanked}` : info.isPit ? "Pit lap" : info.isFcy ? "FCY lap" : "Not ranked"}
        sub={info.rank === 1 ? "Fastest this lap" : undefined}
      />
      <Stat label="Lap time" value={info.lapTimeSec > 1 ? info.lapTime : "—"} sub={info.isPit ? "pit lap" : undefined} />
      {info.fastestTime && info.rank !== 1 && toP1 !== null && toP1 > 0 && (
        <div className="col-span-2 text-[13px]">
          <span className="font-mono" style={{ color: toP1 < 0.5 ? LT.good : toP1 < 1.5 ? LT.warn : LT.bad }}>+{toP1.toFixed(3)}</span>
          <span style={{ color: LT.muted }}> to the fastest this lap ({info.fastestTime})</span>
        </div>
      )}
      {info.compAvg && info.compDelta !== null && (
        <div className="col-span-2 text-[13px]">
          <span className="font-mono" style={{ color: info.compDeltaColor }}>
            {info.compDelta > 0 ? "+" : "−"}
            {Math.abs(info.compDelta).toFixed(3)}
          </span>
          <span style={{ color: LT.muted }}>
            {" "}vs the compare average {info.compAvg} ({info.compN} car{info.compN !== 1 ? "s" : ""} on green-flag laps)
          </span>
        </div>
      )}
    </div>
  );
}

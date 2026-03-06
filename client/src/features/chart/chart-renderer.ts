/**
 * Canvas-based lap chart renderer.
 * Ported from the original barber_position_trace_v2.html.
 *
 * This module is framework-agnostic — it only operates on a <canvas> element.
 * The React component wraps it with useRef/useEffect.
 */

import type {
  RaceChartData,
  AnnotationData,
  CarAnnotations,
  LapData,
} from "@shared/types";
import { CLASS_COLORS, COMP_PALETTE, CHART_STYLE } from "./constants";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChartState {
  focusNum: number;
  compSet: Set<number>;
  activeLap: number | null;
  classView: string; // "" = all, or "GTU", "GTO" etc.
  showWatermark?: boolean;
  xAxisMode: "laps" | "hours" | "both";
  lapStart: number;
  lapEnd: number;
  selectionRange?: [number, number] | null;
}

export interface ChartDimensions {
  W: number;
  H: number;
  ML: number;
  MR: number;
  MT: number;
  MB: number;
  CW: number;
  CH: number;
}

export interface LapInfoData {
  lap: LapData;
  carNum: number;
  carTeam: string;
  carClass: string;
  finishPos: number;
  posLabel: string;
  posDelta: number;
  flagLabel: string;
  isPit: boolean;
  reason: string | null;
  paceInfo: {
    focusTime: string;
    compAvg: string | null;
    delta: number | null;
    deltaColor: string;
    compLabel: string;
    compN: number;
  } | null;
  speed: number | null;
  pitInfo: PitInfoData | null;
}

import type { PitMarker, PitTimingData } from "@shared/types";

export interface PitInfoData {
  pitLabel: string;
  stintNumber?: number;
  outDriver?: string;
  inDriver?: string;
  driverChanged?: boolean;
  strategyType?: string;
  strategyTarget?: string;
  timing: PitTimingData | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function secToStr(s: number | null): string {
  if (!s) return "--";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ":" + sec.toFixed(3).padStart(6, "0");
}

export function getCompColor(compSet: Set<number>, focusNum: number, carNum: number): string {
  const sorted = [...compSet].filter((n) => n !== focusNum).sort((a, b) => a - b);
  const idx = sorted.indexOf(carNum);
  if (idx < 0) return "#888";
  return COMP_PALETTE[idx % COMP_PALETTE.length];
}

export function computeLapElapsedHours(data: RaceChartData): Map<number, number> {
  const cars = Object.values(data.cars);
  cars.sort((a, b) => b.laps.length - a.laps.length);
  const leader = cars[0];
  const map = new Map<number, number>();
  if (!leader) return map;
  let runningSum = 0;
  for (const lap of leader.laps) {
    runningSum += lap.ltSec;
    map.set(lap.l, runningSum / 3600);
  }
  return map;
}

/** Per-car cumulative race time (in hours) for Hrs/Both x-axis modes. */
function computeAllCarCumulativeHours(data: RaceChartData): Map<string, Map<number, number>> {
  const result = new Map<string, Map<number, number>>();
  for (const [carNum, car] of Object.entries(data.cars)) {
    const carMap = new Map<number, number>();
    let runningSum = 0;
    for (const lap of car.laps) {
      runningSum += lap.ltSec;
      carMap.set(lap.l, runningSum / 3600);
    }
    result.set(carNum, carMap);
  }
  return result;
}

/** Maps a cumulative-hours value back to the equivalent "virtual lap" on the leader's timeline.
 *  This lets us reuse the existing lap-based x-axis range (lapStart/lapEnd) for time-based plotting. */
function hoursToVirtualLap(hours: number, leaderHours: Map<number, number>): number {
  let prevLap = 1, prevH = 0;
  for (const [lap, h] of leaderHours) {
    if (h >= hours) {
      // Linear interpolate between previous and current
      const range = h - prevH;
      if (range <= 0) return lap;
      const frac = (hours - prevH) / range;
      return prevLap + frac * (lap - prevLap);
    }
    prevLap = lap;
    prevH = h;
  }
  // Past the leader's last lap — extrapolate
  return prevLap;
}

export function formatHour(h: number): string {
  const hours = Math.floor(h);
  const minutes = Math.round((h % 1) * 60);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

// ─── Coordinate mapping ──────────────────────────────────────────────────────

function xOf(lap: number, lapStart: number, lapEnd: number, dim: ChartDimensions): number {
  const range = lapEnd - lapStart;
  if (range <= 0) return dim.ML;
  return dim.ML + ((lap - lapStart) / range) * dim.CW;
}

function yOf(pos: number, maxPos: number, dim: ChartDimensions): number {
  return dim.MT + ((pos - 1) / maxPos) * dim.CH;
}

export function lapOfX(x: number, lapStart: number, lapEnd: number, dim: ChartDimensions): number {
  const range = lapEnd - lapStart;
  if (range <= 0) return lapStart;
  return (x - dim.ML) / dim.CW * range + lapStart;
}

// ─── Visible cars / positions based on class filter ──────────────────────────

export function getVisibleCars(data: RaceChartData, classView: string): number[] {
  if (!classView) return Object.keys(data.cars).map(Number);
  return data.classGroups[classView] || [];
}

export function getMaxPos(data: RaceChartData, classView: string): number {
  if (!classView) return data.totalCars;
  return data.classCarCounts[classView] || data.totalCars;
}

function posKey(classView: string): "cp" | "p" {
  return classView ? "cp" : "p";
}

// ─── Compute dimensions ─────────────────────────────────────────────────────

export function computeDimensions(
  containerW: number,
  containerH: number,
  isMobile: boolean,
  xAxisMode?: "laps" | "hours" | "both",
  minWidth?: number
): ChartDimensions {
  const W = Math.max(minWidth ?? 300, Math.floor(containerW));
  const H = Math.max(300, Math.floor(containerH));

  const ML = isMobile ? 40 : 50;
  const MR = isMobile ? 10 : 20;
  const MT = isMobile ? 40 : 60;
  const baseMB = isMobile ? 30 : 40;
  const MB = xAxisMode === "both" ? baseMB + 14 : baseMB;
  const CW = W - ML - MR;
  const CH = H - MT - MB;

  return { W, H, ML, MR, MT, MB, CW, CH };
}

// ─── Main draw function ──────────────────────────────────────────────────────

export function drawChart(
  canvas: HTMLCanvasElement,
  data: RaceChartData,
  annotations: AnnotationData,
  state: ChartState,
  dim: ChartDimensions,
  watermarkEmail?: string
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

  // Adjust dimensions for dual-row axis labels
  const adjDim: ChartDimensions = state.xAxisMode === "both"
    ? { ...dim, MB: dim.MB + 14, CH: dim.CH - 14 }
    : dim;

  const { focusNum, compSet, activeLap, classView, lapStart, lapEnd } = state;
  const focusNumStr = String(focusNum);
  const maxLap = data.maxLap;
  const maxPos = getMaxPos(data, classView);
  const pk = posKey(classView);
  const focusCar = data.cars[String(focusNum)];
  if (!focusCar) return;
  const laps = focusCar.laps;
  if (!laps.length) return;

  const ann: CarAnnotations = annotations[String(focusNum)] || {
    reasons: {},
    pits: [],
    settles: [],
  };

  const visLaps = lapEnd - lapStart;
  const x = (l: number) => xOf(l, lapStart, lapEnd, adjDim);
  const y = (p: number) => yOf(p, maxPos, adjDim);

  // Hrs/Both mode: per-car cumulative hours for time-based x mapping
  const xAxisMode = state.xAxisMode ?? "laps";
  const useTimeX = xAxisMode === "hours" || xAxisMode === "both";
  const allCarHours = useTimeX ? computeAllCarCumulativeHours(data) : null;
  const leaderHours = useTimeX ? computeLapElapsedHours(data) : null;
  const focusCarHours = useTimeX ? allCarHours!.get(String(focusNum)) : null;

  /** Get x-pixel for a car's lap, using time-based mapping in Hrs/Both modes. */
  const xForCar = (carNum: string, lapNum: number): number => {
    if (!useTimeX) return x(lapNum);
    const carH = allCarHours!.get(carNum);
    const h = carH?.get(lapNum);
    if (h == null) return x(lapNum); // fallback
    if (xAxisMode === "both") {
      // Both: focus car uses lap numbers, others use time mapped to focus car's lap scale
      if (carNum === String(focusNum)) return x(lapNum);
      // Map this car's cumulative time to a virtual lap on focus car's timeline
      if (focusCarHours) return x(hoursToVirtualLap(h, focusCarHours));
      return x(lapNum);
    }
    // Hrs: map cumulative time to virtual lap on leader's timeline
    return x(hoursToVirtualLap(h, leaderHours!));
  };

  // ── 1. Grid ────────────────────────────────────────────────────
  ctx.strokeStyle = CHART_STYLE.gridLine;
  ctx.lineWidth = 0.5;
  const posStep = maxPos <= 20 ? 1 : maxPos <= 40 ? 2 : 5;
  for (let p = 1; p <= maxPos; p += posStep) {
    const py = y(p);
    ctx.beginPath();
    ctx.moveTo(adjDim.ML, py);
    ctx.lineTo(adjDim.W - adjDim.MR, py);
    ctx.stroke();
  }
  const gridStep = visLaps < 15 ? 1 : visLaps < 50 ? 5 : 10;
  const gridStart = Math.max(1, Math.ceil(lapStart / gridStep) * gridStep);
  for (let l = gridStart; l <= Math.min(maxLap, Math.ceil(lapEnd)); l += gridStep) {
    const lx = x(l);
    ctx.beginPath();
    ctx.moveTo(lx, adjDim.MT);
    ctx.lineTo(lx, adjDim.H - adjDim.MB);
    ctx.stroke();
  }

  // ── 2. FCY bands ───────────────────────────────────────────────
  (data.fcy || []).forEach(([s, e]) => {
    if (e < lapStart || s > lapEnd) return;
    ctx.fillStyle = CHART_STYLE.fcyBand;
    ctx.fillRect(x(s - 0.4), adjDim.MT, x(e + 0.4) - x(s - 0.4), adjDim.CH);
  });

  // ── 3. Pit stop vertical lines ────────────────────────────────
  (ann.pits || []).forEach((p: PitMarker) => {
    if (p.l < lapStart || p.l > lapEnd) return;
    const px = xForCar(focusNumStr, p.l);
    const pitTop = adjDim.MT;
    const pitBot = adjDim.H - adjDim.MB;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.strokeStyle = p.c;
    ctx.lineWidth = 1;
    ctx.moveTo(px, pitTop);
    ctx.lineTo(px, pitBot);
    ctx.stroke();
    ctx.font = "500 9px system-ui";
    ctx.fillStyle = p.c;
    ctx.textAlign = "left";
    const labelY = pitTop + 10 + (p.yo || 0);
    ctx.fillText(p.lb, px + 3, labelY);

    // SPC indicator at mid-height of pit vertical line
    const spc = p.pitTiming?.spcAnalysis?.totalLoss;
    if (spc && spc.classification !== "normal") {
      const midY = (pitTop + pitBot) / 2;

      if (spc.classification === "warning") {
        // Yellow triangle
        ctx.beginPath();
        ctx.fillStyle = "#fbbf24";
        ctx.moveTo(px, midY - 5);
        ctx.lineTo(px - 4.5, midY + 4);
        ctx.lineTo(px + 4.5, midY + 4);
        ctx.closePath();
        ctx.fill();
      } else if (spc.classification === "outlier") {
        // Circle: red for slow, green for fast
        const color = spc.direction === "fast" ? "#4ade80" : "#f87171";
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(px, midY, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  });

  // ── 4. Comparison car traces ───────────────────────────────────
  compSet.forEach((cn) => {
    if (cn === focusNum) return;
    const cnStr = String(cn);
    const cl = data.cars[cnStr]?.laps;
    if (!cl || !cl.length) return;
    const col = getCompColor(compSet, focusNum, cn);
    ctx.beginPath();
    ctx.strokeStyle = hexA(col, 0.28);
    ctx.lineWidth = 1.2;
    let started = false;
    for (let i = 0; i < cl.length; i++) {
      const d = cl[i];
      if (d.l < lapStart - 1 || d.l > lapEnd + 1) continue;
      const cx2 = xForCar(cnStr, d.l);
      const cy = y(d[pk]);
      if (!started) {
        ctx.moveTo(cx2, cy);
        started = true;
      } else {
        ctx.lineTo(cx2, y(cl[i - 1][pk]));
        ctx.lineTo(cx2, cy);
      }
    }
    ctx.stroke();
  });

  // ── 5. Focus car position line ─────────────────────────────────
  const clsColor = CLASS_COLORS[focusCar.cls] || "#4472C4";
  ctx.beginPath();
  ctx.strokeStyle = clsColor;
  ctx.lineWidth = 2.5;
  let focusStarted = false;
  for (let i = 0; i < laps.length; i++) {
    const d = laps[i];
    if (d.l < lapStart - 1 || d.l > lapEnd + 1) continue;
    const lx = xForCar(focusNumStr, d.l);
    const ly = y(d[pk]);
    if (!focusStarted) {
      ctx.moveTo(lx, ly);
      focusStarted = true;
    } else {
      ctx.lineTo(lx, y(laps[i - 1][pk]));
      ctx.lineTo(lx, ly);
    }
  }
  ctx.stroke();

  // ── 6. Settle arrows (pixel collision detection) ──────────────
  const SETTLE_BOX_W = 100;
  const SETTLE_BOX_H = 30;
  const SETTLE_Y_STEP = 32;
  const BASE_ARROW_LEN = 36;

  // Pre-compute settle positions and sort by x
  const settleItems: Array<{
    sp: typeof ann.settles extends (infer T)[] ? T : never;
    cx: number;
    cy: number;
    settlePos: number;
  }> = [];
  for (const sp of (ann.settles || [])) {
    if (sp.l < lapStart || sp.l > lapEnd) continue;
    let settlePos = sp.p;
    if (classView) {
      const ld = laps.find((l) => l.l === sp.l);
      if (ld) settlePos = ld[pk];
      else continue;
    }
    settleItems.push({ sp, cx: xForCar(focusNumStr, sp.l), cy: y(settlePos), settlePos });
  }
  settleItems.sort((a, b) => a.cx - b.cx);

  // Place labels using pixel collision detection
  interface PlacedBox { x: number; y: number; w: number; h: number }
  const placed: PlacedBox[] = [];

  function boxOverlaps(bx: number, by: number): boolean {
    for (const p of placed) {
      if (bx < p.x + p.w && bx + SETTLE_BOX_W > p.x &&
          by < p.y + p.h && by + SETTLE_BOX_H > p.y) {
        return true;
      }
    }
    return false;
  }

  for (const { sp, cx, cy } of settleItems) {
    // Try stacking upward until no collision
    let yOff = 0;
    const bx = cx - SETTLE_BOX_W / 2;
    while (boxOverlaps(bx, cy - BASE_ARROW_LEN - yOff - SETTLE_BOX_H)) {
      yOff += SETTLE_Y_STEP;
      if (yOff > 200) break; // safety limit
    }
    placed.push({
      x: bx,
      y: cy - BASE_ARROW_LEN - yOff - SETTLE_BOX_H,
      w: SETTLE_BOX_W,
      h: SETTLE_BOX_H,
    });

    const aL = BASE_ARROW_LEN + yOff;

    ctx.save();
    // Arrow shaft
    ctx.beginPath();
    ctx.strokeStyle = sp.c;
    ctx.lineWidth = 1.5;
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx, cy - aL);
    ctx.stroke();
    // Arrow head
    ctx.beginPath();
    ctx.fillStyle = sp.c;
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx - 3.5, cy - 11);
    ctx.lineTo(cx + 3.5, cy - 11);
    ctx.closePath();
    ctx.fill();
    // Dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = sp.c;
    ctx.fill();
    ctx.strokeStyle = CHART_STYLE.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Labels
    ctx.font = "700 10px system-ui";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(sp.lb, cx, cy - aL - 14);
    ctx.font = "500 9px system-ui";
    ctx.fillStyle = sp.c;
    ctx.fillText(sp.su, cx, cy - aL - 3);
    ctx.restore();
  }

  // ── 7. Pit dots ────────────────────────────────────────────────
  laps.forEach((d) => {
    if (d.pit && d.l >= lapStart && d.l <= lapEnd) {
      const px = xForCar(focusNumStr, d.l);
      const py = y(d[pk]);
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fbbf24";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }
  });

  // ── 8. Crosshair + active dot ─────────────────────────────────
  if (activeLap !== null && activeLap >= lapStart && activeLap <= lapEnd) {
    const d = laps.find((l) => l.l === activeLap);
    if (d) {
      const ax = xForCar(focusNumStr, d.l);
      const ay = y(d[pk]);

      // Crosshair
      ctx.beginPath();
      ctx.strokeStyle = CHART_STYLE.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(ax, adjDim.MT);
      ctx.lineTo(ax, adjDim.H - adjDim.MB);
      ctx.stroke();
      ctx.setLineDash([]);

      // Glow
      ctx.beginPath();
      ctx.arc(ax, ay, 8, 0, Math.PI * 2);
      ctx.fillStyle = clsColor + "4D";
      ctx.fill();

      // Active dot
      ctx.beginPath();
      ctx.arc(ax, ay, 5, 0, Math.PI * 2);
      ctx.fillStyle = clsColor;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      // Comparison dots
      compSet.forEach((cn) => {
        if (cn === focusNum) return;
        const cl = data.cars[String(cn)]?.laps;
        const cd = cl?.find((l) => l.l === activeLap);
        if (!cd) return;
        const cx2 = x(cd.l);
        const cy2 = y(cd[pk]);
        const col = getCompColor(compSet, focusNum, cn);
        ctx.beginPath();
        ctx.arc(cx2, cy2, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = hexA(col, 0.7);
        ctx.fill();
        ctx.strokeStyle = hexA(col, 0.35);
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }

  // ── 9. Axis labels ─────────────────────────────────────────────
  ctx.font = "500 10px monospace";
  ctx.fillStyle = CHART_STYLE.muted;
  ctx.textAlign = "right";
  for (let p = 1; p <= maxPos; p += posStep) {
    ctx.fillText("P" + p, adjDim.ML - 6, y(p) + 4);
  }
  // Bottom axis: lap numbers, hour markers, or both
  const lapHours = computeLapElapsedHours(data);

  ctx.textAlign = "center";
  if (xAxisMode === "laps" || xAxisMode === "both") {
    ctx.font = "500 10px monospace";
    ctx.fillStyle = CHART_STYLE.muted;
    const lapY = xAxisMode === "both" ? adjDim.H - adjDim.MB + 14 : adjDim.H - adjDim.MB + 16;
    const labelStep = visLaps < 15 ? 1 : visLaps < 50 ? 5 : 10;
    const labelStart = Math.max(1, Math.ceil(lapStart / labelStep) * labelStep);
    for (let l = labelStart; l <= Math.min(maxLap, Math.ceil(lapEnd)); l += labelStep) {
      ctx.fillText(String(l), x(l), lapY);
    }
  }
  if (xAxisMode === "hours" || xAxisMode === "both") {
    const isSecondary = xAxisMode === "both";
    ctx.font = isSecondary ? "500 9px monospace" : "500 10px monospace";
    ctx.fillStyle = isSecondary ? hexA(CHART_STYLE.muted, 0.6) : CHART_STYLE.muted;
    const hourY = isSecondary ? adjDim.H - adjDim.MB + 26 : adjDim.H - adjDim.MB + 16;
    // Find max whole hour
    let maxHour = 0;
    for (const h of lapHours.values()) {
      if (h > maxHour) maxHour = h;
    }
    for (let hr = 0; hr <= Math.floor(maxHour); hr++) {
      // Find first lap where elapsed >= hr
      let boundaryLap: number | null = null;
      for (const [lap, h] of lapHours) {
        if (h >= hr) { boundaryLap = lap; break; }
      }
      if (boundaryLap === null) continue;
      const bx = x(boundaryLap);
      ctx.fillText(formatHour(hr), bx, hourY);
      // Vertical tick mark
      if (!isSecondary) {
        ctx.beginPath();
        ctx.strokeStyle = hexA(CHART_STYLE.muted, 0.3);
        ctx.lineWidth = 1;
        ctx.moveTo(bx, adjDim.MT);
        ctx.lineTo(bx, adjDim.MT + adjDim.CH);
        ctx.stroke();
      }
    }
  }
  const axisLabel = xAxisMode === "hours" ? "Race Time"
    : xAxisMode === "both" ? "Lap / Time"
    : "Lap";
  ctx.font = "500 12px system-ui";
  ctx.fillStyle = CHART_STYLE.muted;
  ctx.textAlign = "center";
  ctx.fillText(axisLabel, adjDim.ML + adjDim.CW / 2, adjDim.H - 4);
  ctx.save();
  ctx.translate(14, adjDim.MT + adjDim.CH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(classView ? classView + " Position" : "Overall Position", 0, 0);
  ctx.restore();

  // ── 10. Selection rectangle ───────────────────────────────────
  if (state.selectionRange) {
    const [s, e] = state.selectionRange;
    const sx = x(Math.min(s, e));
    const ex = x(Math.max(s, e));
    ctx.fillStyle = "rgba(68,114,196,0.18)";
    ctx.fillRect(sx, adjDim.MT, ex - sx, adjDim.CH);
    ctx.strokeStyle = "rgba(68,114,196,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, adjDim.MT, ex - sx, adjDim.CH);
  }

  // ── 11. Watermark overlay ───────────────────────────────────────
  if (watermarkEmail && state.showWatermark !== false) {
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.font = "14px system-ui";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const angle = (-30 * Math.PI) / 180;
    const spacing = 240;
    const lineHeight = 80;
    // Cover the full canvas diagonally
    const diagonal = Math.sqrt(adjDim.W * adjDim.W + adjDim.H * adjDim.H);
    const cols = Math.ceil(diagonal / spacing) + 2;
    const rows = Math.ceil(diagonal / lineHeight) + 2;

    ctx.translate(adjDim.W / 2, adjDim.H / 2);
    ctx.rotate(angle);

    for (let row = -rows; row <= rows; row++) {
      for (let col = -cols; col <= cols; col++) {
        ctx.fillText(watermarkEmail, col * spacing, row * lineHeight);
      }
    }
    ctx.restore();
  }
}

// ─── Build info data for a given active lap ──────────────────────────────────

export function buildLapInfo(
  data: RaceChartData,
  annotations: AnnotationData,
  state: ChartState,
  lapNum: number
): LapInfoData | null {
  const { focusNum, compSet, classView } = state;
  const pk = posKey(classView);
  const car = data.cars[String(focusNum)];
  if (!car) return null;

  const laps = car.laps;
  const d = laps.find((l) => l.l === lapNum);
  if (!d) return null;

  const idx = laps.indexOf(d);
  const prevPos = idx > 0 ? laps[idx - 1][pk] : d[pk];
  const posDelta = prevPos - d[pk];

  const flagLabel = d.flag === "FCY" ? "🟡 FCY" : "🟢 Grn";
  const posLabel = classView
    ? `P${d.cp} in ${classView} (P${d.p} overall)`
    : `P${d.p}`;

  const ann = annotations[String(focusNum)] || { reasons: {}, pits: [], settles: [] };
  const reason = ann.reasons?.[String(d.l)] || null;

  // Pace comparison
  let paceInfo: LapInfoData["paceInfo"] = null;
  if (d.ltSec && d.ltSec > 1 && d.ltSec < data.greenPaceCutoff && d.flag === "GREEN") {
    let sum = 0;
    let cnt = 0;
    compSet.forEach((cn) => {
      if (cn === focusNum) return;
      const cl = data.cars[String(cn)]?.laps;
      const ld = cl?.find((l) => l.l === lapNum);
      if (ld && ld.ltSec && ld.ltSec > 1 && ld.ltSec < data.greenPaceCutoff && ld.flag === "GREEN") {
        sum += ld.ltSec;
        cnt++;
      }
    });

    if (cnt > 0) {
      const avg = sum / cnt;
      const delta = d.ltSec - avg;
      const deltaColor = delta <= 0 ? "#4ade80" : delta < 0.5 ? "#fbbf24" : "#f87171";
      const compNums = [...compSet].filter((n) => n !== focusNum);
      const compLabel =
        compNums.length <= 3
          ? compNums.map((n) => "#" + n).join(", ")
          : `${compNums.length} cars`;

      paceInfo = {
        focusTime: d.lt,
        compAvg: secToStr(avg),
        delta,
        deltaColor,
        compLabel,
        compN: cnt,
      };
    } else {
      paceInfo = {
        focusTime: d.lt,
        compAvg: null,
        delta: null,
        deltaColor: "#888",
        compLabel: "",
        compN: 0,
      };
    }
  }

  // Pit info: find pit marker for this lap or adjacent out-lap
  let pitInfo: PitInfoData | null = null;
  if (d.pit === 1 || ann.pits.some((p: PitMarker) => p.l === lapNum || p.l === lapNum - 1)) {
    const marker = ann.pits.find((p: PitMarker) => p.l === lapNum) ||
                   ann.pits.find((p: PitMarker) => p.l === lapNum - 1);
    if (marker) {
      pitInfo = {
        pitLabel: marker.lb,
        stintNumber: marker.stintNumber,
        outDriver: marker.outDriver,
        inDriver: marker.inDriver,
        driverChanged: marker.driverChanged,
        strategyType: marker.strategyType,
        timing: marker.pitTiming ?? null,
      };
    }
  }

  return {
    lap: d,
    carNum: focusNum,
    carTeam: car.team,
    carClass: car.cls,
    finishPos: car.finishPos,
    posLabel,
    posDelta,
    flagLabel,
    isPit: d.pit === 1,
    reason,
    paceInfo,
    speed: d.spd ?? null,
    pitInfo,
  };
}

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
import { COMPARE_PALETTE, COMP_PALETTE, CHART_STYLE, TRACE } from "./constants";
import { drawPitTags, drawSettleLeaders, pitTagBand, settleLabels, type PitTagBand } from "./pit-band";

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
  /** Cars drawn as the faint field (usually every car in the class view). */
  fieldCars?: number[];
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
  /** Race charts (Position Trace, Lap Times): room above the plot for the pit and driver tags. */
  band?: PitTagBand;
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
import { carNo } from "./car-number";

export interface PitInfoData {
  pitLabel: string;
  stintNumber?: number;
  outDriver?: string;
  inDriver?: string;
  driverChanged?: boolean;
  strategyType?: string;
  strategyTarget?: string;
  timing: PitTimingData | null;
  alsoPittingCars?: number[];
  kind?: PitMarker["kind"];
  cycle?: PitMarker["cycle"];
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

/** Normalize a lap time string to M:SS.mmm — drops hours, removes leading zero on minutes */
export function formatLapTime(lt: string): string {
  // Already in good format like "1:36.853"
  const parts = lt.split(":");
  if (parts.length === 3) {
    // "HH:MM:SS.mmm" → drop hours, strip leading zero on minutes
    const min = parseInt(parts[1], 10);
    const sec = parseFloat(parts[2]);
    return min + ":" + sec.toFixed(3).padStart(6, "0");
  }
  if (parts.length === 2) {
    // "M:SS.mmm" or "MM:SS.mmm" — strip leading zero on minutes, normalize seconds
    const min = parseInt(parts[0], 10);
    const sec = parseFloat(parts[1]);
    return min + ":" + sec.toFixed(3).padStart(6, "0");
  }
  return lt;
}

/** A compare car's colour: by the order it was added (Set insertion order), so colours stay put. */
/**
 * Compare-car lines, the same on Position Trace and Lap Times: every car in view (more than
 * eight) thin and soft in its own colour, as Lap Times always drew them, so the focus car reads
 * first; a few picked cars a little stronger.
 */
export function compareStroke(color: string, many: boolean): { stroke: string; width: number } {
  return many ? { stroke: hexA(color, 0.28), width: 1.2 } : { stroke: hexA(color, 0.85), width: 1.75 };
}

/** The 20-colour palette without its oranges, which belong to the focus car. */
const MANY_PALETTE = COMP_PALETTE.filter((c) => c !== "#fb923c" && c !== "#fdba74");

/**
 * Up to eight compare cars: the compare palette in the order they were added. More (every car
 * in view, the default): the 20-colour palette by car number, so each car keeps its colour.
 */
export function getCompColor(compSet: Set<number>, focusNum: number, carNum: number): string {
  const ordered = [...compSet].filter((n) => n !== focusNum);
  const idx = ordered.indexOf(carNum);
  if (idx < 0) return "#888";
  if (ordered.length <= COMPARE_PALETTE.length) return COMPARE_PALETTE[idx];
  const byNum = ordered.sort((a, b) => a - b);
  return MANY_PALETTE[byNum.indexOf(carNum) % MANY_PALETTE.length];
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
  minWidth?: number,
  opts?: { pitTags?: boolean }
): ChartDimensions {
  const W = Math.max(minWidth ?? 300, Math.floor(containerW));
  // The Position Trace fills whatever height the window leaves it, so it may be shorter.
  const H = Math.max(opts?.pitTags ? 200 : 300, Math.floor(containerH));

  const ML = isMobile ? 36 : 44;
  // Right margin holds the car-number labels at the end of each trace.
  const MR = isMobile ? 34 : 44;
  // With pit tags, the top margin holds their labels (two lanes); nothing is written over the plot.
  const band = opts?.pitTags ? pitTagBand(isMobile) : undefined;
  const MT = band ? band.tagY + band.lanes * band.laneH + 5 : isMobile ? 18 : 22;
  const baseMB = isMobile ? 26 : 34;
  const MB = xAxisMode === "both" ? baseMB + 14 : baseMB;
  const CW = W - ML - MR;
  const CH = H - MT - MB;

  return { W, H, ML, MR, MT, MB, CW, CH, ...(band ? { band } : {}) };
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

  // ── Y-axis auto-zoom based on selected cars ────────────────────
  const allCarNums = Object.keys(data.cars).map(Number);
  const selectedCars = new Set([focusNum, ...compSet]);
  const isAllSelected = selectedCars.size >= allCarNums.length;

  let yMin = 1;
  let yMax = maxPos;
  // With a field drawn, the axis covers every position in view; the old auto-zoom applied
  // only when the chart showed the selected cars alone.
  const hasField = (state.fieldCars?.length ?? 0) > 0;
  if (!hasField && !isAllSelected && selectedCars.size > 0) {
    let pMin = Infinity;
    let pMax = -Infinity;
    selectedCars.forEach((cn) => {
      const cl = data.cars[String(cn)]?.laps;
      if (!cl) return;
      for (const d of cl) {
        const pos = d[pk];
        if (pos < pMin) pMin = pos;
        if (pos > pMax) pMax = pos;
      }
    });
    if (pMin !== Infinity) {
      yMin = Math.max(1, pMin - 1);
      yMax = Math.min(maxPos, pMax + 1);
    }
  }
  const yRange = yMax - yMin || 1;

  const visLaps = lapEnd - lapStart;
  const x = (l: number) => xOf(l, lapStart, lapEnd, adjDim);
  const y = (p: number) => adjDim.MT + ((p - yMin) / yRange) * adjDim.CH;

  // Hrs/Both mode: per-car cumulative hours for time-based x mapping
  const xAxisMode = state.xAxisMode ?? "laps";
  const useTimeX = xAxisMode === "hours" || xAxisMode === "both";
  const allCarHours = useTimeX ? computeAllCarCumulativeHours(data) : null;
  const leaderHours = useTimeX ? computeLapElapsedHours(data) : null;
  const focusCarHours = useTimeX ? allCarHours!.get(String(focusNum)) : null;

  // Build garage-start-time overrides: for garage laps in Hrs mode,
  // use the START time (end of previous lap) instead of the END time.
  // Key: "carNum:lapNum", Value: start-time in hours.
  const garageStartHours = new Map<string, number>();
  if (useTimeX) {
    for (const [carNum, carAnn] of Object.entries(annotations)) {
      if (!carAnn?.pits) continue;
      const carH = allCarHours!.get(carNum);
      if (!carH) continue;
      const carLaps = data.cars[carNum]?.laps;
      if (!carLaps) continue;
      for (const pit of carAnn.pits) {
        if (!(pit as PitMarker).isGarage) continue;
        // Find the previous lap's cumulative time = garage start
        const lapIdx = carLaps.findIndex((l) => l.l === pit.l);
        if (lapIdx <= 0) continue; // no previous lap
        const prevLapNum = carLaps[lapIdx - 1].l;
        const prevH = carH.get(prevLapNum);
        if (prevH != null) {
          garageStartHours.set(`${carNum}:${pit.l}`, prevH);
        }
      }
    }
  }

  /** Get x-pixel for a car's lap, using time-based mapping in Hrs/Both modes.
   *  For garage laps, uses the START time (entry into garage) instead of END time. */
  const xForCar = (carNum: string, lapNum: number): number => {
    if (!useTimeX) return x(lapNum);
    // Check for garage start-time override
    const garageH = garageStartHours.get(`${carNum}:${lapNum}`);
    const carH = allCarHours!.get(carNum);
    const h = garageH ?? carH?.get(lapNum);
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

  // ── 1. Grid (horizontal position lines only; laps are on the axis) ──
  ctx.strokeStyle = TRACE.grid;
  ctx.lineWidth = 1;
  const posCount = yMax - yMin;
  const posStep = posCount <= 20 ? 1 : posCount <= 40 ? 2 : 5;
  const gridYStart = Math.ceil(yMin / posStep) * posStep;
  for (let p = Math.max(gridYStart, yMin); p <= yMax; p += posStep) {
    const py = Math.round(y(p)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(adjDim.ML, py);
    ctx.lineTo(adjDim.W - adjDim.MR, py);
    ctx.stroke();
  }

  // ── 2. FCY bands: soft fill, a bar along the top, "FCY" when there is room ──
  (data.fcy || []).forEach(([s, e]) => {
    if (e < lapStart || s > lapEnd) return;
    const x0 = Math.max(adjDim.ML, x(s - 0.5));
    const x1 = Math.min(adjDim.W - adjDim.MR, x(e + 0.5));
    if (x1 <= x0) return;
    ctx.fillStyle = TRACE.fcyFill;
    ctx.fillRect(x0, adjDim.MT, x1 - x0, adjDim.CH);
    ctx.fillStyle = TRACE.fcyBar;
    ctx.fillRect(x0, adjDim.MT, x1 - x0, 3);
    if (x1 - x0 > 30) {
      ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif";
      ctx.fillStyle = TRACE.fcyText;
      ctx.textAlign = "left";
      ctx.fillText("FCY", x0 + 5, adjDim.MT + 16);
    }
  });

  // ── 2b. The focus car's pit and driver tags (shared with Lap Times) ──
  const band = adjDim.band;
  if (band) {
    drawPitTags(ctx, {
      markers: ann.pits || [],
      x: (l) => xForCar(focusNumStr, l),
      lapStart,
      lapEnd,
      plotLeft: adjDim.ML,
      plotRight: adjDim.W - adjDim.MR,
      plotTop: adjDim.MT,
      plotBottom: adjDim.MT + adjDim.CH,
      band,
      activeLap,
      background: CHART_STYLE.card,
    });
  }

  // Step path for one car: horizontal to the lap, vertical to the new position.
  const tracePath = (carNum: string, cl: LapData[]) => {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < cl.length; i++) {
      const d = cl[i];
      if (d.l < lapStart - 1 || d.l > lapEnd + 1) continue;
      const px = xForCar(carNum, d.l);
      const py = y(d[pk]);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, y(cl[i - 1][pk]));
        ctx.lineTo(px, py);
      }
    }
    return started;
  };

  const circle = (cx: number, cy: number, r: number, fill: string, stroke: string = CHART_STYLE.card, sw = 2) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sw;
    ctx.stroke();
  };
  const triangle = (cx: number, cy: number, r: number, fill: string) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy + r * 0.8);
    ctx.lineTo(cx - r, cy + r * 0.8);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = CHART_STYLE.card;
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  const diamond = (cx: number, cy: number, r: number, fill: string) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = CHART_STYLE.card;
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  // ── 3. Field: every other car in view, faint ──────────────────
  const field = state.fieldCars ?? [];
  ctx.strokeStyle = TRACE.field;
  ctx.lineWidth = 1;
  for (const cn of field) {
    if (cn === focusNum || compSet.has(cn)) continue;
    const cl = data.cars[String(cn)]?.laps;
    if (!cl || !cl.length) continue;
    if (tracePath(String(cn), cl)) ctx.stroke();
  }

  // ── 4. Compare cars: their own colour, with their pit stops ───
  // compareStroke: thin and soft for every car in view; a few picked cars stronger, with their
  // stops and end labels.
  const endLabels: Array<{ y: number; text: string; color: string }> = [];
  const nCompare = [...compSet].filter((n) => n !== focusNum).length;
  const many = nCompare > COMPARE_PALETTE.length;
  compSet.forEach((cn) => {
    if (cn === focusNum) return;
    const cnStr = String(cn);
    const cl = data.cars[cnStr]?.laps;
    if (!cl || !cl.length) return;
    const col = getCompColor(compSet, focusNum, cn);
    const cs = compareStroke(col, many);
    ctx.strokeStyle = cs.stroke;
    ctx.lineWidth = cs.width;
    if (tracePath(cnStr, cl)) ctx.stroke();
    if (many) return;
    for (const d of cl) {
      if (d.pit && d.l >= lapStart && d.l <= lapEnd) circle(xForCar(cnStr, d.l), y(d[pk]), 4.5, col);
    }
    const last = [...cl].reverse().find((d) => d.l <= lapEnd + 0.5);
    if (last && lapEnd >= maxLap - 0.5) endLabels.push({ y: y(last[pk]), text: "#" + carNo(data, cn), color: col });
  });

  // ── 5. Focus car: a dark halo under an orange line ────────────
  if (tracePath(focusNumStr, laps)) {
    ctx.strokeStyle = CHART_STYLE.card;
    ctx.lineWidth = 7;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.strokeStyle = TRACE.focus;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineJoin = "miter";
  }
  const focusLast = [...laps].reverse().find((d) => d.l <= lapEnd + 0.5);
  if (focusLast && lapEnd >= maxLap - 0.5) endLabels.push({ y: y(focusLast[pk]), text: "#" + carNo(data, focusNum), color: TRACE.focus });

  // ── 6. Focus car's stops: ● pit stop, ● orange garage, ▲ drive-through, ◆ penalty ──
  const pitByLap = new Map((ann.pits || []).map((p: PitMarker) => [p.l, p] as const));
  for (const d of laps) {
    if (d.l < lapStart || d.l > lapEnd) continue;
    if (!d.pit) continue; // markers without a pit lap (e.g. "Start · driver") are not stops
    const marker = pitByLap.get(d.l);
    const px = xForCar(focusNumStr, d.l);
    const py = y(d[pk]);
    if (marker?.pitTiming?.isDriveThrough) triangle(px, py, 7, TRACE.glyph);
    else circle(px, py, 6, marker?.isGarage ? TRACE.garage : TRACE.glyph);
  }
  for (const [lapStr, reason] of Object.entries(ann.reasons || {})) {
    const l = Number(lapStr);
    if (!(l >= lapStart && l <= lapEnd) || !/penalt|drive[- ]?through|stop[- ]?and[- ]?go|black flag/i.test(String(reason))) continue;
    const d = laps.find((q) => q.l === l);
    // Below the stop, or above it when the car is near the bottom of the chart.
    if (d) { const py = y(d[pk]); diamond(xForCar(focusNumStr, l), py + 16 > adjDim.MT + adjDim.CH - 4 ? py - 16 : py + 16, 6, TRACE.penalty); }
  }
  // ── 7. Selected lap: a light line, the focus car ringed, compare cars dotted ──
  if (activeLap !== null && activeLap >= lapStart && activeLap <= lapEnd) {
    const d = laps.find((l) => l.l === activeLap);
    if (d) {
      const ax = xForCar(focusNumStr, d.l);
      const ay = y(d[pk]);
      ctx.beginPath();
      ctx.strokeStyle = TRACE.selected;
      ctx.lineWidth = 1;
      ctx.moveTo(ax, adjDim.MT);
      ctx.lineTo(ax, adjDim.H - adjDim.MB);
      ctx.stroke();
      compSet.forEach((cn) => {
        if (cn === focusNum) return;
        const cd = data.cars[String(cn)]?.laps?.find((l) => l.l === activeLap);
        if (!cd) return;
        const cx2 = xAxisMode === "hours" ? ax : xForCar(String(cn), cd.l);
        circle(cx2, y(cd[pk]), 3.5, getCompColor(compSet, focusNum, cn), CHART_STYLE.card, 1.5);
      });
      ctx.beginPath();
      ctx.arc(ax, ay, 9, 0, Math.PI * 2);
      ctx.fillStyle = hexA(TRACE.focus, 0.25);
      ctx.fill();
      circle(ax, ay, 5, TRACE.focus, "#ffffff", 2);
    }
  }

  // ── 6b. Pit-cycle results: a leader from the lap where each cycle settled to its gain or loss ──
  drawSettleLeaders(ctx, {
    labels: settleLabels(ann.settles || [], laps, classView),
    x: (l) => xForCar(focusNumStr, l),
    y,
    lapStart,
    lapEnd,
    plotTop: adjDim.MT,
    plotBottom: adjDim.MT + adjDim.CH,
    plotLeft: adjDim.ML,
    plotRight: adjDim.W - adjDim.MR,
    background: CHART_STYLE.card,
  });

  // ── 8. Car numbers at the end of each highlighted trace (nudged apart) ──
  if (endLabels.length) {
    ctx.font = "600 11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    endLabels.sort((a, b) => a.y - b.y);
    let prevY = -Infinity;
    for (const lb of endLabels) {
      const ly = Math.max(lb.y + 4, prevY + 12);
      ctx.fillStyle = lb.color;
      ctx.fillText(lb.text, adjDim.W - adjDim.MR + 6, ly);
      prevY = ly;
    }
  }

  // ── 9. Axis labels ─────────────────────────────────────────────
  ctx.font = "500 11px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillStyle = TRACE.axis;
  ctx.textAlign = "right";
  for (let p = Math.max(gridYStart, yMin); p <= yMax; p += posStep) {
    ctx.fillText("P" + p, adjDim.ML - 8, y(p) + 4);
  }
  // Bottom axis: lap numbers, hour markers, or both
  const lapHours = computeLapElapsedHours(data);

  ctx.textAlign = "center";
  if (xAxisMode === "laps" || xAxisMode === "both") {
    ctx.font = "500 11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillStyle = TRACE.axis;
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
  ctx.font = "500 11px 'IBM Plex Sans', system-ui, sans-serif";
  ctx.fillStyle = TRACE.axis;
  ctx.textAlign = "center";
  ctx.fillText(axisLabel, adjDim.ML + adjDim.CW / 2, adjDim.H - 4);

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
          ? compNums.map((n) => "#" + carNo(data, n)).join(", ")
          : `${compNums.length} cars`;

      paceInfo = {
        focusTime: formatLapTime(d.lt),
        compAvg: secToStr(avg),
        delta,
        deltaColor,
        compLabel,
        compN: cnt,
      };
    } else {
      paceInfo = {
        focusTime: formatLapTime(d.lt),
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
        alsoPittingCars: marker.alsoPittingCars,
        kind: marker.kind,
        cycle: marker.cycle,
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

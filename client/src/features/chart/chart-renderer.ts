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

// ─── Coordinate mapping ──────────────────────────────────────────────────────

function xOf(lap: number, maxLap: number, dim: ChartDimensions): number {
  return dim.ML + ((lap - 1) / (maxLap - 1)) * dim.CW;
}

function yOf(pos: number, maxPos: number, dim: ChartDimensions): number {
  return dim.MT + ((pos - 1) / maxPos) * dim.CH;
}

export function lapOfX(x: number, maxLap: number, dim: ChartDimensions): number {
  return Math.round(((x - dim.ML) / dim.CW) * (maxLap - 1) + 1);
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
  maxLap: number,
  isMobile: boolean
): ChartDimensions {
  const minW = Math.max(1200, maxLap * 5);
  const W = containerW < minW ? minW : Math.floor(containerW);
  const H = Math.max(300, Math.floor(containerH));

  const ML = isMobile ? 40 : 50;
  const MR = isMobile ? 10 : 20;
  const MT = isMobile ? 40 : 60;
  const MB = isMobile ? 30 : 40;
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

  const { focusNum, compSet, activeLap, classView } = state;
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

  const x = (l: number) => xOf(l, maxLap, dim);
  const y = (p: number) => yOf(p, maxPos, dim);

  // ── 1. Grid ────────────────────────────────────────────────────
  ctx.strokeStyle = CHART_STYLE.gridLine;
  ctx.lineWidth = 0.5;
  const posStep = maxPos <= 20 ? 1 : maxPos <= 40 ? 2 : 5;
  for (let p = 1; p <= maxPos; p += posStep) {
    const py = y(p);
    ctx.beginPath();
    ctx.moveTo(dim.ML, py);
    ctx.lineTo(dim.W - dim.MR, py);
    ctx.stroke();
  }
  for (let l = 1; l <= maxLap; l += 10) {
    const lx = x(l);
    ctx.beginPath();
    ctx.moveTo(lx, dim.MT);
    ctx.lineTo(lx, dim.H - dim.MB);
    ctx.stroke();
  }

  // ── 2. FCY bands ───────────────────────────────────────────────
  (data.fcy || []).forEach(([s, e]) => {
    ctx.fillStyle = CHART_STYLE.fcyBand;
    ctx.fillRect(x(s - 0.4), dim.MT, x(e + 0.4) - x(s - 0.4), dim.CH);
  });

  // ── 3. Pit stop vertical lines ────────────────────────────────
  (ann.pits || []).forEach((p) => {
    const px = x(p.l);
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.strokeStyle = p.c;
    ctx.lineWidth = 1;
    ctx.moveTo(px, dim.MT);
    ctx.lineTo(px, dim.H - dim.MB);
    ctx.stroke();
    ctx.font = "500 9px system-ui";
    ctx.fillStyle = p.c;
    ctx.textAlign = "left";
    ctx.fillText(p.lb, px + 3, dim.MT + 10 + (p.yo || 0));
    ctx.restore();
  });

  // ── 4. Comparison car traces ───────────────────────────────────
  compSet.forEach((cn) => {
    if (cn === focusNum) return;
    const cl = data.cars[String(cn)]?.laps;
    if (!cl || !cl.length) return;
    const col = getCompColor(compSet, focusNum, cn);
    ctx.beginPath();
    ctx.strokeStyle = hexA(col, 0.28);
    ctx.lineWidth = 1.2;
    cl.forEach((d, i) => {
      const cx = x(d.l);
      const cy = y(d[pk]);
      if (i === 0) {
        ctx.moveTo(cx, cy);
      } else {
        ctx.lineTo(cx, y(cl[i - 1][pk]));
        ctx.lineTo(cx, cy);
      }
    });
    ctx.stroke();
  });

  // ── 5. Focus car position line ─────────────────────────────────
  const clsColor = CLASS_COLORS[focusCar.cls] || "#4472C4";
  ctx.beginPath();
  ctx.strokeStyle = clsColor;
  ctx.lineWidth = 2.5;
  laps.forEach((d, i) => {
    const lx = x(d.l);
    const ly = y(d[pk]);
    if (i === 0) {
      ctx.moveTo(lx, ly);
    } else {
      ctx.lineTo(lx, y(laps[i - 1][pk]));
      ctx.lineTo(lx, ly);
    }
  });
  ctx.stroke();

  // ── 6. Settle arrows ──────────────────────────────────────────
  const settlesByBucket: Record<number, number> = {};
  (ann.settles || []).forEach((sp) => {
    let settlePos = sp.p;
    if (classView) {
      const ld = laps.find((l) => l.l === sp.l);
      if (ld) settlePos = ld[pk];
      else return;
    }

    const bucket = Math.round(sp.l / 5);
    if (!settlesByBucket[bucket]) settlesByBucket[bucket] = 0;
    const yOff = settlesByBucket[bucket] * 28;
    settlesByBucket[bucket]++;

    const cx = x(sp.l);
    const cy = y(settlePos);
    const aL = 36 + yOff;

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
  });

  // ── 7. Pit dots ────────────────────────────────────────────────
  laps.forEach((d) => {
    if (d.pit) {
      const px = x(d.l);
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
  if (activeLap !== null) {
    const d = laps.find((l) => l.l === activeLap);
    if (d) {
      const ax = x(d.l);
      const ay = y(d[pk]);

      // Crosshair
      ctx.beginPath();
      ctx.strokeStyle = CHART_STYLE.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(ax, dim.MT);
      ctx.lineTo(ax, dim.H - dim.MB);
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
    ctx.fillText("P" + p, dim.ML - 6, y(p) + 4);
  }
  ctx.textAlign = "center";
  for (let l = 1; l <= maxLap; l += 10) {
    ctx.fillText(String(l), x(l), dim.H - dim.MB + 16);
  }
  ctx.font = "500 12px system-ui";
  ctx.fillStyle = CHART_STYLE.muted;
  ctx.textAlign = "center";
  ctx.fillText("Lap", dim.ML + dim.CW / 2, dim.H - 4);
  ctx.save();
  ctx.translate(14, dim.MT + dim.CH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(classView ? classView + " Position" : "Overall Position", 0, 0);
  ctx.restore();

  // ── 10. Watermark overlay ───────────────────────────────────────
  if (watermarkEmail) {
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
    const diagonal = Math.sqrt(dim.W * dim.W + dim.H * dim.H);
    const cols = Math.ceil(diagonal / spacing) + 2;
    const rows = Math.ceil(diagonal / lineHeight) + 2;

    ctx.translate(dim.W / 2, dim.H / 2);
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
  };
}

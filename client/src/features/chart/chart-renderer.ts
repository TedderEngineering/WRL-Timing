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

  // ── 3. Pit stop vertical lines (labels deferred to section 6) ─
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

  // ── 6. Unified collision-free labels (pit + settle) ──────────
  {
    interface LabelEntry {
      anchorX: number;
      anchorY: number;
      x: number;
      y: number;
      w: number;
      h: number;
      kind: "pit" | "settle";
      color: string;
      pitLabel?: string;
      settleLb?: string;
      settleSu?: string;
    }

    const PAD = 2;
    const labels: LabelEntry[] = [];

    // Collect pit labels
    (ann.pits || []).forEach((p) => {
      const px = x(p.l);
      ctx.font = "500 9px system-ui";
      const tw = ctx.measureText(p.lb).width;
      const th = 11;
      const lx = px + 3;
      const ly = dim.MT + 10 + (p.yo || 0) - th;
      labels.push({
        anchorX: px, anchorY: ly + th,
        x: lx - PAD, y: ly - PAD, w: tw + PAD * 2, h: th + PAD * 2,
        kind: "pit", color: p.c, pitLabel: p.lb,
      });
    });

    // Collect settle labels
    (ann.settles || []).forEach((sp) => {
      let settlePos = sp.p;
      if (classView) {
        const ld = laps.find((l) => l.l === sp.l);
        if (ld) settlePos = ld[pk];
        else return;
      }
      const cx = x(sp.l);
      const cy = y(settlePos);
      ctx.font = "700 10px system-ui";
      const w1 = ctx.measureText(sp.lb).width;
      ctx.font = "500 9px system-ui";
      const w2 = ctx.measureText(sp.su).width;
      const tw = Math.max(w1, w2);
      const th = 24; // two lines: 12px each
      const lx = cx - tw / 2;
      const ly = cy - 36 - th; // base arrow length 36
      labels.push({
        anchorX: cx, anchorY: cy,
        x: lx - PAD, y: ly - PAD, w: tw + PAD * 2, h: th + PAD * 2,
        kind: "settle", color: sp.c, settleLb: sp.lb, settleSu: sp.su,
      });
    });

    // Sort by X for spatial locality
    labels.sort((a, b) => a.x - b.x);

    // Collision resolver — push overlapping labels apart vertically
    const overlaps = (a: LabelEntry, b: LabelEntry) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          if (!overlaps(labels[i], labels[j])) continue;
          const overlapY = Math.min(labels[i].y + labels[i].h, labels[j].y + labels[j].h) -
                           Math.max(labels[i].y, labels[j].y);
          const nudge = overlapY / 2 + 2;
          // Push apart: earlier label up, later label down
          labels[i].y -= nudge;
          labels[j].y += nudge;
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Clamp within chart bounds
    for (const lb of labels) {
      lb.y = Math.max(dim.MT - lb.h, Math.min(dim.H - dim.MB - 2, lb.y));
      lb.x = Math.max(dim.ML, Math.min(dim.W - dim.MR - lb.w, lb.x));
    }

    // Render
    for (const lb of labels) {
      ctx.save();
      if (lb.kind === "pit") {
        ctx.font = "500 9px system-ui";
        ctx.fillStyle = lb.color;
        ctx.textAlign = "left";
        ctx.fillText(lb.pitLabel!, lb.x + PAD, lb.y + PAD + 11);
      } else {
        // Dot
        ctx.beginPath();
        ctx.arc(lb.anchorX, lb.anchorY, 4, 0, Math.PI * 2);
        ctx.fillStyle = lb.color;
        ctx.fill();
        ctx.strokeStyle = CHART_STYLE.bg;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Arrow shaft (dynamic length to resolved label position)
        const shaftTop = lb.y + lb.h + PAD + 3;
        ctx.beginPath();
        ctx.strokeStyle = lb.color;
        ctx.lineWidth = 1.5;
        ctx.moveTo(lb.anchorX, lb.anchorY - 6);
        ctx.lineTo(lb.anchorX, shaftTop);
        ctx.stroke();
        // Arrow head
        ctx.beginPath();
        ctx.fillStyle = lb.color;
        ctx.moveTo(lb.anchorX, lb.anchorY - 4);
        ctx.lineTo(lb.anchorX - 3.5, lb.anchorY - 11);
        ctx.lineTo(lb.anchorX + 3.5, lb.anchorY - 11);
        ctx.closePath();
        ctx.fill();
        // Labels
        const textCx = lb.x + PAD + lb.w / 2 - PAD;
        ctx.textAlign = "center";
        ctx.font = "700 10px system-ui";
        ctx.fillStyle = "#fff";
        ctx.fillText(lb.settleLb!, textCx, lb.y + PAD + 10);
        ctx.font = "500 9px system-ui";
        ctx.fillStyle = lb.color;
        ctx.fillText(lb.settleSu!, textCx, lb.y + PAD + 22);
      }
      ctx.restore();
    }
  }

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

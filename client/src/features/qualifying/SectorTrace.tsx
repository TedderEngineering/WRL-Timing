import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { CHART_STYLE, COMP_PALETTE } from "../chart/constants";
import type { QualifyingChartData, QualifyingCar } from "@shared/types";

type ViewMode = "rank" | "personal" | "laptime";

interface SectorTraceProps {
  data: QualifyingChartData;
  compSet: Set<string>;
  classView: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCarColor(cars: QualifyingCar[], carNum: string): string {
  const idx = cars.findIndex((c) => c.num === carNum);
  if (idx < 0) return "#888";
  return COMP_PALETTE[idx % COMP_PALETTE.length];
}

interface Dimensions {
  W: number;
  H: number;
  ML: number;
  MR: number;
  MT: number;
  MB: number;
  CW: number;
  CH: number;
}

function computeDim(w: number, h: number): Dimensions {
  const W = Math.max(300, Math.floor(w));
  const H = Math.max(250, Math.floor(h));
  const ML = 50;
  const MR = 20;
  const MT = 30;
  const MB = 40;
  return { W, H, ML, MR, MT, MB, CW: W - ML - MR, CH: H - MT - MB };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SectorTrace({ data, compSet, classView }: SectorTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState<Dimensions | null>(null);
  const [mode, setMode] = useState<ViewMode>("rank");

  // Filter visible cars
  const cars = useMemo(() => {
    return data.cars.filter((c) => {
      if (!compSet.has(c.num)) return false;
      if (classView && c.cls !== classView) return false;
      return c.laps.length > 0;
    });
  }, [data, compSet, classView]);

  // ── Resize ──────────────────────────────────────────────────────
  const resize = useCallback(() => {
    if (!wrapperRef.current) return null;
    const d = computeDim(wrapperRef.current.clientWidth, wrapperRef.current.clientHeight);
    setDim(d);
    return d;
  }, []);

  useEffect(() => {
    const d = resize();
    if (d) setDim(d);
    const onResize = () => { const d2 = resize(); if (d2) setDim(d2); };
    window.addEventListener("resize", onResize);
    const ro = wrapperRef.current ? new ResizeObserver(onResize) : undefined;
    if (wrapperRef.current && ro) ro.observe(wrapperRef.current);
    return () => { window.removeEventListener("resize", onResize); ro?.disconnect(); };
  }, [resize]);

  // ── Draw ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const d = dim;
    if (!canvas || !d || cars.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = d.W * dpr;
    canvas.height = d.H * dpr;
    canvas.style.width = d.W + "px";
    canvas.style.height = d.H + "px";

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, d.W, d.H);

    if (mode === "laptime") {
      drawLapTimeView(ctx, d, cars);
    } else if (mode === "personal") {
      drawPersonalBestView(ctx, d, cars);
    } else {
      drawRankView(ctx, d, cars);
    }
  }, [dim, cars, mode]);

  // ── Rank view: sector-by-sector ranking ─────────────────────────
  function drawRankView(ctx: CanvasRenderingContext2D, d: Dimensions, cars: QualifyingCar[]) {
    // Find max laps across selected cars
    const maxLaps = Math.max(...cars.map((c) => c.laps.length));
    const totalSectors = maxLaps * 3;
    if (totalSectors === 0) return;

    const maxPos = cars.length;

    const x = (si: number) => d.ML + (si / (totalSectors - 1 || 1)) * d.CW;
    const y = (rank: number) => d.MT + ((rank - 1) / (maxPos - 1 || 1)) * d.CH;

    // Compute ranks at each sector index
    // sectorIndex 0 = lap1 S1, 1 = lap1 S2, 2 = lap1 S3, 3 = lap2 S1, ...
    const ranks = new Map<string, number[]>(); // carNum → rank per sector index
    for (const car of cars) ranks.set(car.num, []);

    for (let si = 0; si < totalSectors; si++) {
      const lapIdx = Math.floor(si / 3);
      const sectorIdx = si % 3; // 0=S1, 1=S2, 2=S3

      const times: { num: string; time: number }[] = [];
      for (const car of cars) {
        if (lapIdx >= car.laps.length) continue;
        const lap = car.laps[lapIdx];
        const t = sectorIdx === 0 ? lap.s1 : sectorIdx === 1 ? lap.s2 : lap.s3;
        if (t > 0) times.push({ num: car.num, time: t });
      }

      times.sort((a, b) => a.time - b.time);
      const rankMap = new Map<string, number>();
      times.forEach((t, i) => rankMap.set(t.num, i + 1));

      for (const car of cars) {
        const r = rankMap.get(car.num);
        ranks.get(car.num)!.push(r ?? 0); // 0 = no data
      }
    }

    // Draw grid
    drawGrid(ctx, d, totalSectors, maxPos, "Sector Index", "Rank", (si) => {
      const lapNum = Math.floor(si / 3) + 1;
      const sec = (si % 3) + 1;
      return `L${lapNum}S${sec}`;
    });

    // Draw sector separators (vertical lines between laps)
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let lap = 1; lap < maxLaps; lap++) {
      const sx = x(lap * 3 - 0.5);
      ctx.beginPath();
      ctx.moveTo(sx, d.MT);
      ctx.lineTo(sx, d.MT + d.CH);
      ctx.stroke();
    }

    // Draw traces
    for (const car of cars) {
      const carRanks = ranks.get(car.num)!;
      const col = getCarColor(cars, car.num);

      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      let started = false;
      for (let si = 0; si < carRanks.length; si++) {
        if (carRanks[si] === 0) continue;
        const px = x(si);
        const py = y(carRanks[si]);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Dots
      for (let si = 0; si < carRanks.length; si++) {
        if (carRanks[si] === 0) continue;
        ctx.beginPath();
        ctx.arc(x(si), y(carRanks[si]), 2.5, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
      }
    }

    drawLegend(ctx, d, cars);
  }

  // ── Personal Best view: delta from own best per sector ──────────
  function drawPersonalBestView(ctx: CanvasRenderingContext2D, d: Dimensions, cars: QualifyingCar[]) {
    const maxLaps = Math.max(...cars.map((c) => c.laps.length));
    const totalSectors = maxLaps * 3;
    if (totalSectors === 0) return;

    // Compute deltas
    const deltas = new Map<string, number[]>();
    let maxDelta = 0;

    for (const car of cars) {
      const carDeltas: number[] = [];
      for (let si = 0; si < totalSectors; si++) {
        const lapIdx = Math.floor(si / 3);
        const sectorIdx = si % 3;
        if (lapIdx >= car.laps.length) { carDeltas.push(NaN); continue; }
        const lap = car.laps[lapIdx];
        const t = sectorIdx === 0 ? lap.s1 : sectorIdx === 1 ? lap.s2 : lap.s3;
        const best = sectorIdx === 0 ? car.bestS1 : sectorIdx === 1 ? car.bestS2 : car.bestS3;
        if (t <= 0 || best <= 0) { carDeltas.push(NaN); continue; }
        const delta = t - best;
        carDeltas.push(delta);
        if (delta > maxDelta) maxDelta = delta;
      }
      deltas.set(car.num, carDeltas);
    }

    maxDelta = Math.max(maxDelta, 0.5); // minimum range

    const x = (si: number) => d.ML + (si / (totalSectors - 1 || 1)) * d.CW;
    const y = (delta: number) => d.MT + (delta / maxDelta) * d.CH;

    // Grid
    drawGrid(ctx, d, totalSectors, 0, "Sector Index", "Delta (s)", (si) => {
      const lapNum = Math.floor(si / 3) + 1;
      const sec = (si % 3) + 1;
      return `L${lapNum}S${sec}`;
    });

    // Y-axis labels for delta
    ctx.font = "500 10px monospace";
    ctx.fillStyle = CHART_STYLE.muted;
    ctx.textAlign = "right";
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const val = (maxDelta / steps) * i;
      const py = y(val);
      ctx.fillText(val.toFixed(1) + "s", d.ML - 6, py + 4);
      ctx.beginPath();
      ctx.strokeStyle = CHART_STYLE.gridLine;
      ctx.lineWidth = 0.5;
      ctx.moveTo(d.ML, py);
      ctx.lineTo(d.W - d.MR, py);
      ctx.stroke();
    }

    // Traces
    for (const car of cars) {
      const carDeltas = deltas.get(car.num)!;
      const col = getCarColor(cars, car.num);

      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      let started = false;
      for (let si = 0; si < carDeltas.length; si++) {
        if (isNaN(carDeltas[si])) continue;
        const px = x(si);
        const py = y(carDeltas[si]);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      for (let si = 0; si < carDeltas.length; si++) {
        if (isNaN(carDeltas[si])) continue;
        ctx.beginPath();
        ctx.arc(x(si), y(carDeltas[si]), 2.5, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
      }
    }

    drawLegend(ctx, d, cars);
  }

  // ── Lap Time view: rank by overall lap time ─────────────────────
  function drawLapTimeView(ctx: CanvasRenderingContext2D, d: Dimensions, cars: QualifyingCar[]) {
    const maxLaps = Math.max(...cars.map((c) => c.laps.length));
    if (maxLaps === 0) return;

    const maxPos = cars.length;

    const x = (lap: number) => d.ML + ((lap - 1) / (maxLaps - 1 || 1)) * d.CW;
    const y = (rank: number) => d.MT + ((rank - 1) / (maxPos - 1 || 1)) * d.CH;

    // Compute ranks per lap
    const ranks = new Map<string, number[]>();
    for (const car of cars) ranks.set(car.num, []);

    for (let li = 0; li < maxLaps; li++) {
      const times: { num: string; time: number }[] = [];
      for (const car of cars) {
        if (li >= car.laps.length) continue;
        const t = car.laps[li].ltSec;
        if (t > 0) times.push({ num: car.num, time: t });
      }
      times.sort((a, b) => a.time - b.time);
      const rankMap = new Map<string, number>();
      times.forEach((t, i) => rankMap.set(t.num, i + 1));

      for (const car of cars) {
        ranks.get(car.num)!.push(rankMap.get(car.num) ?? 0);
      }
    }

    // Grid
    drawGrid(ctx, d, maxLaps, maxPos, "Lap", "Rank", (i) => String(i + 1));

    // Traces
    for (const car of cars) {
      const carRanks = ranks.get(car.num)!;
      const col = getCarColor(cars, car.num);

      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      let started = false;
      for (let li = 0; li < carRanks.length; li++) {
        if (carRanks[li] === 0) continue;
        const px = x(li + 1);
        const py = y(carRanks[li]);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      for (let li = 0; li < carRanks.length; li++) {
        if (carRanks[li] === 0) continue;
        ctx.beginPath();
        ctx.arc(x(li + 1), y(carRanks[li]), 3, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
      }
    }

    drawLegend(ctx, d, cars);
  }

  // ── Shared grid drawing ─────────────────────────────────────────
  function drawGrid(
    ctx: CanvasRenderingContext2D,
    d: Dimensions,
    xCount: number,
    yMax: number,
    xLabel: string,
    yLabel: string,
    xTickLabel: (i: number) => string
  ) {
    // Y-axis grid and labels (rank mode)
    if (yMax > 0) {
      ctx.font = "500 10px monospace";
      ctx.fillStyle = CHART_STYLE.muted;
      ctx.textAlign = "right";
      const posStep = yMax <= 15 ? 1 : yMax <= 30 ? 2 : 5;
      for (let p = 1; p <= yMax; p += posStep) {
        const py = d.MT + ((p - 1) / (yMax - 1 || 1)) * d.CH;
        ctx.fillText("P" + p, d.ML - 6, py + 4);
        ctx.beginPath();
        ctx.strokeStyle = CHART_STYLE.gridLine;
        ctx.lineWidth = 0.5;
        ctx.moveTo(d.ML, py);
        ctx.lineTo(d.W - d.MR, py);
        ctx.stroke();
      }
    }

    // X-axis labels
    ctx.font = "500 9px monospace";
    ctx.fillStyle = CHART_STYLE.muted;
    ctx.textAlign = "center";
    const step = xCount <= 15 ? 1 : xCount <= 40 ? 3 : 6;
    for (let i = 0; i < xCount; i += step) {
      const px = d.ML + (i / (xCount - 1 || 1)) * d.CW;
      ctx.fillText(xTickLabel(i), px, d.H - d.MB + 14);
    }

    // Axis titles
    ctx.font = "500 12px system-ui";
    ctx.fillStyle = CHART_STYLE.muted;
    ctx.textAlign = "center";
    ctx.fillText(xLabel, d.ML + d.CW / 2, d.H - 4);
    ctx.save();
    ctx.translate(14, d.MT + d.CH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }

  // ── Legend ───────────────────────────────────────────────────────
  function drawLegend(ctx: CanvasRenderingContext2D, d: Dimensions, cars: QualifyingCar[]) {
    ctx.font = "500 9px system-ui";
    ctx.textAlign = "left";
    let lx = d.ML + 4;
    const ly = d.MT - 8;

    for (const car of cars) {
      const col = getCarColor(cars, car.num);
      const label = `#${car.num}`;
      const tw = ctx.measureText(label).width;

      if (lx + tw + 16 > d.W - d.MR) break; // stop if overflow

      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + 10, ly);
      ctx.stroke();

      ctx.fillStyle = col;
      ctx.fillText(label, lx + 13, ly + 3);
      lx += tw + 24;
    }
  }

  const modeLabels: { id: ViewMode; label: string }[] = [
    { id: "rank", label: "Sector Rank" },
    { id: "personal", label: "vs Personal Best" },
    { id: "laptime", label: "Lap Time Rank" },
  ];

  return (
    <div className="flex flex-col gap-1">
      {/* Mode toggle */}
      <div className="flex items-center gap-1 px-1">
        <span className="text-[11px] uppercase tracking-wider font-semibold mr-1" style={{ color: "#cbd5e1" }}>
          View
        </span>
        {modeLabels.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className="px-2.5 py-0.5 rounded-xl text-[11px] border transition-all cursor-pointer"
            style={{
              background: mode === m.id ? "#4472C4" : CHART_STYLE.card,
              borderColor: mode === m.id ? "#4472C4" : CHART_STYLE.border,
              color: mode === m.id ? "#fff" : CHART_STYLE.muted,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div
        ref={wrapperRef}
        className="rounded-lg border overflow-hidden"
        style={{
          background: CHART_STYLE.card,
          borderColor: CHART_STYLE.border,
          height: "calc(100vh - 420px)",
          minHeight: 280,
        }}
      >
        <canvas ref={canvasRef} style={{ display: "block" }} />
      </div>
    </div>
  );
}

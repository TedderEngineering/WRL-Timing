import type { LapData, PitMarker } from "@shared/types";
import { TRACE } from "./constants";

/** Positions before and after one stop: `delta` > 0 is places gained. */
export interface PitDelta {
  lap: number;
  before: number;
  after: number;
  delta: number;
}

/** "Jane Q. Estep" → "ESTEP"; the chart shows surnames, like the timing sheets. */
export function surname(name: string | undefined): string | undefined {
  const parts = name?.trim().split(/\s+/).filter(Boolean);
  return parts?.length ? parts[parts.length - 1].toUpperCase() : undefined;
}

/**
 * Places gained or lost at each stop: the position on the lap before the stop against the first
 * green lap after it (within ten laps; failing that, the first lap without a stop), the same rule
 * the "settled" markers use.
 */
export function pitDeltas(laps: LapData[], pk: "p" | "cp", fcy: [number, number][] = []): PitDelta[] {
  const yellow = (l: number) => fcy.some(([s, e]) => l >= s && l <= e);
  const out: PitDelta[] = [];
  for (let i = 1; i < laps.length; i++) {
    if (!laps[i].pit) continue;
    let after: LapData | undefined;
    for (let j = i + 1; j < laps.length && j <= i + 10 && !after; j++) if (!laps[j].pit && !yellow(laps[j].l)) after = laps[j];
    for (let j = i + 1; j < laps.length && j <= i + 6 && !after; j++) if (!laps[j].pit) after = laps[j];
    if (!after) continue;
    const before = laps[i - 1][pk];
    out.push({ lap: laps[i].l, before, after: after[pk], delta: before - after[pk] });
  }
  return out;
}

export function deltaText(d: number): string {
  return d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : "±0";
}

/** Space above the plot for the pit tags (computeDimensions `pitTags`). */
export interface PitTagBand {
  tagY: number;
  laneH: number;
  lanes: number;
}

export function pitTagBand(isMobile: boolean): PitTagBand {
  return isMobile ? { tagY: 2, laneH: 13, lanes: 2 } : { tagY: 3, laneH: 15, lanes: 2 };
}

function rgba(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * The focus car's pit and driver tags, the same on Position Trace and Lap Times: a thin line in
 * the tag's colour at each stop (and the start) through the plot, and its label ("Pit 2 ·
 * WEISENBERG", "Start · GOODMAN") above the plot with the places gained or lost at that stop.
 * Labels go in two lanes so neighbours never overlap and nothing is written over the traces.
 */
export function drawPitTags(
  ctx: CanvasRenderingContext2D,
  o: {
    markers: PitMarker[];
    laps: LapData[];
    pk: "p" | "cp";
    fcy: [number, number][];
    x: (lap: number) => number;
    lapStart: number;
    lapEnd: number;
    plotLeft: number;
    plotRight: number;
    plotTop: number;
    plotBottom: number;
    band: PitTagBand;
    activeLap: number | null;
    /** The chart's background, behind each label. */
    background: string;
  }
) {
  const deltas = new Map(pitDeltas(o.laps, o.pk, o.fcy).map((d) => [d.lap, d] as const));
  const small = o.band.laneH < 15;
  const font = `600 ${small ? 9 : 10}px 'IBM Plex Sans', system-ui, sans-serif`;
  const lastRight = Array.from({ length: o.band.lanes }, () => -Infinity);
  const markers = [...o.markers].filter((m) => m.l >= o.lapStart && m.l <= o.lapEnd).sort((a, b) => a.l - b.l);
  const placed: { m: PitMarker; label: string; px: number; left: number; w: number; wLabel: number; cy: number; color: string; d?: PitDelta; delta: string }[] = [];
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = "middle";
  for (const m of markers) {
    const px = o.x(m.l);
    if (px < o.plotLeft - 1 || px > o.plotRight + 1) continue;
    const color = m.c || TRACE.fcyBar;
    const d = deltas.get(m.l);
    const delta = d ? ` ${deltaText(d.delta)}` : "";
    // Where tags crowd, the driver's name gives way first ("Pit 3 · ESTEP" → "Pit 3"), then the tag moves along.
    const place = (label: string) => {
      const wLabel = ctx.measureText(label).width;
      const w = wLabel + ctx.measureText(delta).width;
      // Left-aligned after the line, as on Lap Times; right-aligned before it near the right edge.
      let left = px + 3;
      if (left + w > o.plotRight) left = px - 3 - w;
      return { label, wLabel, w, left, lane: lastRight.findIndex((r) => r < left - 6) };
    };
    let pl = place(m.lb);
    const short = m.lb.replace(/\s*·.*$/, "");
    if (pl.lane < 0 && short !== m.lb) pl = place(short);
    let { left, lane } = pl;
    const { label, wLabel, w } = pl;
    if (lane < 0) {
      // Every lane is taken here: use the one that frees first and start after its label.
      lane = lastRight.indexOf(Math.min(...lastRight));
      left = lastRight[lane] + 6;
    }
    lastRight[lane] = left + w;
    const cy = o.band.tagY + lane * o.band.laneH + o.band.laneH / 2;
    placed.push({ m, label, px, left, w, wLabel, cy, color, d, delta });
  }

  // Lines first, then the labels on a backing, so a line never runs through a label.
  for (const t of placed) {
    ctx.strokeStyle = rgba(t.color, 0.75);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(t.px) + 0.5, t.cy + o.band.laneH / 2 - 2);
    ctx.lineTo(Math.round(t.px) + 0.5, o.plotBottom);
    ctx.stroke();
  }
  for (const t of placed) {
    const box = [t.left - 3, t.cy - o.band.laneH / 2 + 1, t.w + 6, o.band.laneH - 2] as const;
    ctx.fillStyle = o.background;
    ctx.fillRect(...box);
    if (o.activeLap === t.m.l) {
      ctx.fillStyle = rgba(t.color, 0.22);
      ctx.fillRect(...box);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = t.color;
    ctx.fillText(t.label, t.left, t.cy);
    if (t.d) {
      ctx.fillStyle = t.d.delta > 0 ? TRACE.gain : t.d.delta < 0 ? TRACE.loss : TRACE.axis;
      ctx.fillText(t.delta, t.left + t.wLabel, t.cy);
    }
  }
  ctx.restore();
}

import type { LapData, PitMarker, SettleMarker } from "@shared/types";
import { TRACE } from "./constants";

/** "Jane Q. Estep" → "ESTEP"; the chart shows surnames, like the timing sheets. */
export function surname(name: string | undefined): string | undefined {
  const parts = name?.trim().split(/\s+/).filter(Boolean);
  return parts?.length ? parts[parts.length - 1].toUpperCase() : undefined;
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
 * WEISENBERG", "Start · GOODMAN") above the plot. Places gained or lost belong to the pit cycle,
 * not the stop: drawSettleLeaders marks them where the cycle settled.
 * Labels go in two lanes so neighbours never overlap and nothing is written over the traces.
 */
export function drawPitTags(
  ctx: CanvasRenderingContext2D,
  o: {
    markers: PitMarker[];
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
  const small = o.band.laneH < 15;
  const font = `600 ${small ? 9 : 10}px 'IBM Plex Sans', system-ui, sans-serif`;
  const lastRight = Array.from({ length: o.band.lanes }, () => -Infinity);
  const markers = [...o.markers].filter((m) => m.l >= o.lapStart && m.l <= o.lapEnd).sort((a, b) => a.l - b.l);
  const placed: { m: PitMarker; label: string; px: number; left: number; w: number; cy: number; color: string }[] = [];
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = "middle";
  for (const m of markers) {
    const px = o.x(m.l);
    if (px < o.plotLeft - 1 || px > o.plotRight + 1) continue;
    const color = m.c || TRACE.fcyBar;
    // Where tags crowd, the driver's name gives way first ("Pit 3 · ESTEP" → "Pit 3"), then the tag moves along.
    const place = (label: string) => {
      const wLabel = ctx.measureText(label).width;
      const w = wLabel;
      // Left-aligned after the line, as on Lap Times; right-aligned before it near the right edge.
      let left = px + 3;
      if (left + w > o.plotRight) left = px - 3 - w;
      return { label, wLabel, w, left, lane: lastRight.findIndex((r) => r < left - 6) };
    };
    let pl = place(m.lb);
    const short = m.lb.replace(/\s*·.*$/, "");
    if (pl.lane < 0 && short !== m.lb) pl = place(short);
    let { left, lane } = pl;
    const { label, w } = pl;
    if (lane < 0) {
      // Every lane is taken here: use the one that frees first and start after its label.
      lane = lastRight.indexOf(Math.min(...lastRight));
      left = lastRight[lane] + 6;
    }
    lastRight[lane] = left + w;
    const cy = o.band.tagY + lane * o.band.laneH + o.band.laneH / 2;
    placed.push({ m, label, px, left, w, cy, color });
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
  }
  ctx.restore();
}

export interface SettleLabel {
  lap: number;
  pos: number;
  /** "Settled P12" (class position in a class view). */
  title: string;
  /** "Was P5 · Lost 7". */
  sub: string;
  color: string;
}

/**
 * A pit cycle's result in class positions: from the analysis package (cpBefore / cpAfter), else
 * worked out from the laps: the class position on the last lap before the stop where the car held
 * its pre-cycle overall position ("Was P5"), and the class position on the settle lap. Null when
 * neither is known. Every panel that shows a pit cycle reads it through this (the card's server
 * copy: dashboard/my-car.ts classPitCycles).
 */
export function classCycle(sp: SettleMarker, laps: LapData[]): { before: number; after: number; net: number } | null {
  if (typeof sp.cpBefore === "number" && typeof sp.cpAfter === "number") return { before: sp.cpBefore, after: sp.cpAfter, net: sp.cpBefore - sp.cpAfter };
  const at = laps.find((l) => l.l === sp.l);
  const was = Number(/Was P(\d+)/.exec(sp.su)?.[1]);
  const stop = [...laps].reverse().find((l) => l.l < sp.l && l.pit === 1);
  const before = stop && Number.isFinite(was) ? [...laps].reverse().find((l) => l.l < stop.l && l.p === was) : undefined;
  return at && before ? { before: before.cp, after: at.cp, net: before.cp - at.cp } : null;
}

const netText = (net: number) => (net > 0 ? `Gained ${net}` : net < 0 ? `Lost ${-net}` : "Held");
const netColor = (net: number) => (net > 0 ? TRACE.gain : net < 0 ? TRACE.loss : "#888888");

/**
 * Each pit cycle's result for the chart. A pit cycle is a class's: its places are always class
 * places, in every view, so the chart says what the car's card, Lap details and the Pit Stops tab
 * say. Overall places over a cycle are not its result (other classes' cars are part way through
 * their own cycles), so the overall view only adds where the car settled overall, beside the
 * class result, and draws the leader to that point on its overall line. A cycle with no class
 * positions (an old import without them) keeps the import's overall wording.
 */
export function settleLabels(settles: SettleMarker[], laps: LapData[], classView: string, cls = ""): SettleLabel[] {
  const out: SettleLabel[] = [];
  const inClass = classView || cls;
  for (const sp of settles) {
    const at = laps.find((l) => l.l === sp.l);
    const c = classCycle(sp, laps);
    if (c && inClass) {
      out.push({
        lap: sp.l,
        pos: classView ? c.after : sp.p,
        title: `Settled P${c.after} in ${inClass}${classView ? "" : ` · P${sp.p} overall`}`,
        sub: `Was P${c.before} · ${netText(c.net)}${sp.open ? " · not completed" : ""}`,
        color: netColor(c.net),
      });
      continue;
    }
    if (!classView) {
      out.push({ lap: sp.l, pos: sp.p, title: sp.lb, sub: sp.su, color: sp.c });
      continue;
    }
    if (at) out.push({ lap: sp.l, pos: at.cp, title: `Settled P${at.cp} in ${classView}`, sub: `${sp.su} (overall)`, color: sp.c });
  }
  return out;
}

/**
 * A leader from the lap where each pit cycle settled up to a label with the gain or loss, as the
 * RaceTrace chart always drew them; labels stack so they never cover each other, and flip below
 * the point near the top of the chart.
 */
export function drawSettleLeaders(
  ctx: CanvasRenderingContext2D,
  o: {
    labels: SettleLabel[];
    x: (lap: number) => number;
    y: (pos: number) => number;
    lapStart: number;
    lapEnd: number;
    plotTop: number;
    plotBottom: number;
    plotLeft: number;
    plotRight: number;
    background: string;
  }
) {
  const BOX_H = 30;
  const STEP = 32;
  const ARROW = 34;
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const hits = (bx: number, by: number, w: number) =>
    by < o.plotTop || by + BOX_H > o.plotBottom || placed.some((p) => bx < p.x + p.w && bx + w > p.x && by < p.y + p.h && by + BOX_H > p.y);
  ctx.save();
  const items = o.labels.filter((l) => l.lap >= o.lapStart && l.lap <= o.lapEnd).map((l) => ({ ...l, cx: o.x(l.lap), cy: o.y(l.pos) })).sort((a, b) => a.cx - b.cx);
  for (const it of items) {
    ctx.font = "700 11px 'IBM Plex Sans', system-ui, sans-serif";
    const w1 = ctx.measureText(it.title).width;
    ctx.font = "500 10px 'IBM Plex Sans', system-ui, sans-serif";
    const w = Math.max(w1, ctx.measureText(it.sub).width) + 12;
    const bx = Math.min(o.plotRight - w, Math.max(o.plotLeft, it.cx - w / 2));
    // Above the point, stacked up past other labels; below it when there is no room above.
    let off = 0;
    let up = true;
    while (hits(bx, it.cy - ARROW - off - BOX_H, w) && off <= 200) off += STEP;
    if (off > 200 || it.cy - ARROW - off - BOX_H < o.plotTop) {
      up = false;
      off = 0;
      while (hits(bx, it.cy + ARROW + off, w) && off <= 200) off += STEP;
    }
    const by = up ? it.cy - ARROW - off - BOX_H : it.cy + ARROW + off;
    placed.push({ x: bx, y: by, w, h: BOX_H });

    // Leader from the label to the point, arrowhead at the point
    const tip = up ? it.cy - 6 : it.cy + 6;
    const end = up ? by + BOX_H : by;
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(it.cx, end);
    ctx.lineTo(it.cx, tip);
    ctx.stroke();
    ctx.fillStyle = it.color;
    ctx.beginPath();
    ctx.moveTo(it.cx, up ? it.cy - 4 : it.cy + 4);
    ctx.lineTo(it.cx - 3.5, up ? it.cy - 11 : it.cy + 11);
    ctx.lineTo(it.cx + 3.5, up ? it.cy - 11 : it.cy + 11);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(it.cx, it.cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = o.background;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label box
    ctx.fillStyle = o.background;
    ctx.strokeStyle = rgba(it.color, 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, BOX_H, 4);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 11px 'IBM Plex Sans', system-ui, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(it.title, bx + w / 2, by + 13);
    ctx.font = "500 10px 'IBM Plex Sans', system-ui, sans-serif";
    ctx.fillStyle = it.color;
    ctx.fillText(it.sub, bx + w / 2, by + 25);
  }
  ctx.restore();
}

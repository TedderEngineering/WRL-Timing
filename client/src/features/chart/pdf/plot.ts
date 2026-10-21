/** A lap-axis chart on a PDF page: the frame, lap ticks, caution bands, and polylines. */
import type { jsPDF as JsPDF } from "jspdf";
import { C, fill, ink, niceStep, stroke, type RGB } from "./kit";

export interface Plot {
  x: number;
  y: number;
  w: number;
  h: number;
  lapMin: number;
  lapMax: number;
  /** Value at the top and bottom edges (positions: 1 at the top; times: fastest at the top). */
  vTop: number;
  vBottom: number;
}

export const px = (p: Plot, lap: number) => p.x + ((lap - p.lapMin) / Math.max(1, p.lapMax - p.lapMin)) * p.w;
export const py = (p: Plot, v: number) => p.y + ((v - p.vTop) / (p.vBottom - p.vTop || 1)) * p.h;

/** The frame, caution bands (shaded under everything), lap ticks along the bottom. */
export function drawFrame(doc: JsPDF, p: Plot, fcy: [number, number][], yTicks: { v: number; label: string }[], yTitle: string): void {
  doc.setFillColor(255, 255, 255);
  doc.rect(p.x, p.y, p.w, p.h, "F");
  for (const [a, b] of fcy) {
    if (b < p.lapMin || a > p.lapMax) continue;
    doc.setFillColor(254, 243, 199);
    const x0 = px(p, Math.max(p.lapMin, a - 0.5));
    doc.rect(x0, p.y, Math.max(1, px(p, Math.min(p.lapMax, b + 0.5)) - x0), p.h, "F");
  }
  stroke(doc, C.grid);
  doc.setLineWidth(0.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  ink(doc, C.muted);
  for (const t of yTicks) {
    const y = py(p, t.v);
    doc.line(p.x, y, p.x + p.w, y);
    doc.text(t.label, p.x - 4, y + 2.4, { align: "right" });
  }
  const step = niceStep(p.lapMax - p.lapMin, 12, [1, 2, 5, 10, 20, 25, 50, 100]);
  for (let l = Math.ceil(p.lapMin / step) * step; l <= p.lapMax; l += step) {
    const x = px(p, l);
    doc.line(x, p.y, x, p.y + p.h);
    doc.text(String(l), x, p.y + p.h + 9, { align: "center" });
  }
  stroke(doc, C.range);
  doc.setLineWidth(0.8);
  doc.rect(p.x, p.y, p.w, p.h, "S");
  doc.text("Lap", p.x + p.w, p.y + p.h + 18, { align: "right" });
  doc.text(yTitle, p.x, p.y - 4);
}

/** A polyline through points, broken where a point is null. */
export function polyline(doc: JsPDF, pts: ([number, number] | null)[], color: RGB, width: number): void {
  stroke(doc, color);
  doc.setLineWidth(width);
  doc.setLineJoin("round");
  doc.setLineCap("round");
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length >= 2) {
      const [x0, y0] = run[0];
      doc.lines(run.slice(1).map(([x, y], i) => [x - run[i][0], y - run[i][1]]), x0, y0, [1, 1], "S", false);
    } else if (run.length === 1) {
      fill(doc, color);
      doc.circle(run[0][0], run[0][1], width * 0.6, "F");
    }
    run = [];
  };
  for (const pt of pts) {
    if (pt) run.push(pt);
    else flush();
  }
  flush();
}

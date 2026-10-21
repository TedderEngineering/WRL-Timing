/**
 * Strategy as a PDF: a page per class with the tab's insights, then the leaderboard (stops, pace,
 * time in the pit lane, yellow stops, stints, score) with each car's stint map: one bar per stint,
 * its width the stint's laps, its colour the stint's green-flag pace against the class's best.
 */
import type { jsPDF as JsPDF } from "jspdf";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { computeInsights, computeStrategyMetrics, type StrategyMetrics } from "../strategy-engine";
import { C, M, fill, fit, footer, ink, lapText, newPdf, pagesOf, pdfSafe, rowsThatFit, secText, startPage, stroke, table, type Column, type KeyItem, type PdfMeta } from "./kit";
import { classesOf } from "./raceData";
import { STINT_CAUTION, STINT_FAST, STINT_MID, STINT_SLOW, STRATEGY_KEY, paceRgb, sortStrategy, strategyMethod, strategySortNote, strategyView } from "../strategy-view";

const paceColor = paceRgb;

const KEY: KeyItem[] = [
  { label: STRATEGY_KEY.best, draw: (doc, x, y) => (doc.setFillColor(...STINT_FAST), doc.rect(x, y - 3, 7, 6, "F")) },
  { label: STRATEGY_KEY.mid, draw: (doc, x, y) => (doc.setFillColor(...STINT_MID), doc.rect(x, y - 3, 7, 6, "F")) },
  { label: STRATEGY_KEY.slow, draw: (doc, x, y) => (doc.setFillColor(...STINT_SLOW), doc.rect(x, y - 3, 7, 6, "F")) },
  { label: STRATEGY_KEY.caution, draw: (doc, x, y) => (doc.setFillColor(...STINT_CAUTION), doc.rect(x, y - 1, 7, 2.5, "F")) },
];

function drawStints(doc: JsPDF, m: StrategyMetrics, x: number, y: number, w: number, h: number, maxLaps: number, best: number) {
  let cx = x;
  for (const s of m.stints) {
    const sw = Math.max(1, (s.laps / Math.max(1, maxLaps)) * w - 1);
    const c = paceColor(s.pace, best);
    doc.setFillColor(c[0], c[1], c[2]);
    doc.rect(cx, y + 2, sw, h - 4, "F");
    if (s.yl > 0) {
      doc.setFillColor(...STINT_CAUTION);
      doc.rect(cx, y + h - 4.5, Math.max(1, sw * (s.yl / Math.max(1, s.laps))), 2.5, "F");
    }
    if (sw > 16) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(Math.min(6.5, h * 0.45));
      doc.setTextColor(11, 11, 24);
      doc.text(String(s.laps), cx + sw / 2, y + h / 2 + 2, { align: "center" });
    }
    cx += sw + 1;
  }
}

export async function strategyPdf(data: RaceChartData, annotations: AnnotationData, focusNum: number, meta: PdfMeta): Promise<Blob> {
  const pdf = await newPdf("landscape", meta);
  const { doc } = pdf;
  const all = computeStrategyMetrics(data, annotations);
  const insights = computeInsights(data, all);
  // As the tab is on screen: its class, in its order (every class in class order when it was never opened).
  const view = strategyView(data);
  const note = view ? strategySortNote(view.sort) : null;
  let first = true;
  for (const cls of view ? [view.cls] : classesOf(data)) {
    const inClass = all.filter((m) => m.cls === cls);
    const rows = view ? sortStrategy(inClass, view.sort) : inClass.sort((a, b) => a.classPos - b.classPos);
    if (!rows.length) continue;
    const verified = rows.some((m) => m.verified);
    const best = Math.min(...rows.map((m) => m.avgGreenPace).filter((p) => p > 0));
    const classInsights = insights.filter((i) => i.cls === cls);
    const totalLaps = Math.max(1, ...rows.map((m) => m.lapsCompleted));

    // Insights: two boxes a row.
    const insightsH = (() => {
      doc.setFontSize(7.5);
      const bw = (pdf.size.w - 2 * M - 12) / 2;
      const lines = classInsights.map((i) => (doc.splitTextToSize(pdfSafe(i.text), bw - 16) as string[]).length);
      let h = 0;
      for (let r = 0; r < lines.length; r += 2) h += 18 + 9 * Math.max(lines[r] ?? 0, lines[r + 1] ?? 0) + 6;
      return h;
    })();
    const { perPage } = rowsThatFit(pdf, 64 + 14 + insightsH, rows.length, 11, 18);
    const pages = pagesOf(rows, perPage);
    pages.forEach((pageRows, pi) => {
      let y = startPage(pdf, meta, `STRATEGY · CLASS ${cls}${pages.length > 1 ? ` (${pi + 1}/${pages.length})` : ""}`, `${rows.length} cars${note ? ` · ${note}` : ""}`, first);
      first = false;
      if (pi === 0 && classInsights.length) {
        const bw = (pdf.size.w - 2 * M - 12) / 2;
        for (let r = 0; r < classInsights.length; r += 2) {
          const pair = classInsights.slice(r, r + 2);
          doc.setFontSize(7.5);
          const lineSets = pair.map((i) => doc.splitTextToSize(pdfSafe(i.text), bw - 16) as string[]);
          const bh = 18 + 9 * Math.max(...lineSets.map((l) => l.length));
          pair.forEach((ins, k) => {
            const bx = M + k * (bw + 12);
            doc.setFillColor(255, 255, 255);
            doc.rect(bx, y, bw, bh, "F");
            fill(doc, C.accent);
            doc.rect(bx, y, 2.5, bh, "F");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.5);
            ink(doc, C.head);
            doc.text(fit(doc, pdfSafe(ins.title), bw - 16), bx + 9, y + 11);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            ink(doc, C.soft);
            doc.text(lineSets[k], bx + 9, y + 21);
          });
          y += bh + 6;
        }
      }
      const { rowH } = rowsThatFit(pdf, y + 14, pageRows.length, 11, 18);
      const fixed: Column<StrategyMetrics>[] = [
        { label: "P", w: 18, align: "right", cell: (m) => String(m.classPos || "—"), bold: true },
        { label: "CAR", w: 30, cell: (m) => `#${m.carLabel}`, bold: true },
        { label: "TEAM", w: 100, cell: (m) => m.team.replace(/\s*\([^()]*\)\s*$/, "") },
        { label: "LAPS", w: 26, align: "right", cell: (m) => String(m.lapsCompleted) },
        { label: "STOPS", w: 28, align: "right", cell: (m) => String(m.stops) },
        { label: "AVG PACE", w: 44, align: "right", cell: (m) => lapText(m.avgGreenPace) },
        { label: "BEST", w: 44, align: "right", cell: (m) => lapText(m.bestLap), color: () => C.clear },
        { label: "PIT TIME", w: 44, align: "right", cell: (m) => `${secText(m.totalPitTime || null)}${m.untimedStops > 0 ? "*" : ""}` },
        { label: "PIT %", w: 30, align: "right", cell: (m) => `${m.pitPct.toFixed(1)}%` },
        { label: "YELLOW", w: 34, align: "right", cell: (m) => `${Math.round(m.yellowPitPct)}%` },
        { label: "AVG STINT", w: 40, align: "right", cell: (m) => `${m.avgStintLen.toFixed(1)}` },
        { label: "MAX", w: 26, align: "right", cell: (m) => String(m.maxStintLen) },
        { label: "SCORE", w: 32, align: "right", cell: (m) => (m.strategyScore < 0 ? "–" : m.strategyScore.toFixed(1)), bold: true },
      ];
      const used = fixed.reduce((s, c) => s + c.w + 5, 0);
      const mapW = pdf.size.w - 2 * M - used;
      const cols: Column<StrategyMetrics>[] = [
        ...fixed,
        { label: "STINT MAP (LAPS PER STINT)", w: mapW, draw: (d, m, x, yy, _w, h) => drawStints(d, m, x, yy, mapW, h, totalLaps, best) },
      ];
      table(doc, M, y, cols, pageRows, { rowH, gap: 5, fontSize: Math.min(8, rowH * 0.62), highlight: (m) => m.carNum === focusNum });
      stroke(doc, C.grid);
      footer(pdf, meta, strategyMethod(verified), KEY);
    });
  }
  return doc.output("blob");
}

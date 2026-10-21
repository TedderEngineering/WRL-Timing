/**
 * The Driver Report as a PDF: one landscape page per class (more when a class has too many drivers
 * for one), the same columns as the tab, drawn as vectors so it prints sharp.
 */
import type { jsPDF as JsPDF } from "jspdf";
import { CLASS_LIMIT, CLEAR_GAP_S, DRIVER_LIMIT, type ClassReport, type DriverRow } from "../driver-performance";
import { DRIVER_COLUMNS, type DriverColumnId } from "../driver-report-columns";
import { C, M, axisLapText, fill, fit, footer, ink, lapText, newPdf, pagesOf, pdfSafe, rowsThatFit, startPage, stroke, type KeyItem, type PdfMeta } from "./kit";

const GAP = 6;

interface Col {
  label: string;
  w: number;
  align: "left" | "right" | "center";
  cell?: (r: DriverRow) => string;
  draw?: "dist" | "track";
}

function columns(hasMake: boolean, pageW: number): Col[] {
  const h = (id: DriverColumnId) => DRIVER_COLUMNS[id].pdf;
  const cols: Col[] = [
    { label: h("driver"), w: hasMake ? 104 : 114, align: "left", cell: (r) => r.driver ?? "Driver not named" },
    { label: h("car"), w: hasMake ? 114 : 130, align: "left", cell: (r) => `#${r.carLabel} ${r.team}` },
    ...(hasMake ? [{ label: "MAKE", w: 56, align: "left" as const, cell: (r: DriverRow) => r.make ?? "" }] : []),
    { label: h("spread"), w: hasMake ? 146 : 160, align: "center", draw: "dist" },
    { label: h("avgLap"), w: 50, align: "right", cell: (r) => lapText(r.avgLap) },
    { label: h("fastLap"), w: 50, align: "right", cell: (r) => lapText(r.fastLap) },
    { label: h("stdDev"), w: 54, align: "right", cell: (r) => (r.shown.length ? r.stdDev.toFixed(3) : "—") },
    { label: h("avgZ"), w: 62, align: "right", cell: (r) => (r.avgZ === null ? "—" : r.avgZ.toFixed(2)) },
    { label: h("clearAirPct"), w: 48, align: "right", cell: (r) => (r.clearAirPct === null ? "—" : `${Math.round(r.clearAirPct)}%`) },
    { label: h("overtakes"), w: 58, align: "right", cell: (r) => String(r.overtakes) },
    { label: h("shown"), w: 62, align: "right", cell: (r) => String(r.shown.length) },
    { label: h("laps"), w: 54, align: "right", cell: (r) => `${r.laps} (${Math.round(r.lapsPct)}%)` },
  ];
  const used = cols.reduce((s, c) => s + c.w + GAP, 0);
  cols.push({ label: h("track"), w: pageW - 2 * M - used, align: "center", draw: "track" });
  return cols;
}

export const driverKey: KeyItem[] = [
  { label: "Clean air", draw: (doc, x, y) => (fill(doc, C.clear), doc.circle(x + 3, y, 2.6, "F")) },
  { label: `Car within ${CLEAR_GAP_S} s ahead`, draw: (doc, x, y) => (fill(doc, C.traffic), doc.lines([[3, 3], [-3, 3], [-3, -3]], x + 3, y - 3, [1, 1], "F", true)) },
  { label: "Fastest lap", draw: (doc, x, y) => (stroke(doc, C.text), doc.setLineWidth(0.8), doc.rect(x + 1.5, y - 3.5, 3.2, 7, "S")) },
];

export const driverMethod =
  `Drivers are ranked on the average of their fastest laps, at most half of the laps they drove. Lap 1, pit in- and out-laps and laps under caution ` +
  `don't count, nor do laps over ${Math.round((CLASS_LIMIT - 1) * 100)}% slower than the class's fastest or ${Math.round((DRIVER_LIMIT - 1) * 100)}% slower than the driver's own fastest. ` +
  `Pace vs class compares each lap with the class's laps from the same part of the race (below 0 is quicker). Clean air and cars passed come from ` +
  `timing-line crossings and may miss some passes and traffic between the lines.`;

function drawRows(doc: JsPDF, report: ClassReport, cols: Col[], rows: DriverRow[], top: number, rowH: number, pageW: number) {
  const xs: number[] = [];
  let x = M;
  for (const c of cols) {
    xs.push(x);
    x += c.w + GAP;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  ink(doc, C.head);
  cols.forEach((c, i) => {
    const tx = c.align === "right" ? xs[i] + c.w : c.align === "center" ? xs[i] + c.w / 2 : xs[i];
    doc.text(c.label, tx, top + 8, { align: c.align });
  });
  const y0 = top + 14;
  const span = report.axis.max - report.axis.min || 1;
  const distI = cols.findIndex((c) => c.draw === "dist");
  const trackI = cols.findIndex((c) => c.draw === "track");
  const dx0 = xs[distI] + 8;
  const dw = cols[distI].w - 16;
  const xOf = (t: number) => dx0 + ((Math.min(Math.max(t, report.axis.min), report.axis.max) - report.axis.min) / span) * dw;
  const ticks: number[] = [];
  for (let t = report.axis.min; t <= report.axis.max + 1e-6; t += report.axis.step) ticks.push(t);
  const bottom = y0 + rows.length * rowH;

  rows.forEach((_r, i) => {
    if (i % 2) {
      fill(doc, C.rowAlt);
      doc.rect(M - 4, y0 + i * rowH, pageW - 2 * M + 8, rowH, "F");
    }
  });
  stroke(doc, C.grid);
  doc.setLineWidth(0.6);
  for (const t of ticks) doc.line(xOf(t), y0, xOf(t), bottom);

  const fontSize = Math.min(8.5, rowH * 0.72);
  rows.forEach((r, i) => {
    const ry = y0 + i * rowH;
    const mid = ry + rowH / 2;
    const base = mid + fontSize * 0.34;
    cols.forEach((c, ci) => {
      if (!c.cell) return;
      doc.setFont("helvetica", ci === 0 || c.label === DRIVER_COLUMNS.avgLap.pdf ? "bold" : "normal");
      doc.setFontSize(fontSize);
      ink(doc, c.label === DRIVER_COLUMNS.fastLap.pdf ? C.clear : C.text);
      const tx = c.align === "right" ? xs[ci] + c.w : c.align === "center" ? xs[ci] + c.w / 2 : xs[ci];
      doc.text(fit(doc, pdfSafe(c.cell(r)), c.w), tx, base, { align: c.align });
    });

    // Distribution: the range, each shown lap, the fastest lap's box.
    if (r.shown.length) {
      const times = r.shown.map((s) => s.t);
      stroke(doc, C.range);
      doc.setLineWidth(Math.max(2, rowH * 0.35));
      doc.line(xOf(Math.min(...times)), mid, xOf(Math.max(...times)), mid);
      const rad = Math.max(1.4, rowH * 0.17);
      for (const s of r.shown) {
        const px = xOf(s.t);
        if (s.clear === false) {
          fill(doc, C.traffic);
          doc.lines([[rad, rad], [-rad, rad], [-rad, -rad]], px, mid - rad, [1, 1], "F", true);
        } else {
          fill(doc, C.clear);
          doc.circle(px, mid, rad * 0.85, "F");
        }
      }
      stroke(doc, C.text);
      doc.setLineWidth(0.8);
      doc.rect(xOf(r.fastLap) - 1.6, mid - rowH * 0.36, 3.2, rowH * 0.72, "S");
    }

    // Time on track: lighter early, darker late (as on the tab).
    const tx0 = xs[trackI];
    const tw = cols[trackI].w;
    fill(doc, C.track);
    doc.rect(tx0, ry + 1, tw, rowH - 2, "F");
    for (const [a, b] of r.onTrack) {
      const f = report.raceS > 0 ? Math.min(1, Math.max(0, (a + b) / 2 / report.raceS)) : 0;
      doc.setFillColor(Math.round(140 - f * 90), Math.round(186 - f * 80), Math.round(232 - f * 40));
      const ax = tx0 + (report.raceS ? (a / report.raceS) * tw : 0);
      doc.rect(ax, ry + 1.5, Math.max(0.8, report.raceS ? ((b - a) / report.raceS) * tw : 0), rowH - 3, "F");
    }
    if (r.stoppedAtS !== null && report.raceS) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(Math.min(6.5, rowH * 0.6));
      ink(doc, C.dnf);
      doc.text("DNF", Math.min(tx0 + (r.stoppedAtS / report.raceS) * tw + 2, tx0 + tw - 14), base - 0.5);
    }
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  ink(doc, C.head);
  for (const t of ticks) doc.text(axisLapText(t), xOf(t), bottom + 10, { align: "center" });
  doc.text("Start", xs[trackI], bottom + 10);
  doc.text(`${Math.round(report.raceS / 3600)} h`, xs[trackI] + cols[trackI].w, bottom + 10, { align: "right" });
}

export async function driverReportPdf(reports: ClassReport[], meta: PdfMeta): Promise<Blob> {
  const pdf = await newPdf("landscape");
  let first = true;
  for (const report of reports) {
    const cols = columns(report.rows.some((r) => r.make), pdf.size.w);
    const top = 64;
    const { perPage } = rowsThatFit(pdf, top + 14, report.rows.length);
    const pages = pagesOf(report.rows, perPage);
    pages.forEach((rows, page) => {
      startPage(pdf, meta, `DRIVER PERFORMANCE REPORT · CLASS ${report.cls}${pages.length > 1 ? ` (${page + 1}/${pages.length})` : ""}`, "Fastest racing laps (at most 50% of each driver's laps)", first);
      first = false;
      const { rowH } = rowsThatFit(pdf, top + 14, rows.length);
      drawRows(pdf.doc, report, cols, rows, top, rowH, pdf.size.w);
      footer(pdf, meta, driverMethod, driverKey);
    });
  }
  return pdf.doc.output("blob");
}

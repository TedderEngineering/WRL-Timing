/**
 * Position Trace as a PDF: the whole field by overall position (when the race has several
 * classes), then a page per class by class position. Each page: the trace with cautions shaded
 * and pit stops marked, car numbers at the end of each line, the focus car in bold, and beside it
 * the results: position, car, team, laps, best lap, stops and places gained in class.
 */
import type { jsPDF as JsPDF } from "jspdf";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { CLASS_COLORS } from "../constants";
import { CAR_COLORS, C, M, fill, footer, hexRgb, ink, lapText, newPdf, pdfSafe, startPage, stroke, table, type Column, type KeyItem, type PdfMeta, type RGB } from "./kit";
import { drawFrame, polyline, px, py, type Plot } from "./plot";
import { classPlacesGained, classesOf, entriesOf, fcySet, finishOrder, finishText, lapStats, racingLaps, stopsOf, type CarEntry, type StopMark } from "./raceData";

interface Row {
  e: CarEntry;
  color: RGB;
  pos: string;
  laps: number;
  best: number | null;
  stops: StopMark[];
  gained: number | null;
}

const KEY: KeyItem[] = [
  { label: "Pit stop", draw: (doc, x, y) => (fill(doc, C.text), doc.circle(x + 3, y, 2, "F")) },
  { label: "Garage visit", draw: (doc, x, y) => (stroke(doc, C.text), doc.setLineWidth(0.8), doc.rect(x + 1, y - 2, 4, 4, "S")) },
  { label: "Caution", draw: (doc, x, y) => (doc.setFillColor(254, 243, 199), doc.rect(x, y - 3, 7, 6, "F")) },
];

const METHOD =
  "Positions are the order cars crossed the line on each lap; the table gives the official finishing order. Stops are pit visits " +
  "(drive-throughs and penalties are not stops). Best lap is the quickest racing lap: not lap 1, a pit in- or out-lap, or under caution.";

function drawTracePage(doc: JsPDF, data: RaceChartData, rows: Row[], by: "class" | "overall", focusKey: string, top: number, pageH: number): void {
  const n = Math.max(2, ...rows.flatMap((r) => r.e.car.laps.map((l) => (by === "class" ? l.cp : l.p)).filter((v) => v > 0 && v < 999)));
  const lapMax = Math.max(1, ...rows.map((r) => r.e.car.laps[r.e.car.laps.length - 1]?.l ?? 1));
  const plot: Plot = { x: M + 22, y: top + 12, w: 598, h: pageH - top - 12 - 46 - 14 - 26, lapMin: 1, lapMax, vTop: 0.5, vBottom: n + 0.5 };
  const step = n <= 20 ? 1 : n <= 40 ? 2 : 5;
  const ticks = [];
  for (let v = 1; v <= n; v += step) ticks.push({ v, label: `P${v}` });
  drawFrame(doc, plot, data.fcy, ticks, by === "class" ? "Class position" : "Overall position");

  const ordered = [...rows].sort((a, b) => (a.e.key === focusKey ? 1 : 0) - (b.e.key === focusKey ? 1 : 0));
  for (const r of ordered) {
    const focus = r.e.key === focusKey;
    const pos = (l: { cp: number; p: number }) => (by === "class" ? l.cp : l.p);
    const pts = r.e.car.laps.map((l) => (pos(l) > 0 && pos(l) < 999 ? ([px(plot, l.l), py(plot, pos(l))] as [number, number]) : null));
    polyline(doc, pts, r.color, focus ? 2.4 : rows.length > 24 ? 0.7 : 1.1);
  }
  // Stops on top of the lines.
  for (const r of rows) {
    for (const s of r.stops) {
      const l = r.e.car.laps.find((x) => x.l === s.lap);
      const v = l ? (by === "class" ? l.cp : l.p) : 0;
      if (!l || !(v > 0 && v < 999) || s.kind === "penalty") continue;
      const x = px(plot, l.l);
      const y = py(plot, v);
      if (s.kind === "garage") {
        doc.setFillColor(255, 255, 255);
        stroke(doc, r.color);
        doc.setLineWidth(0.9);
        doc.rect(x - 2, y - 2, 4, 4, "FD");
      } else {
        fill(doc, r.color);
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(0.5);
        doc.circle(x, y, rows.length > 24 ? 1.5 : 1.9, "FD");
      }
    }
  }
  // Car numbers where each line ends.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(rows.length > 24 ? 5.5 : 6.5);
  for (const r of rows) {
    const last = [...r.e.car.laps].reverse().find((l) => (by === "class" ? l.cp : l.p) > 0 && (by === "class" ? l.cp : l.p) < 999);
    if (!last) continue;
    ink(doc, r.color);
    doc.text(pdfSafe(`#${r.e.label}`), px(plot, last.l) + 3, py(plot, by === "class" ? last.cp : last.p) + 2);
  }

  // Results beside the chart.
  const tx = plot.x + plot.w + 40;
  const cols: Column<Row>[] = [
    { label: "P", w: 18, align: "right", cell: (r) => r.pos, bold: true },
    { label: "CAR", w: 30, cell: (r) => `#${r.e.label}`, color: (r) => r.color, bold: true },
    ...(by === "overall" ? [{ label: "CLASS", w: 30, cell: (r: Row) => r.e.car.cls } as Column<Row>] : []),
    { label: "TEAM", w: by === "overall" ? 92 : 116, cell: (r) => r.e.car.team.replace(/\s*\([^()]*\)\s*$/, "") },
    { label: "LAPS", w: 26, align: "right", cell: (r) => String(r.laps) },
    { label: "BEST", w: 44, align: "right", cell: (r) => lapText(r.best), color: () => C.clear },
    { label: "STOPS", w: 28, align: "right", cell: (r) => String(r.stops.filter((s) => s.kind !== "penalty").length) },
    ...(by === "class"
      ? [
          {
            label: "+/-",
            w: 22,
            align: "right",
            cell: (r: Row) => (r.gained === null ? "—" : r.gained > 0 ? `+${r.gained}` : String(r.gained)),
            color: (r: Row) => (r.gained && r.gained > 0 ? C.good : r.gained && r.gained < 0 ? C.bad : null),
          } as Column<Row>,
        ]
      : []),
  ];
  const avail = plot.h + 10;
  const rowH = Math.min(14, avail / Math.max(1, rows.length));
  table(doc, tx, top + 4, cols, rows, { rowH, highlight: (r) => r.e.key === focusKey });
}

export async function positionTracePdf(data: RaceChartData, annotations: AnnotationData | null | undefined, focusNum: number, meta: PdfMeta): Promise<Blob> {
  const pdf = await newPdf("landscape");
  const fcy = fcySet(data);
  const focusKey = String(focusNum);
  const classes = classesOf(data);
  const rowOf = (e: CarEntry, color: RGB, by: "class" | "overall", n: number): Row => {
    const stops = stopsOf(data, annotations, e.key);
    return {
      e,
      color,
      pos: finishText(e.car, by, n),
      laps: e.car.laps.length,
      best: lapStats(racingLaps(e.car, fcy, stops)).best?.t ?? null,
      stops,
      gained: classPlacesGained(e.car),
    };
  };
  let first = true;
  if (classes.length > 1) {
    const all = finishOrder(entriesOf(data), "overall");
    const rows = all.map((e) => rowOf(e, hexRgb(CLASS_COLORS[e.car.cls] ?? "#64748b"), "overall", all.length));
    const top = startPage(pdf, meta, "POSITION TRACE · OVERALL", `${all.length} cars · ${classes.length} classes`, first);
    first = false;
    drawTracePage(pdf.doc, data, rows, "overall", focusKey, top, pdf.size.h);
    footer(pdf, meta, METHOD, KEY);
  }
  for (const cls of classes) {
    const cars = finishOrder(entriesOf(data, cls), "class");
    const rows = cars.map((e, i) => rowOf(e, CAR_COLORS[i % CAR_COLORS.length], "class", cars.length));
    const top = startPage(pdf, meta, `POSITION TRACE · CLASS ${cls}`, `${cars.length} cars`, first);
    first = false;
    drawTracePage(pdf.doc, data, rows, "class", focusKey, top, pdf.size.h);
    footer(pdf, meta, METHOD, KEY);
  }
  return pdf.doc.output("blob");
}


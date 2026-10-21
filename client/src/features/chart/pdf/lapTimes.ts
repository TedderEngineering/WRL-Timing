/**
 * Lap Times as a PDF: a page per class with every car's racing laps in seconds (cautions shaded,
 * the focus car in bold) and the lap statistics beside it: best lap and its lap, the quickest
 * run of 10 consecutive racing laps, the average and spread of racing laps, and how many there were.
 */
import type { AnnotationData, RaceChartData } from "@shared/types";
import { CAR_COLORS, C, M, axisLapText, footer, ink, lapText, newPdf, niceStep, pdfSafe, startPage, table, type Column, type KeyItem, type PdfMeta, type RGB } from "./kit";
import { drawFrame, polyline, px, py, type Plot } from "./plot";
import { classesOf, entriesOf, fcySet, finishOrder, finishText, lapStats, racingLaps, stopsOf, type CarEntry, type LapStats } from "./raceData";

interface Row {
  e: CarEntry;
  color: RGB;
  pos: string;
  stats: LapStats;
  laps: { l: number; t: number }[];
}

const KEY: KeyItem[] = [{ label: "Caution", draw: (doc, x, y) => (doc.setFillColor(254, 243, 199), doc.rect(x, y - 3, 7, 6, "F")) }];

const METHOD =
  "Racing laps only: not lap 1, a pit in- or out-lap, or under caution. Best 10 is the quickest average of 10 consecutive racing laps. " +
  "Avg and Std dev cover racing laps within 110% of the car's best. The chart leaves out laps more than 5% slower than the class's fastest.";

export async function lapTimesPdf(data: RaceChartData, annotations: AnnotationData | null | undefined, focusNum: number, meta: PdfMeta): Promise<Blob> {
  const pdf = await newPdf("landscape");
  const { doc } = pdf;
  const fcy = fcySet(data);
  const focusKey = String(focusNum);
  let first = true;
  for (const cls of classesOf(data)) {
    const cars = finishOrder(entriesOf(data, cls), "class");
    const rows: Row[] = cars.map((e, i) => {
      const laps = racingLaps(e.car, fcy, stopsOf(data, annotations, e.key));
      return { e, color: CAR_COLORS[i % CAR_COLORS.length], pos: finishText(e.car, "class", cars.length), stats: lapStats(laps), laps: laps.map((l) => ({ l: l.l, t: l.ltSec })) };
    });
    const bests = rows.map((r) => r.stats.best?.t).filter((t): t is number => !!t);
    const top = startPage(pdf, meta, `LAP TIMES · CLASS ${cls}`, `${cars.length} cars · racing laps`, first);
    first = false;
    if (!bests.length) {
      ink(doc, C.muted);
      doc.text("No racing laps in this class.", M, top + 20);
      footer(pdf, meta, METHOD, KEY);
      continue;
    }
    const best = Math.min(...bests);
    const lo = Math.floor(best * 0.995);
    const hi = Math.ceil(best * 1.05);
    const lapMax = Math.max(1, ...rows.map((r) => r.e.car.laps[r.e.car.laps.length - 1]?.l ?? 1));
    const plot: Plot = { x: M + 30, y: top + 12, w: 520, h: pdf.size.h - top - 12 - 46 - 14 - 26, lapMin: 1, lapMax, vTop: lo, vBottom: hi };
    const step = niceStep(hi - lo, 8, [0.5, 1, 2, 5, 10, 20]);
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push({ v, label: axisLapText(v) });
    drawFrame(doc, plot, data.fcy, ticks, "Lap time");

    const ordered = [...rows].sort((a, b) => (a.e.key === focusKey ? 1 : 0) - (b.e.key === focusKey ? 1 : 0));
    for (const r of ordered) {
      const focus = r.e.key === focusKey;
      // A line through consecutive racing laps; a gap where laps are missing or too slow to show.
      const pts: ([number, number] | null)[] = [];
      let prev = -1;
      for (const l of r.laps) {
        if (l.l !== prev + 1) pts.push(null);
        pts.push(l.t <= hi ? [px(plot, l.l), py(plot, l.t)] : null);
        prev = l.l;
      }
      // Every car faded but the focus car, so its laps read through the field.
      const color: RGB = focus || focusKey === "0" ? r.color : (r.color.map((v) => Math.round(v + (255 - v) * 0.45)) as RGB);
      polyline(doc, pts, color, focus ? 1.9 : 0.55);
    }

    const cols: Column<Row>[] = [
      { label: "P", w: 18, align: "right", cell: (r) => r.pos, bold: true },
      { label: "CAR", w: 34, cell: (r) => `#${r.e.label}`, color: (r) => r.color, bold: true },
      { label: "TEAM", w: 86, cell: (r) => r.e.car.team.replace(/\s*\([^()]*\)\s*$/, "") },
      { label: "BEST", w: 46, align: "right", cell: (r) => lapText(r.stats.best?.t), color: (r) => (r.stats.best?.t === best ? C.traffic : C.clear), bold: true },
      { label: "LAP", w: 22, align: "right", cell: (r) => (r.stats.best ? String(r.stats.best.lap) : "—") },
      { label: "BEST 10", w: 46, align: "right", cell: (r) => lapText(r.stats.best10) },
      { label: "AVG", w: 46, align: "right", cell: (r) => lapText(r.stats.avg) },
      { label: "STD DEV", w: 36, align: "right", cell: (r) => (r.stats.sd === null ? "—" : r.stats.sd.toFixed(3)) },
      { label: "LAPS", w: 26, align: "right", cell: (r) => String(r.stats.racingLaps) },
    ];
    const rowH = Math.min(14, (plot.h + 10) / Math.max(1, rows.length));
    table(doc, plot.x + plot.w + 24, top + 4, cols, rows, { rowH, gap: 5, highlight: (r) => r.e.key === focusKey });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    ink(doc, C.muted);
    doc.text(pdfSafe(`Class best ${lapText(best)} in purple.`), plot.x + plot.w + 24, top + 4 + 14 + rows.length * rowH + 10);
    footer(pdf, meta, METHOD, KEY);
  }
  return doc.output("blob");
}

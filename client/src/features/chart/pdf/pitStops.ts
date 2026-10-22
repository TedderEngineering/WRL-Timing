/**
 * Pit Stops as a PDF: a page per class (more for a long class) with each car's stops summed up
 * (stops, average time in the pit lane, average time lost on green-flag stops, best and worst
 * time lost) and every stop as a cell: in-lap, pit-lane time, time lost, against the class pit
 * cycle's average when the race's analysis gives it, cautions and garage visits marked.
 */
import type { jsPDF as JsPDF } from "jspdf";
import type { RaceChartData } from "@shared/types";
import type { PitAnalysisResponse, PitStop } from "../PitAnalysisTab";
import { carKey } from "../car-number";
import { C, M, fit, footer, ink, newPdf, pagesOf, rowsThatFit, secText, startPage, stroke, table, type Column, type KeyItem, type PdfMeta } from "./kit";
import { classesOf, entriesOf, finishOrder, finishText } from "./raceData";
import { DEFAULT_PIT_SORT, type PitSortKey } from "../pit-view";
import { PIT_COLORS, PIT_KEY, PIT_KIND_LABEL, isCautionStop, laneTime, pitMethod, pitRow, pitSortNote, pitView, sortPits, stopPlaces, stopTone, type PitRow } from "../pit-view";

type Row = PitRow & { pos: string };

/** The PDF's header for each sortable column (where the sort mark goes). */
const PIT_PDF_LABELS: Record<PitSortKey, string> = { classPos: "P", car: "CAR", team: "TEAM", stops: "STOPS", avgLane: "AVG LANE", avgLost: "AVG LOST", best: "BEST", worst: "WORST" };

const tint = (c: readonly [number, number, number], a: number): [number, number, number] => [0, 1, 2].map((i) => Math.round(255 - (255 - c[i]) * a)) as [number, number, number];

/** A small up or down triangle (the PDF fonts have no arrow glyphs), its tip at (x, y ± s/2). */
function arrow(doc: JsPDF, x: number, y: number, s: number, up: boolean, color: readonly [number, number, number]) {
  doc.setFillColor(...color);
  if (up) doc.triangle(x, y + s / 2, x + s, y + s / 2, x + s / 2, y - s / 2, "F");
  else doc.triangle(x, y - s / 2, x + s, y - s / 2, x + s / 2, y + s / 2, "F");
}

/** The kind in three letters, for a cell too narrow for the full word beside the lap and places. */
const KIND_SHORT: Record<string, string> = { garage: "GAR", stop_and_go: "S+G", penalty_served: "PEN", drive_through: "DT" };

const KEY: KeyItem[] = [
  { label: PIT_KEY.quick, draw: (doc, x, y) => (doc.setFillColor(...tint(PIT_COLORS.quick, 0.35)), doc.rect(x, y - 3, 7, 6, "F")) },
  { label: PIT_KEY.slow, draw: (doc, x, y) => (doc.setFillColor(...tint(PIT_COLORS.slow, 0.35)), doc.rect(x, y - 3, 7, 6, "F")) },
  { label: PIT_KEY.caution, draw: (doc, x, y) => (doc.setFillColor(...PIT_COLORS.caution), doc.rect(x, y - 3, 2.5, 6, "F")) },
  { label: PIT_KEY.places, draw: (doc, x, y) => (arrow(doc, x, y, 3.2, true, C.good), arrow(doc, x + 3.9, y, 3.2, false, C.bad)) },
];

function drawStops(doc: JsPDF, stops: PitStop[], x: number, y: number, w: number, h: number, cellW: number) {
  stops.forEach((s, i) => {
    const cx = x + i * cellW;
    if (cx + cellW - 2 > x + w + 1) return;
    const tone = stopTone(s);
    if (tone === "other") doc.setFillColor(233, 233, 241);
    else if (tone === "quick") doc.setFillColor(...tint(PIT_COLORS.quick, 0.35));
    else if (tone === "slow") doc.setFillColor(...tint(PIT_COLORS.slow, 0.35));
    else doc.setFillColor(255, 255, 255);
    doc.rect(cx, y + 1.5, cellW - 3, h - 3, "F");
    stroke(doc, C.grid);
    doc.setLineWidth(0.4);
    doc.rect(cx, y + 1.5, cellW - 3, h - 3, "S");
    if (isCautionStop(s)) {
      doc.setFillColor(...PIT_COLORS.caution);
      doc.rect(cx, y + 1.5, 2.2, h - 3, "F");
    }
    const fs = Math.min(6.6, h * 0.3);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fs);
    ink(doc, C.text);
    const base = y + 1.5 + fs + 1;
    doc.text(`L${s.pitLap}`, cx + 4, base);
    // Top right: class places over the pit cycle (▲2, ▼3, = held), then the kind left of it.
    let right = cx + cellW - 5;
    const places = stopPlaces(s);
    if (places) {
      const color = places.net > 0 ? C.good : places.net < 0 ? C.bad : C.muted;
      doc.setFontSize(fs * 0.9);
      ink(doc, color);
      const label = places.net === 0 ? "=" : String(Math.abs(places.net));
      doc.text(label, right, base, { align: "right" });
      right -= doc.getTextWidth(label) + 0.8;
      if (places.net !== 0) {
        const a = fs * 0.55;
        arrow(doc, right - a, base - fs * 0.33, a, places.net > 0, color);
        right -= a;
      }
      right -= 2.5;
      doc.setFont("helvetica", "bold");
    }
    if (s.kind && PIT_KIND_LABEL[s.kind]) {
      // The kind between the lap and the places: in full when it fits, else short (GAR, PEN).
      const lapEnd = cx + 4 + doc.getTextWidth(`L${s.pitLap}`) + 3.5;
      doc.setFontSize(fs * 0.8);
      ink(doc, C.traffic);
      const full = PIT_KIND_LABEL[s.kind].toUpperCase();
      const label = right - doc.getTextWidth(full) >= lapEnd ? full : (KIND_SHORT[s.kind] ?? full.slice(0, 3));
      if (right - doc.getTextWidth(label) >= lapEnd) doc.text(label, right, base, { align: "right" });
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fs);
    ink(doc, C.soft);
    const lane = laneTime(s);
    const lost = s.timeLost_s === null ? "—" : `${s.timeLost_s >= 0 ? "+" : ""}${secText(s.timeLost_s)}`;
    doc.text(fit(doc, `${secText(lane)} / ${lost}`, cellW - 8), cx + 4, y + h - 4);
  });
}

export async function pitStopsPdf(data: RaceChartData, pits: PitAnalysisResponse, focusNum: number, meta: PdfMeta): Promise<Blob> {
  const pdf = await newPdf("landscape", meta);
  const { doc } = pdf;
  const focusLabel = data.cars[String(focusNum)]?.label ?? String(focusNum);
  // The pit analysis names cars by published number; the chart keys them.
  const byKey = new Map(Object.values(pits.cars).map((c) => [String(carKey(data, c.carNumber)), c]));
  // As the tab is on screen: its class, in its order (every class in finishing order when it was never opened).
  const view = pitView(data);
  const note = view ? pitSortNote(view.sort) : null;
  let first = true;
  for (const cls of view ? [view.cls] : classesOf(data)) {
    const entries = finishOrder(entriesOf(data, cls), "class");
    const built: Row[] = entries.map((e) => ({
      ...pitRow(e.key, e.label, e.car.team, cls, e.car.finishPosClass || 999, byKey.get(e.key)?.stops ?? []),
      pos: finishText(e.car, "class", entries.length),
    }));
    const rows = view ? (sortPits(built, view.sort) as Row[]) : built;
    const maxStops = Math.max(1, ...rows.map((r) => r.stops.length));
    const top0 = 64;
    const { perPage } = rowsThatFit(pdf, top0 + 14, rows.length, 20, 26);
    const pages = pagesOf(rows, perPage);
    pages.forEach((pageRows, pi) => {
      const top = startPage(pdf, meta, `PIT STOPS · CLASS ${cls}${pages.length > 1 ? ` (${pi + 1}/${pages.length})` : ""}`, `${rows.reduce((n, r) => n + r.stops.length, 0)} stops${note ? ` · ${note}` : ""}`, first);
      first = false;
      const { rowH } = rowsThatFit(pdf, top + 14, pageRows.length, 20, 26);
      const fixed: Column<Row>[] = [
        { label: "P", w: 18, align: "right", cell: (r) => r.pos, bold: true },
        { label: "CAR", w: 32, cell: (r) => `#${r.label}`, bold: true },
        { label: "TEAM", w: 104, cell: (r) => r.team },
        { label: "STOPS", w: 28, align: "right", cell: (r) => String(r.serviceStops) },
        { label: "AVG LANE", w: 40, align: "right", cell: (r) => secText(r.avgLane) },
        { label: "AVG LOST", w: 40, align: "right", cell: (r) => secText(r.avgLost) },
        { label: "BEST", w: 34, align: "right", color: () => C.good, cell: (r) => secText(r.best) },
        { label: "WORST", w: 34, align: "right", color: () => C.bad, cell: (r) => secText(r.worst) },
      ];
      const used = fixed.reduce((s, c) => s + c.w + 6, 0);
      const stripW = pdf.size.w - 2 * M - used;
      const cellW = Math.min(64, stripW / maxStops);
      const cols: Column<Row>[] = [
        ...fixed,
        { label: "EACH STOP: LAP · PIT LANE / TIME LOST", w: stripW, draw: (d, r, x, y, _w, h) => drawStops(d, r.stops, x, y, stripW, h, cellW) },
      ];
      const sort = view?.sort ?? DEFAULT_PIT_SORT;
      table(doc, M, top + 2, cols, pageRows, { rowH, fontSize: 8, highlight: (r) => r.label === focusLabel, sorted: { label: PIT_PDF_LABELS[sort.key], dir: sort.dir } });
      footer(pdf, meta, pitMethod(pits.source === "facts"), KEY);
    });
  }
  if (first) {
    startPage(pdf, meta, "PIT STOPS", "", true);
    ink(doc, C.muted);
    doc.text("No pit stops recorded for this race.", M, 90);
  }
  return doc.output("blob");
}

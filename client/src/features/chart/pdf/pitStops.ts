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

interface Row {
  key: string;
  label: string;
  team: string;
  pos: string;
  stops: PitStop[];
}

const isStop = (s: PitStop) => !s.kind || s.kind === "stop";
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const caution = (s: PitStop) => /caution|fcy|yellow|mixed/i.test(s.condition ?? "") || !!s.isCautionContaminated;

const KIND: Record<string, string> = { garage: "GARAGE", stop_and_go: "STOP+GO", penalty_served: "PENALTY", drive_through: "DRIVE-THRU" };

const KEY: KeyItem[] = [
  { label: "Quicker than the cycle", draw: (doc, x, y) => (doc.setFillColor(220, 252, 231), doc.rect(x, y - 3, 7, 6, "F")) },
  { label: "Slower than the cycle", draw: (doc, x, y) => (doc.setFillColor(254, 226, 226), doc.rect(x, y - 3, 7, 6, "F")) },
  { label: "Under caution", draw: (doc, x, y) => (doc.setFillColor(250, 204, 21), doc.rect(x, y - 3, 2.5, 6, "F")) },
];

function method(facts: boolean): string {
  return (
    "Each cell: the in-lap, time in the pit lane, and time lost against a racing lap" +
    (facts ? ", with its colour against the average of the class's cars on the same pit cycle" : ", against the car's own reference") +
    ". Averages count service stops only; time lost is averaged over green-flag stops. Garage visits and penalties are shown but not averaged."
  );
}

function drawStops(doc: JsPDF, stops: PitStop[], x: number, y: number, w: number, h: number, cellW: number) {
  stops.forEach((s, i) => {
    const cx = x + i * cellW;
    if (cx + cellW - 2 > x + w + 1) return;
    const d = s.delta_s;
    if (s.kind && s.kind !== "stop") doc.setFillColor(233, 233, 241);
    else if (d !== null && d <= -2) doc.setFillColor(220, 252, 231);
    else if (d !== null && d >= 2) doc.setFillColor(254, 226, 226);
    else doc.setFillColor(255, 255, 255);
    doc.rect(cx, y + 1.5, cellW - 3, h - 3, "F");
    stroke(doc, C.grid);
    doc.setLineWidth(0.4);
    doc.rect(cx, y + 1.5, cellW - 3, h - 3, "S");
    if (caution(s)) {
      doc.setFillColor(250, 204, 21);
      doc.rect(cx, y + 1.5, 2.2, h - 3, "F");
    }
    const fs = Math.min(6.6, h * 0.3);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fs);
    ink(doc, C.text);
    doc.text(`L${s.pitLap}`, cx + 4, y + 1.5 + fs + 1);
    if (s.kind && KIND[s.kind]) {
      doc.setFontSize(fs * 0.8);
      ink(doc, C.traffic);
      doc.text(KIND[s.kind], cx + cellW - 5, y + 1.5 + fs + 1, { align: "right" });
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fs);
    ink(doc, C.soft);
    const lane = s.pitRoadTime_s ?? s.serviceTime_s;
    const lost = s.timeLost_s === null ? "—" : `${s.timeLost_s >= 0 ? "+" : ""}${secText(s.timeLost_s)}`;
    doc.text(fit(doc, `${secText(lane)} / ${lost}`, cellW - 8), cx + 4, y + h - 4);
  });
}

export async function pitStopsPdf(data: RaceChartData, pits: PitAnalysisResponse, focusNum: number, meta: PdfMeta): Promise<Blob> {
  const pdf = await newPdf("landscape");
  const { doc } = pdf;
  const focusLabel = data.cars[String(focusNum)]?.label ?? String(focusNum);
  // The pit analysis names cars by published number; the chart keys them.
  const byKey = new Map(Object.values(pits.cars).map((c) => [String(carKey(data, c.carNumber)), c]));
  let first = true;
  for (const cls of classesOf(data)) {
    const entries = finishOrder(entriesOf(data, cls), "class");
    const rows: Row[] = entries.map((e) => ({
      key: e.key,
      label: e.label,
      team: e.car.team.replace(/\s*\([^()]*\)\s*$/, ""),
      pos: finishText(e.car, "class", entries.length),
      stops: [...(byKey.get(e.key)?.stops ?? [])].sort((a, b) => a.pitLap - b.pitLap),
    }));
    const maxStops = Math.max(1, ...rows.map((r) => r.stops.length));
    const top0 = 64;
    const { perPage } = rowsThatFit(pdf, top0 + 14, rows.length, 20, 26);
    const pages = pagesOf(rows, perPage);
    pages.forEach((pageRows, pi) => {
      const top = startPage(pdf, meta, `PIT STOPS · CLASS ${cls}${pages.length > 1 ? ` (${pi + 1}/${pages.length})` : ""}`, `${rows.reduce((n, r) => n + r.stops.length, 0)} stops`, first);
      first = false;
      const { rowH } = rowsThatFit(pdf, top + 14, pageRows.length, 20, 26);
      const fixed: Column<Row>[] = [
        { label: "P", w: 18, align: "right", cell: (r) => r.pos, bold: true },
        { label: "CAR", w: 32, cell: (r) => `#${r.label}`, bold: true },
        { label: "TEAM", w: 104, cell: (r) => r.team },
        { label: "STOPS", w: 28, align: "right", cell: (r) => String(r.stops.filter(isStop).length) },
        { label: "AVG LANE", w: 40, align: "right", cell: (r) => secText(mean(r.stops.filter(isStop).map((s) => s.pitRoadTime_s ?? s.serviceTime_s).filter((v): v is number => v !== null))) },
        { label: "AVG LOST", w: 40, align: "right", cell: (r) => secText(mean(r.stops.filter((s) => isStop(s) && !caution(s)).map((s) => s.timeLost_s).filter((v): v is number => v !== null))) },
        { label: "BEST", w: 34, align: "right", color: () => C.good, cell: (r) => secText(lostRange(r).best) },
        { label: "WORST", w: 34, align: "right", color: () => C.bad, cell: (r) => secText(lostRange(r).worst) },
      ];
      const used = fixed.reduce((s, c) => s + c.w + 6, 0);
      const stripW = pdf.size.w - 2 * M - used;
      const cellW = Math.min(64, stripW / maxStops);
      const cols: Column<Row>[] = [
        ...fixed,
        { label: "EACH STOP: LAP · PIT LANE / TIME LOST", w: stripW, draw: (d, r, x, y, _w, h) => drawStops(d, r.stops, x, y, stripW, h, cellW) },
      ];
      table(doc, M, top + 2, cols, pageRows, { rowH, fontSize: 8, highlight: (r) => r.label === focusLabel });
      footer(pdf, meta, method(pits.source === "facts"), KEY);
    });
  }
  if (first) {
    startPage(pdf, meta, "PIT STOPS", "", true);
    ink(doc, C.muted);
    doc.text("No pit stops recorded for this race.", M, 90);
  }
  return doc.output("blob");
}

function lostRange(r: Row): { best: number | null; worst: number | null } {
  const v = r.stops.filter((s) => isStop(s) && !caution(s)).map((s) => s.timeLost_s).filter((x): x is number => x !== null);
  return { best: v.length ? Math.min(...v) : null, worst: v.length ? Math.max(...v) : null };
}


/**
 * The Driver Report as a PDF: one landscape page per class (more when a class has too many drivers
 * for one), the same columns as the tab, drawn as vectors so it prints sharp. jsPDF loads only
 * when someone downloads.
 */
import type { jsPDF as JsPDF } from "jspdf";
import { CLASS_LIMIT, CLEAR_GAP_S, DRIVER_LIMIT, type ClassReport, type DriverRow } from "./driver-performance";

export const PAGE_W = 1024;
export const PAGE_H = 576;
const M = 22;
const HEADER_H = 50;
const COLS_Y = HEADER_H + 22;
const FOOT_H = 46;
const MIN_ROW_H = 9.5;
const MAX_ROW_H = 14;

type RGB = [number, number, number];
const C: Record<string, RGB> = {
  band: [18, 18, 42],
  accent: [244, 140, 52],
  page: [246, 246, 250],
  rowAlt: [233, 233, 241],
  text: [24, 24, 40],
  muted: [100, 100, 128],
  head: [36, 36, 92],
  grid: [214, 214, 226],
  range: [200, 200, 214],
  clear: [22, 163, 74],
  traffic: [124, 58, 237],
  track: [222, 222, 234],
  dnf: [220, 38, 38],
  white: [255, 255, 255],
};

export interface DriverReportMeta {
  raceName: string;
  track?: string;
  date?: string;
}

function lapText(s: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

function axisText(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${(Number.isInteger(sec) ? String(sec) : sec.toFixed(1)).padStart(2, "0")}`;
}

/** The PDF's built-in fonts cover Latin-1: other letters lose their accents ("ł" → "l"), never become boxes. */
export function pdfSafe(s: string): string {
  return [...s]
    .map((ch) => {
      if (ch.charCodeAt(0) <= 255 || ch === "—" || ch === "·") return ch;
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      return base.length && base.charCodeAt(0) <= 255 ? base : "?";
    })
    .join("");
}

function dateText(d?: string): string {
  if (!d) return "";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

interface Col {
  label: string;
  w: number;
  align: "left" | "right" | "center";
  cell?: (r: DriverRow) => string;
  /** Drawn by hand: the distribution and time-on-track columns. */
  draw?: "dist" | "track";
}

const GAP = 6;

function columns(hasMake: boolean): Col[] {
  const cols: Col[] = [
    { label: "DRIVER", w: hasMake ? 110 : 122, align: "left", cell: (r) => r.driver ?? "Driver not named" },
    { label: "CAR", w: hasMake ? 130 : 154, align: "left", cell: (r) => `#${r.carLabel} ${r.team}` },
    ...(hasMake ? [{ label: "MAKE", w: 60, align: "left" as const, cell: (r: DriverRow) => r.make ?? "" }] : []),
    { label: "LAP TIME DISTRIBUTION", w: hasMake ? 160 : 180, align: "center", draw: "dist" },
    { label: "AVG LAP", w: 52, align: "right", cell: (r) => lapText(r.avgLap) },
    { label: "BEST", w: 50, align: "right", cell: (r) => lapText(r.fastLap) },
    { label: "STD DEV", w: 40, align: "right", cell: (r) => (r.shown.length ? r.stdDev.toFixed(3) : "—") },
    { label: "Z-SCORE", w: 40, align: "right", cell: (r) => (r.avgZ === null ? "—" : r.avgZ.toFixed(2)) },
    { label: "CLEAR AIR", w: 44, align: "right", cell: (r) => (r.clearAirPct === null ? "—" : `${Math.round(r.clearAirPct)}%`) },
    { label: "PASSES", w: 36, align: "right", cell: (r) => String(r.overtakes) },
    { label: "SHOWN", w: 32, align: "right", cell: (r) => String(r.shown.length) },
    { label: "LAPS (%)", w: 52, align: "right", cell: (r) => `${r.laps} (${Math.round(r.lapsPct)}%)` },
  ];
  const used = cols.reduce((s, c) => s + c.w + GAP, 0);
  cols.push({ label: "TIME ON TRACK", w: PAGE_W - 2 * M - used, align: "center", draw: "track" });
  return cols;
}

/** Cut text to fit `w` points, with an ellipsis. */
function fit(doc: JsPDF, s: string, w: number): string {
  if (doc.getTextWidth(s) <= w) return s;
  let t = s;
  while (t.length > 1 && doc.getTextWidth(`${t}…`.replace("…", "..")) > w) t = t.slice(0, -1);
  return `${t.trimEnd()}..`;
}

async function imageData(src: string): Promise<string | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** How a class's rows split over pages, and the row height on each. */
export function pageRows(n: number): { perPage: number; rowH: number } {
  const avail = PAGE_H - COLS_Y - 12 - FOOT_H - 16;
  const perPage = Math.max(1, Math.floor(avail / MIN_ROW_H));
  const onPage = Math.min(n, perPage);
  return { perPage, rowH: Math.min(MAX_ROW_H, avail / Math.max(1, onPage)) };
}

export async function makeDriverReportPdf(reports: ClassReport[], meta: DriverReportMeta): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [PAGE_W, PAGE_H], compress: true });
  const [icon, teLogo] = await Promise.all([imageData("/racetrace-icon-192.png"), imageData("/te-logo-black.png")]);
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const ink = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const stroke = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  // The track, unless the race's name already says it.
  const track = meta.track && !meta.raceName.toLowerCase().includes(meta.track.toLowerCase()) ? meta.track : undefined;
  const sub = [track, dateText(meta.date)].filter(Boolean).join(" · ");

  let first = true;
  for (const report of reports) {
    const hasMake = report.rows.some((r) => r.make);
    const cols = columns(hasMake);
    const { perPage } = pageRows(report.rows.length);
    const pages = Math.max(1, Math.ceil(report.rows.length / perPage));
    const span = report.axis.max - report.axis.min || 1;

    for (let page = 0; page < pages; page++) {
      if (!first) doc.addPage([PAGE_W, PAGE_H], "landscape");
      first = false;
      const rows = report.rows.slice(page * perPage, (page + 1) * perPage);
      const { rowH } = pageRows(rows.length);

      // Page and header band.
      fill(C.page);
      doc.rect(0, 0, PAGE_W, PAGE_H, "F");
      fill(C.band);
      doc.rect(0, 0, PAGE_W, HEADER_H, "F");
      fill(C.accent);
      doc.rect(0, HEADER_H, PAGE_W, 2.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      ink(C.white);
      doc.text(`DRIVER PERFORMANCE REPORT · CLASS ${pdfSafe(report.cls)}${pages > 1 ? ` (${page + 1}/${pages})` : ""}`, M, 21);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(pdfSafe(`${meta.raceName}${sub ? ` · ${sub}` : ""} · Fastest racing laps (at most 50% of each driver's laps)`), M, 37);
      if (icon) doc.addImage(icon, "PNG", PAGE_W - M - 112, 12, 26, 26);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("RaceTrace", PAGE_W - M, 30, { align: "right" });

      // Column heads.
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      ink(C.head);
      let x = M;
      const xs: number[] = [];
      for (const c of cols) {
        xs.push(x);
        const tx = c.align === "right" ? x + c.w : c.align === "center" ? x + c.w / 2 : x;
        doc.text(c.label, tx, COLS_Y, { align: c.align });
        x += c.w + GAP;
      }
      const top = COLS_Y + 6;
      const distI = cols.findIndex((c) => c.draw === "dist");
      const trackI = cols.findIndex((c) => c.draw === "track");
      const dx0 = xs[distI] + 8;
      const dw = cols[distI].w - 16;
      const xOf = (t: number) => dx0 + ((Math.min(Math.max(t, report.axis.min), report.axis.max) - report.axis.min) / span) * dw;
      const ticks: number[] = [];
      for (let t = report.axis.min; t <= report.axis.max + 1e-6; t += report.axis.step) ticks.push(t);
      const bottom = top + rows.length * rowH;

      // Row bands, then the distribution grid over them.
      rows.forEach((_r, i) => {
        if (i % 2) {
          fill(C.rowAlt);
          doc.rect(M - 4, top + i * rowH, PAGE_W - 2 * M + 8, rowH, "F");
        }
      });
      stroke(C.grid);
      doc.setLineWidth(0.6);
      for (const t of ticks) doc.line(xOf(t), top, xOf(t), bottom);

      const fontSize = Math.min(8.5, rowH * 0.72);
      rows.forEach((r, i) => {
        const y0 = top + i * rowH;
        const mid = y0 + rowH / 2;
        const base = mid + fontSize * 0.34;
        cols.forEach((c, ci) => {
          if (c.cell) {
            doc.setFont("helvetica", ci === 0 || c.label === "AVG LAP" ? "bold" : "normal");
            doc.setFontSize(fontSize);
            ink(c.label === "BEST" ? C.clear : C.text);
            const text = fit(doc, pdfSafe(c.cell(r)), c.w);
            const tx = c.align === "right" ? xs[ci] + c.w : c.align === "center" ? xs[ci] + c.w / 2 : xs[ci];
            doc.text(text, tx, base, { align: c.align });
          }
        });

        // Distribution: the range, each shown lap, the fastest lap's box.
        if (r.shown.length) {
          const times = r.shown.map((s) => s.t);
          stroke(C.range);
          doc.setLineWidth(Math.max(2, rowH * 0.35));
          doc.line(xOf(Math.min(...times)), mid, xOf(Math.max(...times)), mid);
          const rad = Math.max(1.4, rowH * 0.17);
          for (const s of r.shown) {
            const px = xOf(s.t);
            if (s.clear === false) {
              fill(C.traffic);
              doc.lines([[rad, rad], [-rad, rad], [-rad, -rad]], px, mid - rad, [1, 1], "F", true);
            } else {
              fill(C.clear);
              doc.circle(px, mid, rad * 0.85, "F");
            }
          }
          stroke(C.text);
          doc.setLineWidth(0.8);
          doc.rect(xOf(r.fastLap) - 1.6, mid - rowH * 0.36, 3.2, rowH * 0.72, "S");
        }

        // Time on track.
        const tx0 = xs[trackI];
        const tw = cols[trackI].w;
        fill(C.track);
        doc.rect(tx0, y0 + 1, tw, rowH - 2, "F");
        for (const [a, b] of r.onTrack) {
          const f = report.raceS > 0 ? Math.min(1, Math.max(0, (a + b) / 2 / report.raceS)) : 0;
          // Lighter early, darker late (as on the tab).
          doc.setFillColor(Math.round(140 - f * 90), Math.round(186 - f * 80), Math.round(232 - f * 40));
          const ax = tx0 + (report.raceS ? (a / report.raceS) * tw : 0);
          const bw = Math.max(0.8, report.raceS ? ((b - a) / report.raceS) * tw : 0);
          doc.rect(ax, y0 + 1.5, bw, rowH - 3, "F");
        }
        if (r.stoppedAtS !== null && report.raceS) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(Math.min(6.5, rowH * 0.6));
          ink(C.dnf);
          doc.text("DNF", Math.min(tx0 + (r.stoppedAtS / report.raceS) * tw + 2, tx0 + tw - 14), base - 0.5);
        }
      });

      // Axes under the table.
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      ink(C.head);
      for (const t of ticks) doc.text(axisText(t), xOf(t), bottom + 10, { align: "center" });
      doc.text("Start", xs[trackI], bottom + 10);
      doc.text(`${Math.round(report.raceS / 3600)} h`, xs[trackI] + cols[trackI].w, bottom + 10, { align: "right" });

      // Key, method and footer.
      const fy = PAGE_H - FOOT_H + 6;
      doc.setFontSize(7);
      ink(C.muted);
      fill(C.clear);
      doc.circle(M + 3, fy - 2.5, 2.6, "F");
      doc.text("Clear air", M + 9, fy);
      fill(C.traffic);
      doc.lines([[3, 3], [-3, 3], [-3, -3]], M + 58, fy - 5.5, [1, 1], "F", true);
      doc.text(`Car within ${CLEAR_GAP_S} s ahead`, M + 64, fy);
      stroke(C.text);
      doc.setLineWidth(0.8);
      doc.rect(M + 150, fy - 6, 3.2, 7, "S");
      doc.text("Fastest lap", M + 157, fy);
      const method =
        `Drivers are ranked on the average of their fastest laps, at most half of the laps they drove. Lap 1, pit in- and out-laps and laps under caution ` +
        `don't count, nor do laps over ${Math.round((CLASS_LIMIT - 1) * 100)}% slower than the class's fastest or ${Math.round((DRIVER_LIMIT - 1) * 100)}% slower than the driver's own fastest. ` +
        `The z-score compares each lap with the class's laps from the same part of the race (below 0 is quicker). Clear air and passes come from ` +
        `timing-line crossings and may miss some passes and traffic between the lines.`;
      doc.text(doc.splitTextToSize(method, PAGE_W - 2 * M - 210), M, fy + 11);
      if (teLogo) doc.addImage(teLogo, "PNG", PAGE_W - M - 96, PAGE_H - 38, 96, 96 * (372 / 1206));
      doc.setFontSize(7.5);
      ink(C.muted);
      doc.text("racetrace.tedderengineering.com", PAGE_W - M - 106, PAGE_H - 21, { align: "right" });
    }
  }
  return doc.output("blob");
}

/** "Driver Report - WRL Sunday 7 Hour - Sebring - 2026-10-18.pdf" */
export function driverReportFileName(meta: DriverReportMeta): string {
  const day = meta.date ? new Date(meta.date).toISOString().slice(0, 10) : "";
  const name = `Driver Report - ${meta.raceName}${day ? ` - ${day}` : ""}`
    .replace(/[—–]/g, "-")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ");
  return `${name}.pdf`;
}

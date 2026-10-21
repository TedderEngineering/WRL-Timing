/**
 * What every race-page PDF shares: the page (landscape 16:9, or portrait Letter for text), the
 * header band with the race and what the page shows, the footer with the key, the method, the
 * site and logo and who it was prepared for, tables, and the file download. jsPDF loads only when
 * someone downloads.
 */
import type { jsPDF as JsPDF } from "jspdf";

export type RGB = [number, number, number];

export const LANDSCAPE = { w: 1024, h: 576 } as const;
export const PORTRAIT = { w: 612, h: 792 } as const;
export const M = 22;
export const HEADER_H = 50;
export const FOOT_H = 46;

export const C = {
  band: [18, 18, 42],
  accent: [244, 140, 52],
  page: [246, 246, 250],
  rowAlt: [233, 233, 241],
  text: [24, 24, 40],
  soft: [60, 60, 86],
  muted: [100, 100, 128],
  head: [36, 36, 92],
  grid: [214, 214, 226],
  range: [200, 200, 214],
  clear: [22, 163, 74],
  traffic: [124, 58, 237],
  track: [222, 222, 234],
  dnf: [220, 38, 38],
  good: [22, 163, 74],
  bad: [220, 38, 38],
  caution: [250, 204, 21],
  white: [255, 255, 255],
} satisfies Record<string, RGB>;

export interface PdfMeta {
  raceName: string;
  track?: string;
  date?: string;
  /** The signed-in user's email, printed in the footer as on the charts. */
  preparedFor?: string | null;
  /** Tests: leave the page streams uncompressed so their words can be read. */
  uncompressed?: boolean;
}

export interface Assets {
  icon: string | null;
  teLogo: string | null;
}

export interface Pdf {
  doc: JsPDF;
  assets: Assets;
  size: { w: number; h: number };
}

/** The PDF's built-in fonts cover Latin-1: other letters lose their accents ("ł" → "l"), never become boxes. */
export function pdfSafe(s: string): string {
  return [...s]
    .map((ch) => {
      if (ch.charCodeAt(0) <= 255) return ch;
      if (ch === "—" || ch === "–") return "-";
      if (ch === "→") return ">";
      if (ch === "’" || ch === "‘") return "'";
      if (ch === "“" || ch === "”") return '"';
      if (ch === "…") return "...";
      if (ch === "·") return "·";
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      return base.length && base.charCodeAt(0) <= 255 ? base : "?";
    })
    .join("");
}

/** "2:17.732"; "—" for nothing. */
export function lapText(s: number | null | undefined): string {
  if (!s || !Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

/** "6:21.0", "55.0" (seconds, tenths); "—" for nothing. */
export function secText(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const body = m > 0 ? `${m}:${(a - m * 60).toFixed(1).padStart(4, "0")}` : a.toFixed(1);
  return `${s < 0 ? "-" : ""}${body}`;
}

/** An axis label for a lap time: "2:18", "2:18.5". */
export function axisLapText(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${(Number.isInteger(sec) ? String(sec) : sec.toFixed(1)).padStart(2, "0")}`;
}

export function dateText(d?: string): string {
  if (!d) return "";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Driver Report - WRL Sunday 7 Hour - Sebring International Raceway - 2026-10-18.pdf" */
export function pdfFileName(what: string, meta: PdfMeta): string {
  const day = meta.date && !Number.isNaN(new Date(meta.date).getTime()) ? new Date(meta.date).toISOString().slice(0, 10) : "";
  const name = `${what} - ${meta.raceName}${day ? ` - ${day}` : ""}`
    .replace(/[—–]/g, "-")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ");
  return `${name}.pdf`;
}

/** Axis step: a round number giving about `ticks` ticks. */
export function niceStep(span: number, ticks = 6, steps = [0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30, 50, 60, 100, 120, 200, 250, 500]): number {
  for (const s of steps) if (span / s <= ticks) return s;
  return steps[steps.length - 1];
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

export async function newPdf(orientation: "landscape" | "portrait" = "landscape", meta?: PdfMeta): Promise<Pdf> {
  const { jsPDF } = await import("jspdf");
  const size = orientation === "landscape" ? LANDSCAPE : PORTRAIT;
  const doc = new jsPDF({ orientation, unit: "pt", format: [size.w, size.h], compress: !meta?.uncompressed });
  const [icon, teLogo] = await Promise.all([imageData("/racetrace-icon-192.png"), imageData("/te-logo-black.png")]);
  return { doc, assets: { icon, teLogo }, size: { ...size } };
}

export const fill = (doc: JsPDF, c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
export const ink = (doc: JsPDF, c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
export const stroke = (doc: JsPDF, c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);

export function hexRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [120, 120, 140];
}

/** Cut text to fit `w` points, with "..". */
export function fit(doc: JsPDF, s: string, w: number): string {
  if (doc.getTextWidth(s) <= w) return s;
  let t = s;
  while (t.length > 1 && doc.getTextWidth(`${t}..`) > w) t = t.slice(0, -1);
  return `${t.trimEnd()}..`;
}

/**
 * Start a page: the background and the header band. `title` is what the page shows ("POSITION
 * TRACE · CLASS GTO"); `detail` follows the race on the second line. Returns the top of the content.
 */
export function startPage(pdf: Pdf, meta: PdfMeta, title: string, detail: string, first: boolean): number {
  const { doc, assets, size } = pdf;
  if (!first) doc.addPage([size.w, size.h], size.w > size.h ? "landscape" : "portrait");
  fill(doc, C.page);
  doc.rect(0, 0, size.w, size.h, "F");
  fill(doc, C.band);
  doc.rect(0, 0, size.w, HEADER_H, "F");
  fill(doc, C.accent);
  doc.rect(0, HEADER_H, size.w, 2.5, "F");
  const narrow = size.w < 800;
  const right = narrow ? 86 : 124;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(narrow ? 11 : 13);
  ink(doc, C.white);
  doc.text(fit(doc, pdfSafe(title), size.w - 2 * M - right), M, 21);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(narrow ? 8 : 9.5);
  const track = meta.track && !meta.raceName.toLowerCase().includes(meta.track.toLowerCase()) ? meta.track : undefined;
  const line = [meta.raceName, track, dateText(meta.date), detail].filter(Boolean).join(" · ");
  doc.text(fit(doc, pdfSafe(line), size.w - 2 * M - right), M, 37);
  if (assets.icon) doc.addImage(assets.icon, "PNG", size.w - M - (narrow ? 84 : 112), 12, 26, 26);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(narrow ? 11 : 14);
  doc.text("RaceTrace", size.w - M, 30, { align: "right" });
  return HEADER_H + 14;
}

export interface KeyItem {
  label: string;
  draw: (doc: JsPDF, x: number, y: number) => void;
}

/** The footer: the key and the method on the left, the site, who it's for and the logo on the right. */
export function footer(pdf: Pdf, meta: PdfMeta, method: string, key: KeyItem[] = []): void {
  const { doc, assets, size } = pdf;
  const fy = size.h - FOOT_H + 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  ink(doc, C.muted);
  let x = M;
  for (const k of key) {
    k.draw(doc, x, fy - 2.5);
    doc.text(pdfSafe(k.label), x + 8, fy);
    x += 14 + doc.getTextWidth(pdfSafe(k.label));
  }
  // The site address, who it is for and the logo take the right-hand ~250 pt.
  const rightW = size.w < 800 ? 210 : 250;
  if (method) {
    const lines = doc.splitTextToSize(pdfSafe(method), size.w - 2 * M - rightW - 16) as string[];
    doc.text(lines.slice(0, key.length ? 3 : 4), M, key.length ? fy + 10 : fy);
  }
  const logoW = size.w < 800 ? 76 : 96;
  if (assets.teLogo) doc.addImage(assets.teLogo, "PNG", size.w - M - logoW, size.h - 38, logoW, logoW * (372 / 1206));
  doc.setFontSize(7);
  ink(doc, C.muted);
  doc.text("racetrace.tedderengineering.com", size.w - M - logoW - 8, size.h - 26, { align: "right" });
  if (meta.preparedFor) doc.text(pdfSafe(`Prepared for ${meta.preparedFor}`), size.w - M - logoW - 8, size.h - 17, { align: "right" });
}

export interface Column<R> {
  label: string;
  w: number;
  align?: "left" | "right" | "center";
  cell?: (r: R) => string;
  color?: (r: R) => RGB | null;
  bold?: boolean;
  /** Draw the cell by hand (a bar, a strip). */
  draw?: (doc: JsPDF, r: R, x: number, y: number, w: number, h: number) => void;
}

/**
 * A table with a head, banded rows and right-aligned numbers. Returns the column x positions and
 * the bottom of the last row.
 */
/** A small triangle beside a sorted column's header: up for lowest first (A to Z), down for highest first. */
export function sortMark(doc: JsPDF, x: number, baseline: number, dir: "asc" | "desc") {
  fill(doc, C.accent);
  const s = 2.6;
  const cy = baseline - 2.6;
  if (dir === "asc") doc.triangle(x, cy + s * 0.6, x + s * 2, cy + s * 0.6, x + s, cy - s * 0.7, "F");
  else doc.triangle(x, cy - s * 0.6, x + s * 2, cy - s * 0.6, x + s, cy + s * 0.7, "F");
}

/** A header label with the sort mark beside it (left of a right-aligned label, right of the rest). */
export function headerText(doc: JsPDF, label: string, x: number, y: number, w: number, align: "left" | "right" | "center", dir?: "asc" | "desc") {
  // The full label (the mark sits in the gap beside it), shrunk a little when it would not fit.
  const size = doc.getFontSize();
  if (dir && doc.getTextWidth(label) + 8 > w) doc.setFontSize(Math.max(size * 0.85, size * ((w - 8) / doc.getTextWidth(label))));
  const t = fit(doc, label, dir ? Math.max(w - 8, doc.getTextWidth(label)) : w);
  doc.text(t, x, y, { align });
  if (!dir) return;
  const tw = doc.getTextWidth(t);
  const mx = align === "right" ? x - tw - 7.5 : align === "center" ? x + tw / 2 + 2 : x + tw + 2;
  sortMark(doc, mx, y, dir);
  doc.setFontSize(size);
}

export function table<R>(
  doc: JsPDF,
  x0: number,
  y0: number,
  cols: Column<R>[],
  rows: R[],
  opts: { rowH: number; fontSize?: number; gap?: number; width?: number; highlight?: (r: R) => boolean; sorted?: { label: string; dir: "asc" | "desc" } },
): { xs: number[]; bottom: number } {
  const gap = opts.gap ?? 6;
  const fs = opts.fontSize ?? Math.min(8.5, opts.rowH * 0.72);
  const xs: number[] = [];
  let x = x0;
  for (const c of cols) {
    xs.push(x);
    x += c.w + gap;
  }
  const width = opts.width ?? x - gap - x0;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(Math.min(7.5, fs));
  ink(doc, C.head);
  cols.forEach((c, i) => {
    const align = c.align ?? "left";
    const tx = align === "right" ? xs[i] + c.w : align === "center" ? xs[i] + c.w / 2 : xs[i];
    headerText(doc, c.label, tx, y0 + 8, c.w, align, opts.sorted && opts.sorted.label === c.label ? opts.sorted.dir : undefined);
    ink(doc, C.head);
  });
  const top = y0 + 14;
  rows.forEach((r, ri) => {
    const y = top + ri * opts.rowH;
    if (opts.highlight?.(r)) {
      doc.setFillColor(253, 230, 206);
      doc.rect(x0 - 4, y, width + 8, opts.rowH, "F");
    } else if (ri % 2) {
      fill(doc, C.rowAlt);
      doc.rect(x0 - 4, y, width + 8, opts.rowH, "F");
    }
    const base = y + opts.rowH / 2 + fs * 0.34;
    cols.forEach((c, ci) => {
      if (c.draw) {
        c.draw(doc, r, xs[ci], y, c.w, opts.rowH);
        return;
      }
      if (!c.cell) return;
      doc.setFont("helvetica", c.bold ? "bold" : "normal");
      doc.setFontSize(fs);
      ink(doc, c.color?.(r) ?? C.text);
      const align = c.align ?? "left";
      const tx = align === "right" ? xs[ci] + c.w : align === "center" ? xs[ci] + c.w / 2 : xs[ci];
      doc.text(fit(doc, pdfSafe(c.cell(r)), c.w), tx, base, { align });
    });
  });
  return { xs, bottom: top + rows.length * opts.rowH };
}

/** Rows that fit between `top` and the footer, and the row height to use. */
export function rowsThatFit(pdf: Pdf, top: number, n: number, minH = 9.5, maxH = 14, reserve = 0): { perPage: number; rowH: number } {
  const avail = pdf.size.h - top - 14 - FOOT_H - 14 - reserve;
  const perPage = Math.max(1, Math.floor(avail / minH));
  const onPage = Math.min(n, perPage);
  return { perPage, rowH: Math.min(maxH, avail / Math.max(1, onPage)) };
}

/** Split rows into pages of at most `perPage`. */
export function pagesOf<R>(rows: R[], perPage: number): R[][] {
  if (!rows.length) return [[]];
  const out: R[][] = [];
  for (let i = 0; i < rows.length; i += perPage) out.push(rows.slice(i, i + perPage));
  return out;
}

/** Save a blob under a file name (a download on a computer; the viewer on a phone). */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Distinct line colours for the cars of a class on a light page, in finishing order. */
export const CAR_COLORS: RGB[] = [
  [230, 120, 20],
  [37, 99, 235],
  [22, 163, 74],
  [220, 38, 38],
  [124, 58, 237],
  [8, 145, 178],
  [202, 138, 4],
  [219, 39, 119],
  [71, 85, 105],
  [101, 163, 13],
  [79, 70, 229],
  [234, 88, 12],
  [13, 148, 136],
  [190, 18, 60],
  [147, 51, 234],
  [2, 132, 199],
  [161, 98, 7],
  [100, 116, 139],
];

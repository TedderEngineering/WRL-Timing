/**
 * Alkamel "20_Pit Stops Time Cards" PDF reader, coordinate based (D-PIT-PASSAGE, AO6).
 *
 * Rewrite of utils/parseAlkamelPitStopPdf.ts per FACT_ENGINE_SPEC.md §3: the page is split at
 * mid-width into its two columns, text items are grouped into lines by y, and each line is matched
 * against the card-row pattern. Durations accept SS.mmm, M:SS.mmm and H:MM:SS.mmm. The car header
 * is kept as the exported string ('007' ≠ '7'); the current car carries over across columns/pages.
 */
import type { PdfPage, PdfTextItem } from "../types.js";

const T = String.raw`\d{1,2}:\d{2}:\d{2}\.\d{3}`;
const D = String.raw`(?:\d+:)?\d{1,2}(?::\d{2})?\.\d{3}`;
const ROW = new RegExp(String.raw`^(\d{1,2})\s*(${T})\s*(.*?)\s*(${T})\s*(.*?)\s+(${D})\s+(${D})\s*$`);
const ROW_NOTOTAL = new RegExp(String.raw`^(\d{1,2})\s*(${T})\s*(.*?)\s*(${T})\s*(.*?)\s+(${D})\s*$`);
const HDR = /^(\d{1,3})(?:\s+(.*))?$/;
const HAS_T = new RegExp(T);

export interface PdfCardRow {
  car: string;
  nr: number;
  inTime: string;
  inDriver: string;
  outTime: string;
  outDriver: string;
  pitTime: string;
  totalPitTime: string | null;
  page: number;
}

export interface PdfCardsResult {
  cards: PdfCardRow[];
  orphans: Omit<PdfCardRow, "car">[];
}

interface Line {
  top: number;
  x0: number;
  text: string;
}

function colLines(items: PdfTextItem[], yTol = 3.0): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: { top: number; items: PdfTextItem[] }[] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.top - it.y) <= yTol) g.items.push(it);
    else groups.push({ top: it.y, items: [it] });
  }
  return groups.map((g) => {
    const its = g.items.sort((a, b) => a.x - b.x);
    return { top: g.top, x0: its[0].x, text: its.map((i) => i.str.trim()).filter(Boolean).join(" ") };
  });
}

export function parsePitCardsPdf(pages: PdfPage[]): PdfCardsResult {
  const cards: PdfCardRow[] = [];
  const orphans: Omit<PdfCardRow, "car">[] = [];
  let cur: string | null = null;
  pages.forEach((page, pi) => {
    const mid = page.width / 2;
    for (const side of [0, 1]) {
      const items = page.items.filter((it) => (it.x < mid) === (side === 0));
      const colX = mid * side;
      for (const l of colLines(items)) {
        const m = ROW.exec(l.text) ?? ROW_NOTOTAL.exec(l.text);
        if (m) {
          const rec = {
            nr: Number(m[1]),
            inTime: m[2],
            inDriver: m[3].trim(),
            outTime: m[4],
            outDriver: m[5].trim(),
            pitTime: m[6],
            totalPitTime: m.length > 7 && m[7] !== undefined ? m[7] : null,
            page: pi + 1,
          };
          if (cur === null) orphans.push(rec);
          else cards.push({ car: cur, ...rec });
          continue;
        }
        const h = HDR.exec(l.text);
        if (h && l.x0 < colX + 75 && !HAS_T.test(l.text)) cur = h[1];
      }
    }
  });
  return { cards, orphans };
}

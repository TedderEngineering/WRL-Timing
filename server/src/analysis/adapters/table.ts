/**
 * Line-numbered table reader on top of the audited csv-utils parser (parseDelimitedCSV,
 * FACT_ENGINE_SPEC.md §3: reuse). Each physical line is parsed on its own so every row keeps its
 * 1-based source line number for fact provenance ('f1:L119').
 */
import { parseDelimitedCSV } from "../../utils/parsers/csv-utils.js";

export interface TableRow {
  line: number;
  get(name: string): string;
  has(name: string): boolean;
}

export interface Table {
  headers: string[];
  rows: TableRow[];
  hasColumn(name: string): boolean;
}

export function readTable(text: string, delimiter?: string): Table {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/);
  let headerIdx = 0;
  while (headerIdx < lines.length && !lines[headerIdx].trim()) headerIdx++;
  const first = lines[headerIdx] ?? "";
  const delim = delimiter ?? (first.includes(";") ? ";" : first.includes("\t") ? "\t" : ",");
  const headers = (parseDelimitedCSV(first, delim)[0] ?? []).map((h) => h.trim());
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    if (!index.has(h.toLowerCase())) index.set(h.toLowerCase(), i);
  });
  const rows: TableRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const cells = parseDelimitedCSV(raw, delim)[0];
    if (!cells || cells.every((c) => !c.trim())) continue;
    const line = i + 1;
    rows.push({
      line,
      get(name: string) {
        const k = index.get(name.toLowerCase());
        return k === undefined || k >= cells.length ? "" : (cells[k] ?? "").trim();
      },
      has(name: string) {
        return index.has(name.toLowerCase());
      },
    });
  }
  return {
    headers,
    rows,
    hasColumn: (name: string) => index.has(name.toLowerCase()),
  };
}

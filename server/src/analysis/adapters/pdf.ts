/**
 * PDF text items with coordinates (FACT_ENGINE_SPEC.md §3: pdf-extract.ts "must return text items
 * with x/y"). This is the only async/I-O-adjacent step; it runs before the pure engine.
 */
import type { PdfPage } from "../types.js";

let pdfjs: any = null;

async function getPdfjs(): Promise<any> {
  if (!pdfjs) {
    // pdfjs-dist is already a dependency of pdf-parse v2; the legacy build runs on Node.
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  }
  return pdfjs;
}

export async function loadPdfPages(data: Uint8Array | Buffer): Promise<PdfPage[]> {
  const lib = await getPdfjs();
  const bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const doc = await lib.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const pages: PdfPage[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items as any[]) {
        if (typeof it.str !== "string" || !it.str.trim()) continue;
        const [, , , d, e, f] = it.transform as number[];
        // Convert to top-down y like pdfplumber ('top'), so lines sort top to bottom.
        items.push({ str: it.str, x: e, y: vp.height - f, width: it.width, height: Math.abs(d) || it.height });
      }
      pages.push({ width: vp.width, height: vp.height, items });
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

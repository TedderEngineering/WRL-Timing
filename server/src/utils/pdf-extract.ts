/**
 * PDF text extraction utility.
 *
 * Accepts either a raw Buffer or a base64-encoded string (optionally prefixed
 * with "base64:" or "data:application/pdf;base64,") and returns the extracted
 * plain text.
 */

// pdf-parse v2 exports PDFParse class
let _PDFParse: any = null;

async function getPdfParser() {
  if (!_PDFParse) {
    const mod = await import("pdf-parse");
    _PDFParse = (mod as any).PDFParse || (mod as any).default || mod;
  }
  return _PDFParse;
}

/**
 * Detect whether a file string is base64-encoded binary (PDF, etc.).
 * Returns the raw base64 payload (without prefix) or null if it's plain text.
 */
export function extractBase64(input: string): string | null {
  // "data:application/pdf;base64,AAAA..."
  const dataUriMatch = input.match(
    /^data:application\/pdf;base64,(.+)$/s
  );
  if (dataUriMatch) return dataUriMatch[1];

  // "base64:AAAA..."
  if (input.startsWith("base64:")) return input.slice(7);

  return null;
}

/**
 * Extract text from a PDF.
 *
 * @param input  A base64 string (with or without prefix) or a raw Buffer
 * @returns      Extracted plain text
 */
export async function extractPdfText(input: string | Buffer): Promise<string> {
  let buf: Buffer;
  if (Buffer.isBuffer(input)) {
    buf = input;
  } else {
    const b64 = extractBase64(input);
    if (b64) {
      buf = Buffer.from(b64, "base64");
    } else {
      // Maybe it's raw base64 without a prefix — try to decode
      // Check if it looks like base64 (only valid chars, no newlines with non-b64 content)
      if (/^[A-Za-z0-9+/\n\r]+=*$/.test(input.slice(0, 200))) {
        buf = Buffer.from(input, "base64");
      } else {
        throw new Error(
          "PDF input is not a valid base64 string or Buffer"
        );
      }
    }
  }

  if (buf.length < 10 || buf.toString("ascii", 0, 5) !== "%PDF-") {
    throw new Error("Input does not appear to be a valid PDF (missing %PDF- header)");
  }

  const PDFParse = await getPdfParser();
  const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const parser = new PDFParse(uint8);
  await parser.load();
  const text = await parser.getText();
  return text;
}

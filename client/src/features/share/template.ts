/**
 * The share-card template shared by RaceTrace and Finding Grip
 * (ENGAGEMENT_PRINCIPLES "Share card": one template and brand family).
 *
 * A 1080×1350 PNG drawn in the browser. Slots, top to bottom:
 *   header   product icon and name (from the site)
 *   title    e.g. "INDY R1" or "#67 Supra"
 *   subtitle e.g. "Indianapolis · Oct 10, 2026 · Dry"
 *   body     drawn by the site into `box` (four pressures, a position trace…)
 *   fact     optional one-line fact, e.g. "Came in within 0.3 PSI on all four corners"
 *   footer   site address on the left, Tedder Engineering logo on the right
 * Colours come from each site's tokens (SITE_STYLES). Text is IBM Plex Sans,
 * numbers IBM Plex Mono (SANS / MONO).
 *
 * Usage:
 *   const blob = await makeShareCard({ site: "findinggrip", title, subtitle,
 *     body: (ctx, box, style) => { ... }, fact: { text, tone: "good" } });
 *   await shareImage(blob, imageName(title), title);
 */
import { MONO, SANS, loadShareFonts } from "./fonts";

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
const PAD = 72;

export type ShareSite = "racetrace" | "findinggrip";

export interface SiteStyle {
  name: string;
  /** Shown in the footer. */
  address: string;
  /** Square product icon, or null for the name alone. */
  icon: string | null;
  bg: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  /** For facts that report something going right ("on target"). */
  good: string;
}

/** Each site's colour tokens (RaceTrace's dark --rt-* tokens; Finding Grip's grays and orange). */
export const SITE_STYLES: Record<ShareSite, SiteStyle> = {
  racetrace: {
    name: "RaceTrace",
    address: "racetrace.tedderengineering.com",
    icon: "/racetrace-icon-192.png",
    bg: "#0b0b18",
    panel: "#12122a",
    border: "#1e1e38",
    text: "#e0e0e8",
    muted: "#9a9ab4",
    accent: "#F48C34",
    good: "#4ade80",
  },
  findinggrip: {
    name: "Finding Grip",
    address: "findinggrip.tedderengineering.com",
    icon: "/finding-grip-logo.png",
    bg: "#030712",
    panel: "#111827",
    border: "#1f2937",
    text: "#f3f4f6",
    muted: "#9ca3af",
    accent: "#ff6a00",
    good: "#3ddc97",
  },
};

const TE_LOGO = "/te-logo-white.png";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShareCardOptions {
  site: ShareSite;
  title: string;
  subtitle?: string;
  /** Draw the card's main content inside `box`. */
  body: (ctx: CanvasRenderingContext2D, box: Box, style: SiteStyle) => void;
  /** One short line of fact; "good" shows it in the site's good colour. */
  fact?: { text: string; tone?: "good" | "neutral" };
  /** Up to two facts side by side in the fact slot (in place of `fact`). */
  facts?: { text: string; tone?: "good" | "neutral" }[];
  /** A short badge at the top right of the header, beside the product name ("Overall Winner!"). */
  badge?: string;
}

// ─── Drawing helpers (also for body slots) ───────────────────────────────────

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Write text; shrinks the size until it fits `maxWidth` (long names). */
export function drawText(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  opts: {
    size: number;
    color: string;
    weight?: number;
    font?: "sans" | "mono";
    align?: CanvasTextAlign;
    maxWidth?: number;
  }
) {
  const family = opts.font === "mono" ? MONO : SANS;
  const weight = opts.weight ?? 500;
  let size = opts.size;
  ctx.font = `${weight} ${size}px ${family}`;
  if (opts.maxWidth) {
    while (size > 18 && ctx.measureText(s).width > opts.maxWidth) {
      size -= 2;
      ctx.font = `${weight} ${size}px ${family}`;
    }
  }
  ctx.fillStyle = opts.color;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(s, x, y);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ─── The template ────────────────────────────────────────────────────────────

/**
 * Draw a card on a 1080×1350 canvas. Async because it waits for the fonts and
 * logos first.
 */
export async function drawShareCard(
  ctx: CanvasRenderingContext2D,
  opts: ShareCardOptions
): Promise<void> {
  const style = SITE_STYLES[opts.site];
  const [, icon, teLogo] = await Promise.all([
    loadShareFonts(),
    style.icon ? loadImage(style.icon) : Promise.resolve(null),
    loadImage(TE_LOGO),
  ]);
  const W = CARD_WIDTH;
  const H = CARD_HEIGHT;

  // Background with a soft glow of the site's accent at the top right.
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 0, 40, W * 0.85, 0, 900);
  glow.addColorStop(0, hexAlpha(style.accent, 0.26));
  glow.addColorStop(1, hexAlpha(style.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Header: product icon and name.
  let nameX = PAD;
  if (icon) {
    ctx.save();
    roundRect(ctx, PAD, 64, 88, 88, 20);
    ctx.clip();
    ctx.drawImage(icon, PAD, 64, 88, 88);
    ctx.restore();
    nameX = PAD + 108;
  }
  drawText(ctx, style.name, nameX, 124, { size: 44, weight: 700, color: style.text });

  // Badge: right-aligned, level with the product name, in the site's accent.
  if (opts.badge) {
    const maxW = W - PAD - (nameX + 300);
    let size = 36;
    ctx.font = `800 ${size}px ${SANS}`;
    while (size > 22 && ctx.measureText(opts.badge).width + 64 > maxW) {
      size -= 2;
      ctx.font = `800 ${size}px ${SANS}`;
    }
    const bw = Math.min(maxW, ctx.measureText(opts.badge).width + 64);
    const bh = 76;
    const bx = W - PAD - bw;
    const by = 108 - bh / 2;
    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fillStyle = hexAlpha(style.accent, 0.16);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = style.accent;
    ctx.stroke();
    drawText(ctx, opts.badge, bx + bw / 2, by + bh / 2 + size * 0.36, { size, weight: 800, color: style.accent, align: "center" });
  }

  // Title and subtitle.
  drawText(ctx, opts.title, PAD, 270, {
    size: 64,
    weight: 700,
    color: style.text,
    maxWidth: W - PAD * 2,
  });
  if (opts.subtitle)
    drawText(ctx, opts.subtitle, PAD, 326, {
      size: 32,
      weight: 500,
      color: style.muted,
      maxWidth: W - PAD * 2,
    });

  // Body slot.
  const footerTop = H - 130;
  const factTop = footerTop - 40 - 96;
  const bodyBox: Box = {
    x: PAD,
    y: 380,
    w: W - PAD * 2,
    h: (opts.fact || opts.facts?.length ? factTop - 32 : footerTop - 40) - 380,
  };
  ctx.save();
  opts.body(ctx, bodyBox, style);
  ctx.restore();

  // Fact line: one pill, or two side by side.
  const pills = (opts.facts?.length ? opts.facts : opts.fact ? [opts.fact] : []).slice(0, 2);
  if (pills.length === 2) {
    const gap = 20;
    const w = (W - PAD * 2 - gap) / 2;
    pills.forEach((f, i) => {
      const x = PAD + i * (w + gap);
      const good = f.tone === "good";
      roundRect(ctx, x, factTop, w, 96, 48);
      ctx.fillStyle = good ? hexAlpha(style.good, 0.14) : style.panel;
      ctx.fill();
      drawText(ctx, f.text, x + w / 2, factTop + 60, { size: 30, weight: 600, color: good ? style.good : style.text, align: "center", maxWidth: w - 48 });
    });
  } else if (pills.length === 1) {
    const fact = pills[0];
    const good = fact.tone === "good";
    roundRect(ctx, PAD, factTop, W - PAD * 2, 96, 48);
    ctx.fillStyle = good ? hexAlpha(style.good, 0.14) : style.panel;
    ctx.fill();
    drawText(ctx, fact.text, W / 2, factTop + 62, {
      size: 36,
      weight: 600,
      color: good ? style.good : style.text,
      align: "center",
      maxWidth: W - PAD * 2 - 64,
    });
  }

  // Footer: site address left, Tedder Engineering logo right.
  ctx.fillStyle = style.border;
  ctx.fillRect(PAD, footerTop, W - PAD * 2, 2);
  drawText(ctx, style.address, PAD, H - 62, {
    size: 30,
    weight: 600,
    color: style.text,
    maxWidth: W - PAD * 2 - 260,
  });
  if (teLogo) {
    const h = 56;
    const w = (teLogo.width / teLogo.height) * h;
    ctx.drawImage(teLogo, W - PAD - w, H - 62 - h + 10, w, h);
  } else {
    drawText(ctx, "Tedder Engineering", W - PAD, H - 62, {
      size: 28,
      weight: 600,
      color: style.muted,
      align: "right",
    });
  }
}

/** Make a card as a PNG. */
export async function makeShareCard(opts: ShareCardOptions): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot make images");
  await drawShareCard(ctx, opts);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not make the image"))),
      "image/png"
    )
  );
}

/** "#ff6a00" + 0.2 → "rgba(255,106,0,0.2)" */
function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

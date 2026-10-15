/**
 * Finding Grip's share card: four cold pressures laid out like the car, the
 * track and date, and how the run came in when it has been recorded. Drawn
 * with the shared template (features/share). Results only, never how they
 * were calculated.
 */
import {
  drawText,
  imageName,
  makeShareCard,
  roundRect,
  useShareCard,
  type Box,
  type SiteStyle,
} from "@/features/share";
import type { Calculation } from "./api";
import { useGrip } from "./GripContext";
import { GripButton } from "./components";
import { verdict } from "./outcome";
import { formatPressure, pressureUnit, type Units } from "./units";

const CORNERS = ["lf", "rf", "lr", "rr"] as const;

function drawPressures(
  ctx: CanvasRenderingContext2D,
  box: Box,
  style: SiteStyle,
  c: Calculation,
  units: Units
) {
  const u = pressureUnit(units);
  drawText(ctx, "COLD TIRE PRESSURE TO SET", box.x, box.y + 30, {
    size: 26,
    weight: 700,
    color: style.muted,
  });

  const top = box.y + 64;
  const gap = 28;
  const mid = 124;
  const boxW = (box.w - mid) / 2;
  const boxH = Math.min(260, (box.y + box.h - top - gap) / 2);
  const pos = {
    lf: [box.x, top],
    rf: [box.x + boxW + mid, top],
    lr: [box.x, top + boxH + gap],
    rr: [box.x + boxW + mid, top + boxH + gap],
  } as const;
  for (const k of CORNERS) {
    const [x, y] = pos[k];
    roundRect(ctx, x, y, boxW, boxH, 28);
    ctx.fillStyle = "rgba(255,106,0,0.10)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = style.accent;
    ctx.stroke();
    drawText(ctx, k.toUpperCase(), x + 30, y + 52, {
      size: 28,
      weight: 700,
      color: style.muted,
    });
    drawText(ctx, formatPressure(c.result[k], units), x + 30, y + boxH * 0.66, {
      size: 100,
      weight: 700,
      font: "mono",
      color: style.accent,
      maxWidth: boxW - 120,
    });
    drawText(ctx, u, x + boxW - 30, y + boxH * 0.66, {
      size: 30,
      weight: 600,
      color: style.muted,
      align: "right",
    });
    drawText(
      ctx,
      `for ${formatPressure(c.target[k], units)} hot`,
      x + 30,
      y + boxH - 30,
      {
        size: 26,
        weight: 500,
        color: style.muted,
      }
    );
  }

  // A simple car outline between the corners, front at the top.
  const cx = box.x + boxW + 22;
  const cw = mid - 44;
  const ch = boxH * 2 + gap - 40;
  ctx.lineWidth = 3;
  ctx.strokeStyle = style.border;
  roundRect(ctx, cx, top + 20, cw, ch, 40);
  ctx.stroke();
  roundRect(ctx, cx + 16, top + ch * 0.28, cw - 32, ch * 0.22, 14);
  ctx.stroke();
  drawText(ctx, "FRONT", cx + cw / 2, top + 66, {
    size: 18,
    weight: 700,
    color: style.muted,
    align: "center",
  });
}

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/** The PNG for one calculation (and its outcome, when recorded). */
export function makePressureCard(c: Calculation, units: Units): Promise<Blob> {
  const o = c.outcome;
  return makeShareCard({
    site: "findinggrip",
    title: c.name,
    subtitle: `${c.track.name} · ${dateText(c.sessionDate)} · ${c.weather === "WET" ? "Wet" : "Dry"}`,
    body: (ctx, box, style) => drawPressures(ctx, box, style, c, units),
    // A fact only when there is one: how the run came in.
    fact: o
      ? {
          text: (o.onTarget ? "✓ " : "") + verdict(o, units).title,
          tone: o.onTarget ? "good" : "neutral",
        }
      : undefined,
  });
}

/** "Share" for a calculation: the phone's share sheet, or a download on a computer. */
export function SharePressuresButton({
  calc,
  variant = "secondary",
}: {
  calc: Calculation;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const { units, toast } = useGrip();
  const { share, busy } = useShareCard();
  const go = async () => {
    try {
      const method = await share({
        make: () => makePressureCard(calc, units),
        filename: imageName("finding-grip", calc.name),
        text: `${calc.name} · Finding Grip`,
        kind: "pressures",
      });
      if (method === "download") toast("Image saved. Send it to your crew.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not make the image");
    }
  };
  return (
    <GripButton size="sm" variant={variant} loading={busy} onClick={go}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="mr-1.5 h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
      </svg>
      Share
    </GripButton>
  );
}

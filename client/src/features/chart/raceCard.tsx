/**
 * RaceTrace's share card (engagement plan G): one car's race on the shared template
 * (features/share, the same 1080×1350 card family as Finding Grip's pressures card).
 *
 *   title     "#67 Blackdog Racing"
 *   subtitle  "Pilot Challenge — VIR · Oct 10, 2026"
 *   body      the car's class position lap by lap against its class (a small position trace),
 *             its pit stops marked, then its finish and pit cycles as facts
 *   fact      its best class benchmark ("Quickest stop of 7 in GTO · lap 63"), in good colour
 *
 * Facts only, as on the page; nothing about how other cars did beyond the trace itself.
 */
import { createContext, useContext } from "react";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { drawText, imageName, makeShareCard, roundRect, type Box, type SiteStyle } from "@/features/share";
import { ShareImageActions } from "@/features/share/ShareImageActions";
import { classBenchmarks, classCycleNets } from "./benchmarks";
import { finishInfo } from "./finish";

/** The race page's name, track and date, for cards drawn from inside the chart. */
export interface RaceMeta {
  id: string;
  name: string;
  track: string;
  date: string;
}
export const RaceMetaContext = createContext<RaceMeta | null>(null);

function drawTrace(ctx: CanvasRenderingContext2D, box: Box, style: SiteStyle, data: RaceChartData, carNum: number) {
  const car = data.cars[String(carNum)];
  const classCars = Object.values(data.cars).filter((c) => c.cls === car.cls);
  const n = Math.max(2, ...classCars.flatMap((c) => c.laps.map((l) => l.cp)));
  const maxLap = Math.max(1, data.maxLap);
  const x = (lap: number) => box.x + 24 + ((lap - 1) / Math.max(1, maxLap - 1)) * (box.w - 48);
  const y = (cp: number) => box.y + 70 + ((cp - 1) / (n - 1)) * (box.h - 110);

  roundRect(ctx, box.x, box.y, box.w, box.h, 28);
  ctx.fillStyle = style.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = style.border;
  ctx.stroke();
  drawText(ctx, `POSITION IN ${car.cls.toUpperCase()} · LAPS 1–${maxLap}`, box.x + 24, box.y + 44, { size: 24, weight: 600, color: style.muted, font: "mono" });

  const line = (laps: { l: number; cp: number }[], color: string, width: number) => {
    ctx.beginPath();
    laps.forEach((l, i) => (i ? ctx.lineTo(x(l.l), y(l.cp)) : ctx.moveTo(x(l.l), y(l.cp))));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  };
  for (const c of classCars) if (c !== car) line(c.laps, "rgba(140,145,200,0.28)", 3);
  // The car's pit stops, as faint bands behind its line.
  for (const l of car.laps.filter((l) => l.pit === 1)) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x(l.l) - 5, box.y + 60, 10, box.h - 90);
  }
  line(car.laps, style.accent, 7);
  const last = car.laps[car.laps.length - 1];
  if (last) {
    ctx.beginPath();
    ctx.arc(x(last.l), y(last.cp), 11, 0, Math.PI * 2);
    ctx.fillStyle = style.accent;
    ctx.fill();
  }
}

export function drawRaceCarBody(
  ctx: CanvasRenderingContext2D,
  box: Box,
  style: SiteStyle,
  data: RaceChartData,
  annotations: AnnotationData | null,
  carNum: number
) {
  const car = data.cars[String(carNum)];
  const f = finishInfo(data, carNum);
  const lines: string[] = [];
  if (f) {
    lines.push(
      f.pos !== null ? `Finished P${f.posClass ?? "?"} in ${car.cls} · P${f.pos} overall · ${car.laps.length} laps` : `${f.official} · ${car.laps.length} laps`
    );
  }
  const nets = classCycleNets(car.laps, annotations?.[String(carNum)]?.settles ?? []);
  nets.forEach((net, i) => lines.push(`Pit cycle ${i + 1}: ${net > 0 ? `gained ${net}` : net < 0 ? `lost ${-net}` : "held position"} in ${car.cls}`));
  const shown = lines.slice(0, 4);
  const lineH = 52;
  const traceH = box.h - shown.length * lineH - 24;
  drawTrace(ctx, { ...box, h: traceH }, style, data, carNum);
  shown.forEach((t, i) =>
    drawText(ctx, t, box.x, box.y + traceH + 56 + i * lineH, { size: 32, weight: i === 0 ? 600 : 500, color: i === 0 ? style.text : style.muted, maxWidth: box.w })
  );
}

export function raceCardText(data: RaceChartData, carNum: number, meta: RaceMeta): { title: string; subtitle: string } {
  const car = data.cars[String(carNum)];
  const date = new Date(meta.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return { title: `#${car.label ?? car.num ?? carNum} ${car.team}`, subtitle: `${meta.name} · ${date}` };
}

export function makeRaceCarCard(data: RaceChartData, annotations: AnnotationData | null, carNum: number, meta: RaceMeta): Promise<Blob> {
  const { title, subtitle } = raceCardText(data, carNum, meta);
  const best = classBenchmarks(data, annotations, carNum)[0];
  return makeShareCard({
    site: "racetrace",
    title,
    subtitle,
    body: (ctx, box, style) => drawRaceCarBody(ctx, box, style, data, annotations, carNum),
    fact: best ? { text: best.at ? `${best.text} · ${best.at}` : best.text, tone: "good" } : undefined,
  });
}

/** "Share image" for the focus car: the phone's share sheet with the PNG; on a computer, copy or download. */
export function ShareCarImageButton({ data, annotations, carNum }: { data: RaceChartData; annotations: AnnotationData | null; carNum: number }) {
  const meta = useContext(RaceMetaContext);
  if (!meta || !data.cars[String(carNum)]) return null;
  const { title } = raceCardText(data, carNum, meta);
  return (
    <ShareImageActions
      make={() => makeRaceCarCard(data, annotations, carNum, meta)}
      filename={imageName("racetrace", `${title} ${meta.name}`)}
      text={`${title} · ${meta.name} on RaceTrace`}
      kind="race_car"
      label="Share an image of this car's race"
      className="min-h-[36px] text-left text-[13px] hover:underline disabled:opacity-60"
    />
  );
}

/**
 * The driver card's share image (engagement plan G, same 1080×1350 template as the car card):
 *
 *   title     the driver, "Lucas Weisenberg"
 *   subtitle  the race and its date, "Pilot Challenge — Fox Factory 120 · Oct 2, 2026"
 *   body      the car ("#67 BSI Racing · GS · with Harrison Goodman"), then its overall position
 *             lap by lap against the whole field, the driver's own stints in the accent colour and
 *             the co-drivers' in white; under it the finish and the driver's drive
 *   fact      the driver's best lap when it was the quickest of the car's drivers, else the car's
 *             best class benchmark
 *
 * Facts only, as on the card. The race's chart data is fetched once per race and kept, and is
 * fetched ahead (shortly after the card shows) so that the phone's share sheet opens straight
 * from the tap.
 */
import { useEffect } from "react";
import type { ChartDataResponse, RaceChartData } from "@shared/types";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/prose";
import { drawText, imageName, makeShareCard, roundRect, sharedUrl, type Box, type SiteStyle } from "@/features/share";
import { ShareImageActions } from "@/features/share/ShareImageActions";
import { finishLine, type MyCarResponse } from "../dashboard/MyCarCard";
import type { MyDriverResponse } from "../dashboard/MyDriverCard";
import { displayName } from "./api";
import { driveTimeText } from "./stints";

type Race = NonNullable<MyCarResponse["race"]>;
type Car = NonNullable<MyDriverResponse["car"]>;
type Facts = NonNullable<MyCarResponse["facts"]>;
type Drive = NonNullable<MyDriverResponse["driverFacts"]>;

export interface DriverCardInput {
  driverName: string;
  race: Race;
  car: Car;
  facts: Facts | null;
  drive: Drive | null;
}

// ─── Chart data, once per race ───────────────────────────────────────────────

const charts = new Map<string, Promise<RaceChartData | null>>();

/** The race's chart data, or null when it can't be had (locked, offline): the card is drawn without the trace. */
export function loadRaceChart(raceId: string): Promise<RaceChartData | null> {
  let p = charts.get(raceId);
  if (!p) {
    p = api
      .get<ChartDataResponse>(`/races/${raceId}/chart-data`)
      .then((r) => r.data as unknown as RaceChartData)
      .catch(() => {
        charts.delete(raceId);
        return null;
      });
    charts.set(raceId, p);
  }
  return p;
}

/** The chart's key for a published car number ("67", "007", "4A"). */
export function chartCarKey(chart: RaceChartData, number: string): string | null {
  for (const [k, c] of Object.entries(chart.cars)) if ((c.label ?? k) === number) return k;
  return null;
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

const first = (name: string) => name.split(/\s+/)[0];
const OTHER_DRIVER = "#e0e0e8";

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The driver of each lap: true = the followed driver, false = a co-driver, null = not known. */
export function lapOwners(drive: Drive | null): (lap: number) => boolean | null {
  if (!drive?.known || drive.myStints === 0) return () => null;
  return (lap) => {
    const s = drive.stints.find((x) => x.start <= lap && lap <= x.end);
    return s ? s.mine : null;
  };
}

function drawOverallTrace(ctx: CanvasRenderingContext2D, box: Box, style: SiteStyle, chart: RaceChartData, key: string, input: DriverCardInput) {
  const car = chart.cars[key];
  const cars = Object.values(chart.cars);
  const n = Math.max(2, chart.totalCars || 0, ...cars.flatMap((c) => c.laps.map((l) => l.p)));
  const maxLap = Math.max(2, chart.maxLap);
  const left = box.x + 24;
  const right = box.x + box.w - 24;
  const top = box.y + 96;
  const bottom = box.y + box.h - 44;
  const x = (lap: number) => left + ((lap - 1) / (maxLap - 1)) * (right - left);
  const y = (p: number) => top + ((p - 1) / (n - 1)) * (bottom - top);

  roundRect(ctx, box.x, box.y, box.w, box.h, 28);
  ctx.fillStyle = style.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = style.border;
  ctx.stroke();
  drawText(ctx, `OVERALL POSITION · LAPS 1–${chart.maxLap}`, box.x + 24, box.y + 44, { size: 24, weight: 600, color: style.muted, font: "mono" });

  // Legend: the driver, and the co-drivers when the timing says who drove when.
  const owner = lapOwners(input.drive);
  const known = !!input.drive?.known && input.drive.myStints > 0;
  const legend: [string, string][] = known
    ? [
        [first(input.driverName), style.accent],
        [input.car.coDrivers.length ? list(input.car.coDrivers.map((d) => displayName(d))) : "Co-drivers", OTHER_DRIVER],
      ]
    : [[`#${input.car.number}`, style.accent]];
  let lx = box.x + 24;
  for (const [label, color] of legend) {
    ctx.fillStyle = color;
    ctx.fillRect(lx, box.y + 62, 18, 18);
    drawText(ctx, label, lx + 28, box.y + 79, { size: 22, weight: 500, color: style.muted, maxWidth: box.w / 2 - 80 });
    lx += 28 + Math.min(ctx.measureText(label).width, box.w / 2 - 80) + 32;
  }

  // Cautions, as soft bands.
  for (const [s, e] of chart.fcy ?? []) {
    const x0 = Math.max(left, x(s - 0.5));
    const x1 = Math.min(right, x(e + 0.5));
    if (x1 <= x0) continue;
    ctx.fillStyle = "rgba(250,178,25,0.08)";
    ctx.fillRect(x0, top - 8, x1 - x0, bottom - top + 16);
  }

  const path = (laps: { l: number; p: number }[]) => {
    ctx.beginPath();
    laps.forEach((l, i) => (i ? ctx.lineTo(x(l.l), y(l.p)) : ctx.moveTo(x(l.l), y(l.p))));
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const c of cars) {
    if (c === car || !c.laps.length) continue;
    path(c.laps);
    ctx.strokeStyle = "rgba(140,145,200,0.18)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  // The car, segment by segment in its driver's colour.
  const laps = car.laps;
  for (let i = 1; i < laps.length; i++) {
    const mine = owner(laps[i].l);
    ctx.beginPath();
    ctx.moveTo(x(laps[i - 1].l), y(laps[i - 1].p));
    ctx.lineTo(x(laps[i].l), y(laps[i].p));
    ctx.strokeStyle = mine === false ? OTHER_DRIVER : style.accent;
    ctx.lineWidth = 7;
    ctx.stroke();
  }
  const last = laps[laps.length - 1];
  if (last) {
    ctx.beginPath();
    ctx.arc(x(last.l), y(last.p), 11, 0, Math.PI * 2);
    ctx.fillStyle = owner(last.l) === false ? OTHER_DRIVER : style.accent;
    ctx.fill();
  }
  // The scale: P1 at the top, the last place at the bottom (the finish itself is in the text below,
  // from the results, which can differ from the last crossing after penalties).
  drawText(ctx, "P1", right, top - 14, { size: 20, weight: 600, color: style.muted, font: "mono", align: "right" });
  drawText(ctx, `P${n}`, right, bottom + 32, { size: 20, weight: 600, color: style.muted, font: "mono", align: "right" });
}

/** The lines under the trace: the finish, then the driver's drive (or the car's best lap). */
export function driverCardLines(input: DriverCardInput): string[] {
  const { facts, drive, driverName } = input;
  const out: string[] = [];
  if (facts) out.push(`${finishLine(facts)} · ${facts.laps} laps`);
  if (drive?.known && drive.myStints > 0) {
    const share = drive.carTimeS > 0 ? ` (${Math.round((drive.driveTimeS / drive.carTimeS) * 100)}%)` : "";
    const best = drive.bestLap ? ` · best lap ${formatDuration(drive.bestLap.sec)}` : "";
    out.push(`${first(driverName)}: ${driveTimeText(drive.driveTimeS)}${share} · ${drive.myStints} stint${drive.myStints === 1 ? "" : "s"}${best}`);
  } else if (facts?.bestLap) {
    out.push(`Car's best lap ${formatDuration(facts.bestLap.sec)} on lap ${facts.bestLap.lap}`);
  }
  return out;
}

export function driverCardFact(input: DriverCardInput): { text: string; tone: "good" } | undefined {
  const r = input.drive?.bestRank;
  if (r && r.rank === 1 && r.of > 1 && input.drive?.bestLap) return { text: `Quickest lap of the car's ${r.of} drivers`, tone: "good" };
  const b = input.facts?.benchmarks?.[0];
  return b ? { text: b, tone: "good" } : undefined;
}

function drawBody(ctx: CanvasRenderingContext2D, box: Box, style: SiteStyle, chart: RaceChartData | null, input: DriverCardInput) {
  const { car } = input;
  const carLine = `#${car.number} ${car.team} · ${car.cls}${car.coDrivers.length ? ` · with ${list(car.coDrivers.map((d) => displayName(d)))}` : ""}`;
  drawText(ctx, carLine, box.x, box.y + 30, { size: 30, weight: 600, color: style.text, maxWidth: box.w });
  const lines = driverCardLines(input);
  const lineH = 52;
  const traceTop = box.y + 64;
  const traceH = box.h - (traceTop - box.y) - lines.length * lineH - 24;
  const key = chart ? chartCarKey(chart, car.number) : null;
  if (chart && key) drawOverallTrace(ctx, { x: box.x, y: traceTop, w: box.w, h: traceH }, style, chart, key, input);
  lines.forEach((t, i) =>
    drawText(ctx, t, box.x, traceTop + (chart && key ? traceH : 0) + 56 + i * lineH, {
      size: 32,
      weight: i === 0 ? 600 : 500,
      color: i === 0 ? style.text : style.muted,
      maxWidth: box.w,
    }),
  );
}

export function driverCardText(input: DriverCardInput): { title: string; subtitle: string } {
  const date = new Date(input.race.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return { title: input.driverName, subtitle: `${input.race.name} · ${date}` };
}

export async function makeDriverCard(input: DriverCardInput): Promise<Blob> {
  const chart = await loadRaceChart(input.race.id);
  const { title, subtitle } = driverCardText(input);
  return makeShareCard({
    site: "racetrace",
    title,
    subtitle,
    body: (ctx, box, style) => drawBody(ctx, box, style, chart, input),
    fact: driverCardFact(input),
  });
}

/** The race page for the car, tagged as a shared link. */
export function driverShareUrl(input: DriverCardInput): string {
  return sharedUrl(`/chart?race=${input.race.id}&car=${encodeURIComponent(input.car.number)}`);
}

/**
 * "Share" on the driver card: on a phone, the share sheet with the image and a link to the race
 * (Messages, Instagram, WhatsApp, X…); on a computer, copy the image or download it.
 */
export function ShareDriverCardButton({ input }: { input: DriverCardInput }) {
  const raceId = input.race.id;
  useEffect(() => {
    // Fetch the race's chart shortly after the card shows, so the share sheet opens from the tap.
    const t = window.setTimeout(() => void loadRaceChart(raceId), 1200);
    return () => window.clearTimeout(t);
  }, [raceId]);
  const { title } = driverCardText(input);
  return (
    <ShareImageActions
      make={() => makeDriverCard(input)}
      filename={imageName("racetrace", `${title} ${input.race.name}`)}
      text={`${title} · ${input.race.name} on RaceTrace ${driverShareUrl(input)}`}
      kind="driver_race"
      label={`Share ${first(input.driverName)}'s race card`}
      className="min-h-[36px] text-left text-sm font-semibold hover:underline disabled:opacity-60"
    />
  );
}

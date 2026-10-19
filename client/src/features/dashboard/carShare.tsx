/**
 * The car's share card (1080×1350, the shared template), laid out like the dashboard's car card:
 *
 *   title     "#120 AE Victory Racing"
 *   subtitle  the race and its date
 *   body      class and drivers; the result; best lap, stops and places over the pit cycles; the
 *             car's class position lap by lap, coloured by who was driving, with its stops marked;
 *             the drivers' stint bar with their time at the wheel; the pit cycles, one tile each
 *   fact      the car's best class benchmark ("Quickest stop of 7 in GTO, lap 61")
 *
 * Facts only, as on the card. Two places make it: the dashboard's car card (its own data) and the
 * race page's car panel (GET /races/:id/car-card). The chart for the trace is fetched once per race.
 */
import { useEffect } from "react";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/prose";
import { SANS, drawText, imageName, makeShareCard, roundRect, type Box, type SiteStyle } from "@/features/share";
import { ShareImageActions } from "@/features/share/ShareImageActions";
import { isComputer } from "@/features/share/shareImage";
import { loadRaceChartWithNotes, primeRaceChart } from "../my-drivers/driverCard";
import { displayName } from "../my-drivers/api";
import { driveTimeText } from "../my-drivers/stints";
import { finishLine, type CarDriveFacts, type MyCarResponse } from "./MyCarCard";

type Facts = NonNullable<MyCarResponse["facts"]>;

export interface CarCardInput {
  race: { id: string; name: string; date: string; track: string };
  number: string;
  team: string;
  cls: string;
  /** The entry's drivers, display-cased. */
  drivers: string[];
  facts: Facts;
  drive: CarDriveFacts | null;
}

/** Each driver's colour, in the order they first drove (as the dashboard card). */
export const CARD_DRIVER_COLORS = ["#F48C34", "#7aa2ff", "#a78bfa", "#2dd4bf", "#9a9ab4"];
const BAD = "#e66767";
const ORDINAL = ["", "fastest", "2nd fastest", "3rd fastest"];

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/** The colour of the driver of each lap (null: the car's own accent, the timing names nobody). */
export function lapColor(drive: CarDriveFacts | null): (lap: number) => string | null {
  if (!drive?.known || !drive.drivers.length) return () => null;
  const idx = (name: string | null) => (name ? drive.drivers.findIndex((d) => displayName(d.name) === displayName(name)) : -1);
  return (lap) => {
    const s = drive.stints.find((x) => x.start <= lap && lap <= x.end);
    const i = s ? idx(s.driver) : -1;
    return i < 0 ? null : CARD_DRIVER_COLORS[i % CARD_DRIVER_COLORS.length];
  };
}

/** The result line under the class and drivers ("Finished P1 in GTO of 16 · P1 overall · 175 laps"). */
export function carCardResult(f: Facts): string {
  return f.finished === false ? finishLine(f) : `${finishLine(f)} · ${f.laps} laps`;
}

/** The three stats: best lap, stops, places over the pit cycles. */
export function carCardStats(f: Facts, drive: CarDriveFacts | null): { value: string; sub: string; tone?: "good" | "bad" }[] {
  const cycles = f.pitCycles;
  const net = cycles.reduce((a, c) => a + c.net, 0);
  const stops = drive && drive.stints.length > 0 ? drive.stints.length - 1 : cycles.length;
  const out: { value: string; sub: string; tone?: "good" | "bad" }[] = [
    {
      value: f.bestLap ? formatDuration(f.bestLap.sec) : "—",
      sub: f.bestLap ? `best lap${f.bestLapClassRank ? ` · ${ORDINAL[f.bestLapClassRank]} in ${f.cls}` : `, lap ${f.bestLap.lap}`}` : "no green lap",
    },
    { value: `${stops}`, sub: stops === 1 ? "pit stop" : "pit stops" },
  ];
  if (cycles.length) {
    out.push({
      value: signed(net),
      sub: `place${Math.abs(net) === 1 ? "" : "s"} in ${f.cls} over ${cycles.length} pit cycle${cycles.length === 1 ? "" : "s"}`,
      tone: net > 0 ? "good" : net < 0 ? "bad" : undefined,
    });
  }
  return out;
}

function panel(ctx: CanvasRenderingContext2D, b: Box, style: SiteStyle, r = 24) {
  roundRect(ctx, b.x, b.y, b.w, b.h, r);
  ctx.fillStyle = style.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = style.border;
  ctx.stroke();
}

function drawTrace(ctx: CanvasRenderingContext2D, box: Box, style: SiteStyle, chart: RaceChartData, key: string, input: CarCardInput) {
  const car = chart.cars[key];
  const classCars = Object.values(chart.cars).filter((c) => c.cls === car.cls && c.laps.length);
  const n = Math.max(2, ...classCars.flatMap((c) => c.laps.map((l) => l.cp)));
  const maxLap = Math.max(2, chart.maxLap);
  const left = box.x + 24;
  const right = box.x + box.w - 24;
  const top = box.y + 64;
  const bottom = box.y + box.h - 28;
  const x = (lap: number) => left + ((lap - 1) / (maxLap - 1)) * (right - left);
  const y = (p: number) => top + ((p - 1) / (n - 1)) * (bottom - top);
  panel(ctx, box, style);
  drawText(ctx, `POSITION IN ${input.cls.toUpperCase()} · LAPS 1–${chart.maxLap}`, box.x + 24, box.y + 42, { size: 22, weight: 600, color: style.muted, font: "mono" });
  drawText(ctx, "P1", right, box.y + 42, { size: 20, weight: 600, color: style.muted, font: "mono", align: "right" });
  // Cautions, as soft bands; the car's stops, as faint lines.
  for (const [s, e] of chart.fcy ?? []) {
    const x0 = Math.max(left, x(s - 0.5));
    const x1 = Math.min(right, x(e + 0.5));
    if (x1 > x0) {
      ctx.fillStyle = "rgba(250,178,25,0.08)";
      ctx.fillRect(x0, top - 6, x1 - x0, bottom - top + 12);
    }
  }
  for (const l of car.laps.filter((l) => l.pit === 1)) {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(x(l.l) - 3, top - 6, 6, bottom - top + 12);
  }
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const c of classCars) {
    if (c === car) continue;
    ctx.beginPath();
    c.laps.forEach((l, i) => (i ? ctx.lineTo(x(l.l), y(l.cp)) : ctx.moveTo(x(l.l), y(l.cp))));
    ctx.strokeStyle = "rgba(140,145,200,0.22)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  const color = lapColor(input.drive);
  const laps = car.laps;
  for (let i = 1; i < laps.length; i++) {
    ctx.beginPath();
    ctx.moveTo(x(laps[i - 1].l), y(laps[i - 1].cp));
    ctx.lineTo(x(laps[i].l), y(laps[i].cp));
    ctx.strokeStyle = color(laps[i].l) ?? style.accent;
    ctx.lineWidth = 7;
    ctx.stroke();
  }
  const last = laps[laps.length - 1];
  if (last) {
    ctx.beginPath();
    ctx.arc(x(last.l), y(last.cp), 11, 0, Math.PI * 2);
    ctx.fillStyle = color(last.l) ?? style.accent;
    ctx.fill();
  }
}

function drawStints(ctx: CanvasRenderingContext2D, box: Box, style: SiteStyle, input: CarCardInput) {
  const drive = input.drive!;
  const total = Math.max(1, drive.stints.reduce((a, s) => a + s.end - s.start + 1, 0));
  const color = lapColor(drive);
  let x = box.x;
  const gap = 4;
  const usable = box.w - gap * (drive.stints.length - 1);
  for (const s of drive.stints) {
    const w = ((s.end - s.start + 1) / total) * usable;
    roundRect(ctx, x, box.y, Math.max(4, w), 16, 8);
    ctx.fillStyle = color(s.start) ?? style.border;
    ctx.fill();
    x += w + gap;
  }
  // The legend: each driver, their time at the wheel and share, laid out by width (smaller if it doesn't fit).
  const ly = box.y + 54;
  const items = drive.drivers.map((d) => ({
    name: displayName(d.name),
    time: `${driveTimeText(d.driveTimeS)}${drive.carTimeS > 0 ? ` · ${Math.round((d.driveTimeS / drive.carTimeS) * 100)}%` : ""}`,
  }));
  let nameSize = 24;
  let timeSize = 22;
  const widthAt = () => {
    let w = 0;
    for (const it of items) {
      ctx.font = `600 ${nameSize}px ${SANS}`;
      const nw = ctx.measureText(it.name).width;
      ctx.font = `500 ${timeSize}px ${SANS}`;
      w += 28 + nw + 8 + ctx.measureText(it.time).width + 28;
    }
    return w - 28;
  };
  while (nameSize > 16 && widthAt() > box.w) {
    nameSize -= 1;
    timeSize -= 1;
  }
  let lx = box.x;
  items.forEach((it, i) => {
    ctx.fillStyle = CARD_DRIVER_COLORS[i % CARD_DRIVER_COLORS.length];
    roundRect(ctx, lx, ly - 18, 18, 18, 4);
    ctx.fill();
    drawText(ctx, it.name, lx + 28, ly, { size: nameSize, weight: 600, color: style.text });
    const nw = ctx.measureText(it.name).width;
    drawText(ctx, it.time, lx + 28 + nw + 8, ly, { size: timeSize, color: style.muted });
    lx += 28 + nw + 8 + ctx.measureText(it.time).width + 28;
  });
}

function drawCycles(ctx: CanvasRenderingContext2D, box: Box, style: SiteStyle, f: Facts) {
  const cycles = f.pitCycles.slice(0, 8);
  const gap = 12;
  const w = (box.w - gap * (cycles.length - 1)) / cycles.length;
  const big = cycles.length <= 6 ? 30 : 24;
  cycles.forEach((c, i) => {
    const b = { x: box.x + i * (w + gap), y: box.y, w, h: box.h };
    const tone = c.net > 0 ? style.good : c.net < 0 ? BAD : style.muted;
    roundRect(ctx, b.x, b.y, b.w, b.h, 18);
    ctx.fillStyle = c.net === 0 ? style.panel : c.net > 0 ? "rgba(74,222,128,0.10)" : "rgba(230,103,103,0.12)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.net === 0 ? style.border : c.net > 0 ? "rgba(74,222,128,0.45)" : "rgba(230,103,103,0.5)";
    ctx.stroke();
    drawText(ctx, `${c.cycle} · ${c.stopLap ? `L${c.stopLap}` : `L${c.lap}`}`, b.x + 16, b.y + 30, { size: 18, color: style.muted, maxWidth: b.w - 28 });
    drawText(ctx, `P${c.before}→P${c.after}`, b.x + 16, b.y + 66, { size: big, weight: 700, color: style.text, maxWidth: b.w - 28 });
    drawText(ctx, c.net > 0 ? `+${c.net}` : c.net < 0 ? `−${-c.net}` : "Held", b.x + 16, b.y + 96, { size: 22, weight: 700, color: tone, maxWidth: b.w - 28 });
  });
}

export function drawCarCardBody(ctx: CanvasRenderingContext2D, box: Box, style: SiteStyle, chart: RaceChartData | null, input: CarCardInput) {
  const { facts: f } = input;
  let y = box.y;
  const named = !!input.drive?.known && input.drive.drivers.length > 0;
  // The drivers are in the stint legend; without it, they go under the result.
  drawText(ctx, carCardResult(f), box.x, y + 34, { size: 34, weight: 600, color: style.text, maxWidth: box.w });
  y += 56;
  if (!named && input.drivers.length) {
    drawText(ctx, list(input.drivers), box.x, y + 24, { size: 26, color: style.muted, maxWidth: box.w });
    y += 42;
  }

  // Best lap, stops, places over the pit cycles.
  const stats = carCardStats(f, input.drive);
  const sb = { x: box.x, y, w: box.w, h: 106 };
  panel(ctx, sb, style);
  stats.forEach((s, i) => {
    const cx = sb.x + 28 + (i * (sb.w - 28)) / stats.length;
    const color = s.tone === "good" ? style.good : s.tone === "bad" ? BAD : style.text;
    drawText(ctx, s.value, cx, sb.y + 52, { size: 44, weight: 700, color, font: i === 0 ? "mono" : "sans", maxWidth: (sb.w - 56) / stats.length - 16 });
    drawText(ctx, s.sub, cx, sb.y + 86, { size: 21, color: style.muted, maxWidth: (sb.w - 56) / stats.length - 16 });
  });
  y += sb.h + 20;

  const tilesH = f.pitCycles.length ? 108 : 0;
  const stintsH = named ? 74 : 0;
  const traceH = box.y + box.h - y - (stintsH ? stintsH + 18 : 0) - (tilesH ? tilesH + 20 : 0);
  const key = f.carKey && chart?.cars[f.carKey] ? f.carKey : null;
  if (chart && key && traceH > 120) {
    drawTrace(ctx, { x: box.x, y, w: box.w, h: traceH }, style, chart, key, input);
    y += traceH + 18;
  }
  if (named) {
    drawStints(ctx, { x: box.x, y, w: box.w, h: stintsH }, style, input);
    y += stintsH + 20;
  }
  if (tilesH) drawCycles(ctx, { x: box.x, y, w: box.w, h: tilesH }, style, f);
}

export function carCardText(input: CarCardInput): { title: string; subtitle: string } {
  const date = new Date(input.race.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return { title: `#${input.number} ${input.team}`, subtitle: `${input.race.name} · ${date}` };
}

export async function makeCarCard(input: CarCardInput): Promise<Blob> {
  const chart = await loadRaceChartWithNotes(input.race.id);
  const { title, subtitle } = carCardText(input);
  const fact = input.facts.benchmarks?.[0];
  return makeShareCard({
    site: "racetrace",
    title,
    subtitle,
    body: (ctx, box, style) => drawCarCardBody(ctx, box, style, chart?.data ?? null, input),
    fact: fact ? { text: fact, tone: "good" } : undefined,
  });
}

function ShareButton({ make, input, label }: { make: () => Promise<Blob>; input: { race: { name: string }; number: string; title: string }; label: string }) {
  return (
    <ShareImageActions
      make={make}
      filename={imageName("racetrace", `${input.title} ${input.race.name}`)}
      text={`${input.title} · ${input.race.name} on RaceTrace`}
      kind="race_car"
      label={label}
      className="min-h-[36px] text-left text-sm font-semibold hover:underline disabled:opacity-60"
    />
  );
}

/** "Share" on the dashboard's car card: everything is on the card already; the chart is fetched ahead on phones. */
export function ShareCarCardButton({ input }: { input: CarCardInput }) {
  const raceId = input.race.id;
  useEffect(() => {
    if (isComputer()) return;
    const t = window.setTimeout(() => void loadRaceChartWithNotes(raceId), 1200);
    return () => window.clearTimeout(t);
  }, [raceId]);
  const { title } = carCardText(input);
  return <ShareButton make={() => makeCarCard(input)} input={{ race: input.race, number: input.number, title }} label={`Share #${input.number}'s race card`} />;
}

// ─── The race page: the card's facts from the server ─────────────────────────

const carCards = new Map<string, Promise<CarCardInput | null>>();

export function loadCarCard(raceId: string, carNumber: string): Promise<CarCardInput | null> {
  const key = `${raceId}|${carNumber}`;
  let p = carCards.get(key);
  if (!p) {
    p = api
      .get<{ race: CarCardInput["race"]; car: { number: string; team: string; cls: string }; drivers: string[]; facts: Facts | null; drive: CarDriveFacts | null }>(
        `/races/${raceId}/car-card?car=${encodeURIComponent(carNumber)}`
      )
      .then((r) => (r.facts ? { race: r.race, number: r.car.number, team: r.car.team, cls: r.car.cls, drivers: r.drivers, facts: r.facts, drive: r.drive } : null))
      .catch(() => {
        carCards.delete(key);
        return null;
      });
    carCards.set(key, p);
  }
  return p;
}

/** "Share" in the race page's car panel: the same card, its facts from GET /races/:id/car-card. */
export function ShareRaceCarCardButton({
  raceId,
  raceName,
  carNumber,
  team,
  chart,
  annotations,
}: {
  raceId: string;
  raceName: string;
  carNumber: string;
  team: string;
  chart: RaceChartData;
  annotations: AnnotationData | null;
}) {
  useEffect(() => {
    primeRaceChart(raceId, chart, annotations);
    if (isComputer()) return;
    const t = window.setTimeout(() => void loadCarCard(raceId, carNumber), 1200);
    return () => window.clearTimeout(t);
  }, [raceId, carNumber, chart, annotations]);
  const make = async () => {
    const input = await loadCarCard(raceId, carNumber);
    if (!input) throw new Error("no card");
    return makeCarCard(input);
  };
  return <ShareButton make={make} input={{ race: { name: raceName }, number: carNumber, title: `#${carNumber} ${team}` }} label="Share an image of this car's race" />;
}

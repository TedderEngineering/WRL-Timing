/**
 * The driver card's share image (engagement plan G, same 1080×1350 template as the car card):
 *
 *   title     the driver, "Lucas Weisenberg"
 *   subtitle  the race and its date, "Pilot Challenge — Fox Factory 120 · Oct 2, 2026"
 *   body      the car ("#67 BSI Racing · GS · with Harrison Goodman"), then its overall position
 *             lap by lap against the whole field, the driver's own stints in the accent colour and
 *             the co-drivers' in white; under it the finish and the driver's drive
 *   fact      something the driver did for the car (laps led, a best lap in the class top three,
 *             bringing it home), never a comparison with the co-drivers; else the car's best class
 *             benchmark
 *
 * Facts only, as on the card. The race's chart data is fetched once per race and kept, and is
 * fetched ahead (shortly after the card shows) so that the phone's share sheet opens straight
 * from the tap.
 *
 * Two places make it: the dashboard's driver panel (any of a followed driver's races) and the race
 * page's Drivers list (any driver of the car in view, ShareRaceDriverCard), which fetches the
 * card's facts from GET /races/:id/driver-card.
 */
import { useEffect } from "react";
import type { AnnotationData, ChartDataResponse, RaceChartData } from "@shared/types";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/prose";
import { drawText, imageName, makeShareCard, roundRect, sharedUrl, type Box, type SiteStyle } from "@/features/share";
import { ShareImageActions } from "@/features/share/ShareImageActions";
import { isComputer } from "@/features/share/shareImage";
import { finishLine, type MyCarResponse } from "../dashboard/MyCarCard";
import type { MyDriverResponse } from "../dashboard/MyDriverCard";
import { displayName } from "./api";
import { driveTimeText, isSoloDrive } from "./stints";

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
  /** The driver's highlights, ranked (server); the first is the card's fact. */
  highlights?: { text: string }[];
}

// ─── Chart data, once per race ───────────────────────────────────────────────

const charts = new Map<string, Promise<{ data: RaceChartData; annotations: AnnotationData | null } | null>>();

/** The race's chart data and its notes (pit stops, cycles), once per race; null when they can't be had. */
export function loadRaceChartWithNotes(raceId: string): Promise<{ data: RaceChartData; annotations: AnnotationData | null } | null> {
  let p = charts.get(raceId);
  if (!p) {
    p = api
      .get<ChartDataResponse>(`/races/${raceId}/chart-data`)
      .then((r) => ({ data: r.data as unknown as RaceChartData, annotations: (r.annotations ?? null) as AnnotationData | null }))
      .catch(() => {
        charts.delete(raceId);
        return null;
      });
    charts.set(raceId, p);
  }
  return p;
}

/** The race's chart data, or null when it can't be had (locked, offline): the card is drawn without the trace. */
export function loadRaceChart(raceId: string): Promise<RaceChartData | null> {
  return loadRaceChartWithNotes(raceId).then((r) => r?.data ?? null);
}

/** The race page already has the chart: keep it for the card instead of fetching it again. */
export function primeRaceChart(raceId: string, chart: RaceChartData, annotations: AnnotationData | null = null): void {
  if (!charts.has(raceId)) charts.set(raceId, Promise.resolve({ data: chart, annotations }));
}

// ─── A driver's card facts for any race (the race page) ──────────────────────

type CardFacts = Omit<DriverCardInput, "driverName">;
const cardFacts = new Map<string, Promise<CardFacts | null>>();

/** The race, car, facts and drive for one driver of one car; null when it can't be had. */
export function loadDriverCardFacts(raceId: string, carNumber: string, driver: string): Promise<CardFacts | null> {
  const key = `${raceId}|${carNumber}|${driver}`;
  let p = cardFacts.get(key);
  if (!p) {
    const q = `car=${encodeURIComponent(carNumber)}&driver=${encodeURIComponent(driver)}`;
    p = api
      .get<{ race: Race; car: Car; facts: Facts | null; driverFacts: Drive | null; driverHighlights?: { text: string }[] }>(`/races/${raceId}/driver-card?${q}`)
      .then((r) => ({ race: r.race, car: r.car, facts: r.facts ?? null, drive: r.driverFacts ?? null, highlights: r.driverHighlights ?? [] }))
      .catch(() => {
        cardFacts.delete(key);
        return null;
      });
    cardFacts.set(key, p);
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
  const legend: [string, string][] = known && !isSoloDrive(input.drive!)
    ? [
        [first(input.driverName), style.accent],
        [input.car.coDrivers.length ? list(input.car.coDrivers.map((d) => displayName(d))) : "Co-drivers", OTHER_DRIVER],
      ]
    : [[known ? first(input.driverName) : `#${input.car.number}`, style.accent]];
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
  if (facts) out.push(facts.finished === false ? finishLine(facts) : `${finishLine(facts)} · ${facts.laps} laps`);
  if (drive?.known && drive.myStints > 0) {
    const best = drive.bestLap ? ` · best lap ${formatDuration(drive.bestLap.sec)}` : "";
    if (isSoloDrive(drive)) {
      // A single-driver car: the drive is the car's race, so no share and no stint count.
      out.push(`${first(driverName)}: ${driveTimeText(drive.driveTimeS)}${best}`);
    } else {
      const share = drive.carTimeS > 0 ? ` (${Math.round((drive.driveTimeS / drive.carTimeS) * 100)}%)` : "";
      out.push(`${first(driverName)}: ${driveTimeText(drive.driveTimeS)}${share} · ${drive.myStints} stint${drive.myStints === 1 ? "" : "s"}${best}`);
    }
    out.push(...stintAverageLines(drive));
  } else if (facts?.bestLap) {
    out.push(`Car's best lap ${formatDuration(facts.bestLap.sec)} on lap ${facts.bestLap.lap}`);
  }
  return out;
}

/**
 * The driver's stints with their average green lap: one line each for up to three ("Laps 61–89 ·
 * stint avg 2:20.104"), else one line of averages. None when no stint has one.
 */
export function stintAverageLines(drive: Drive): string[] {
  const mine = drive.stints.filter((s) => s.mine && s.avgLapS);
  if (!mine.length) return [];
  if (mine.length <= 3) {
    return mine.map((s) => `Laps ${s.start}–${s.end} · stint avg ${formatDuration(s.avgLapS!)}`);
  }
  return [`Stint averages ${mine.map((s) => formatDuration(s.avgLapS!)).join(" · ")}`];
}

const ORD = ["", "", "2nd ", "3rd "];

/**
 * The fact line: something the driver did for the car, never a comparison with the co-drivers
 * (they race together). In order: laps led while the driver was at the wheel (overall, else in
 * class); the driver's best lap among the class when it is the car's best and in the class top
 * three; bringing the car home when the driver drove the last stint and the car took the flag; else the car's own best
 * class benchmark (a team fact).
 */
export function driverCardFact(input: DriverCardInput, chart: RaceChartData | null = null, key: string | null = null): { text: string; tone: "good" } | undefined {
  const { drive, facts, car } = input;
  if (input.highlights?.length) return { text: input.highlights[0].text, tone: "good" };
  const mineKnown = !!drive?.known && drive.myStints > 0;
  const own = chart && key ? chart.cars[key] : null;
  if (mineKnown && own) {
    const owner = lapOwners(drive);
    const mine = own.laps.filter((l) => owner(l.l) === true);
    const ledOverall = mine.filter((l) => l.p === 1).length;
    const ledClass = mine.filter((l) => l.cp === 1).length;
    const laps = (n: number) => `${n} lap${n === 1 ? "" : "s"}`;
    if (ledOverall > 0) return { text: `Led the race overall for ${laps(ledOverall)}`, tone: "good" };
    if (ledClass > 0) return { text: `Led ${car.cls} for ${laps(ledClass)}`, tone: "good" };
  }
  if (mineKnown && own && chart && drive?.bestLap) {
    const best = (laps: { ltSec: number }[]) => Math.min(...laps.map((l) => l.ltSec).filter((t) => t > 0));
    const mineBest = drive.bestLap.sec;
    // Only when the car's best lap is the driver's (so "in class" is true for the car as well).
    if (Math.abs(best(own.laps) - mineBest) < 0.0015) {
      const others = Object.entries(chart.cars).filter(([k, c]) => k !== key && c.cls === own.cls && c.laps.length);
      const rank = 1 + others.filter(([, c]) => best(c.laps) < mineBest - 0.0005).length;
      if (rank <= 3) return { text: `Best lap ${formatDuration(mineBest)}, ${rank === 1 ? "quickest" : `${ORD[rank]}quickest`} in ${own.cls}`, tone: "good" };
    }
  }
  const last = drive?.stints[drive.stints.length - 1];
  // Only a car that took the flag was brought home.
  if (mineKnown && last?.mine && facts?.finishClass && facts.finished !== false) return { text: `Brought #${car.number} home P${facts.finishClass} in ${car.cls}`, tone: "good" };
  const b = facts?.benchmarks?.[0];
  return b ? { text: b, tone: "good" } : undefined;
}

function drawBody(ctx: CanvasRenderingContext2D, box: Box, style: SiteStyle, chart: RaceChartData | null, input: DriverCardInput) {
  const { car } = input;
  const carLine = `#${car.number} ${car.team} · ${car.cls}${car.coDrivers.length ? ` · with ${list(car.coDrivers.map((d) => displayName(d)))}` : ""}`;
  drawText(ctx, carLine, box.x, box.y + 30, { size: 30, weight: 600, color: style.text, maxWidth: box.w });
  const lines = driverCardLines(input);
  // The finish and drive lines at full size; the stint averages under them smaller.
  const small = (i: number) => i >= 2;
  const heightOf = (i: number) => (small(i) ? 42 : 52);
  const linesH = lines.reduce((h, _t, i) => h + heightOf(i), 0);
  const traceTop = box.y + 64;
  const traceH = box.h - (traceTop - box.y) - linesH - 24;
  const key = chart ? chartCarKey(chart, car.number) : null;
  if (chart && key) drawOverallTrace(ctx, { x: box.x, y: traceTop, w: box.w, h: traceH }, style, chart, key, input);
  let y = traceTop + (chart && key ? traceH : 0) + 56;
  lines.forEach((t, i) => {
    drawText(ctx, t, box.x, y, {
      size: small(i) ? 26 : 32,
      weight: i === 0 ? 600 : 500,
      color: i === 0 ? style.text : style.muted,
      maxWidth: box.w,
    });
    y += heightOf(i + 1 < lines.length ? i + 1 : i);
  });
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
    fact: driverCardFact(input, chart, chart ? chartCarKey(chart, input.car.number) : null),
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

/**
 * "Share" for one driver in the race page's Drivers list: the same card as the dashboard's, for
 * this race. On a phone the card's facts and the chart are fetched ahead, so the share sheet
 * opens from the tap.
 */
export function ShareRaceDriverCard({
  raceId,
  carNumber,
  driver,
  chart,
  annotations = null,
}: {
  raceId: string;
  carNumber: string;
  driver: string;
  chart?: RaceChartData;
  annotations?: AnnotationData | null;
}) {
  const name = displayName(driver);
  useEffect(() => {
    if (chart) primeRaceChart(raceId, chart, annotations);
    if (isComputer()) return;
    const t = window.setTimeout(() => void loadDriverCardFacts(raceId, carNumber, driver), 1200);
    return () => window.clearTimeout(t);
  }, [raceId, carNumber, driver, chart, annotations]);
  const make = async () => {
    const facts = await loadDriverCardFacts(raceId, carNumber, driver);
    if (!facts) throw new Error("no card");
    return makeDriverCard({ driverName: name, ...facts });
  };
  return (
    <ShareImageActions
      make={make}
      filename={imageName("racetrace", `${name} ${carNumber}`)}
      text={`${name} · #${carNumber} on RaceTrace ${sharedUrl(`/chart?race=${raceId}&car=${encodeURIComponent(carNumber)}`)}`}
      kind="driver_race"
      label={`Share ${first(name)}'s card`}
      className="min-h-[28px] text-left text-[12px] font-semibold hover:underline disabled:opacity-60"
    />
  );
}

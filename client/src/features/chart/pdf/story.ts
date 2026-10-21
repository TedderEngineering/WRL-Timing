/**
 * The Story as a PDF, on portrait pages: the race summary, each class's winner, the key moments,
 * post-race penalties, then every car's story class by class in finishing order. Or one car's
 * story alone: who drove it and where it finished, its story, the key moments it was part of, and
 * the race and its class in a line each. The words are the published analysis, as on the Story tab.
 */
import type { RaceStories } from "../StoryTab";
import { orderStories } from "../StoryTab";
import { proseToText, type ProseContext } from "../../../lib/prose";
import { C, M, FOOT_H, fill, footer, ink, newPdf, pdfSafe, startPage, type Pdf, type PdfMeta } from "./kit";

const METHOD = "The race's published analysis: facts from the timing, in words. Positions marked provisional may still change.";

interface Flow {
  pdf: Pdf;
  meta: PdfMeta;
  y: number;
  bottom: number;
  page: number;
  title: string;
}

function newPage(f: Flow): void {
  footer(f.pdf, f.meta, METHOD);
  f.page++;
  f.y = startPage(f.pdf, f.meta, `${f.title} (continued)`, "", false) + 6;
}

/** Write wrapped text, moving to a new page when it runs out of room. */
function write(f: Flow, text: string, o: { size: number; bold?: boolean; color?: [number, number, number]; indent?: number; after?: number; keep?: number }): void {
  const { doc } = f.pdf;
  doc.setFont("helvetica", o.bold ? "bold" : "normal");
  doc.setFontSize(o.size);
  const w = f.pdf.size.w - 2 * M - (o.indent ?? 0);
  const lines = doc.splitTextToSize(pdfSafe(text), w) as string[];
  const lh = o.size * 1.32;
  // Keep a heading with what follows it.
  if (f.y + lh * Math.min(lines.length, 2) + (o.keep ?? 0) > f.bottom) newPage(f);
  for (const line of lines) {
    if (f.y + lh > f.bottom) newPage(f);
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size);
    ink(doc, o.color ?? C.text);
    doc.text(line, M + (o.indent ?? 0), f.y + o.size);
    f.y += lh;
  }
  f.y += o.after ?? 4;
}

function rule(f: Flow, color: [number, number, number] = C.grid): void {
  const { doc } = f.pdf;
  if (f.y + 8 > f.bottom) return;
  fill(doc, color);
  doc.rect(M, f.y, f.pdf.size.w - 2 * M, 0.8, "F");
  f.y += 8;
}

/** `car`: the published car number for one car's story alone; the whole race without it. */
export async function storyPdf(stories: RaceStories, meta: PdfMeta, car?: string | null): Promise<Blob> {
  const pdf = await newPdf("portrait", meta);
  const ctx: ProseContext = { cars: stories.recap.cars, classes: stories.recap.classes };
  const t = (p: Parameters<typeof proseToText>[0]) => proseToText(p, ctx);
  const { recap } = stories;
  // Anything short of official results reads "provisional" (never "unofficial").
  const provisional = recap.resultsStatus !== "official";
  const story = car ? stories.stories.find((s) => s.car === car) : undefined;
  if (car && story) {
    const f: Flow = { pdf, meta, y: 0, bottom: pdf.size.h - FOOT_H - 16, page: 1, title: `RACE STORY · #${car}` };
    f.y = startPage(pdf, meta, f.title, provisional ? "Provisional results" : "", true) + 6;
    const info = recap.cars[car];
    const clsName = recap.classes[story.cls] ?? story.cls;
    write(f, `#${car} ${info?.team ?? ""} · ${clsName}`, { size: 15, bold: true, after: 2 });
    if (info?.drivers?.length) write(f, info.drivers.join(", "), { size: 10, color: C.soft, after: 2 });
    const finish = [story.positionClass ? `P${story.positionClass} in ${clsName}` : "", story.positionOverall ? `P${story.positionOverall} overall` : ""]
      .filter(Boolean)
      .join(" · ");
    if (finish) write(f, `${finish}${provisional ? " (provisional)" : ""}`, { size: 10, bold: true, color: C.head, after: 8 });
    rule(f, C.accent);
    write(f, t(story.headline), { size: 13, bold: true, after: 6 });
    for (const p of story.paragraphs) write(f, t(p), { size: 10, after: 7 });

    const moments = recap.moments.filter((m) => m.cars.includes(car)).sort((a, b) => a.lap - b.lap);
    if (moments.length) {
      rule(f);
      write(f, `KEY MOMENTS FOR #${car}`, { size: 9, bold: true, color: C.head, keep: 30 });
      for (const m of moments) {
        const laps = m.lapEnd && m.lapEnd !== m.lap ? `Laps ${m.lap}-${m.lapEnd}` : `Lap ${m.lap}`;
        write(f, `${laps}: ${t(m.title)}`, { size: 9.5, bold: true, after: 1 });
        if (m.text) write(f, t(m.text), { size: 9, indent: 10, color: C.soft, after: 5 });
      }
    }
    const penalty = recap.postRace.find((p) => p.car === car);
    if (penalty) {
      rule(f);
      const moved = penalty.before && penalty.after ? `, P${penalty.before} to P${penalty.after} in class` : "";
      write(f, `AFTER THE RACE: ${penalty.penaltyS} s penalty${moved}`, { size: 9.5, bold: true, color: C.head });
    }
    rule(f);
    write(f, "THE RACE", { size: 9, bold: true, color: C.head, keep: 30 });
    write(f, t(recap.headline), { size: 9.5, after: 4 });
    const winner = recap.classWinners.find((w) => w.class === story.cls);
    if (winner?.summary && winner.car !== car) write(f, `${clsName}: ${t(winner.summary)}`, { size: 9.5, after: 4 });
    footer(pdf, meta, METHOD);
    return pdf.doc.output("blob");
  }

  const f: Flow = { pdf, meta, y: 0, bottom: pdf.size.h - FOOT_H - 16, page: 1, title: "RACE STORY" };
  f.y = startPage(pdf, meta, f.title, provisional ? "Provisional results" : "", true) + 6;

  write(f, t(recap.headline), { size: 14, bold: true, after: 8 });
  for (const p of recap.paragraphs) write(f, t(p), { size: 10, after: 7 });

  if (recap.classWinners.length) {
    rule(f);
    write(f, "CLASS WINNERS", { size: 9, bold: true, color: C.head, keep: 30 });
    for (const w of recap.classWinners) {
      const drivers = w.drivers.length ? ` (${w.drivers.join(", ")})` : "";
      write(f, `${w.className || w.class}: #${w.car} ${w.team}${drivers}`, { size: 9.5, bold: true, after: 1 });
      if (w.summary) write(f, t(w.summary), { size: 9, indent: 10, color: C.soft, after: 5 });
    }
  }

  if (recap.moments.length) {
    rule(f);
    write(f, "KEY MOMENTS", { size: 9, bold: true, color: C.head, keep: 30 });
    for (const m of [...recap.moments].sort((a, b) => a.lap - b.lap)) {
      const laps = m.lapEnd && m.lapEnd !== m.lap ? `Laps ${m.lap}-${m.lapEnd}` : `Lap ${m.lap}`;
      write(f, `${laps}: ${t(m.title)}`, { size: 9.5, bold: true, after: 1 });
      if (m.text) write(f, t(m.text), { size: 9, indent: 10, color: C.soft, after: 5 });
    }
  }

  if (recap.postRace.length) {
    rule(f);
    write(f, "AFTER THE RACE", { size: 9, bold: true, color: C.head, keep: 20 });
    for (const p of recap.postRace) {
      const moved = p.before && p.after ? `, P${p.before} to P${p.after} in class` : "";
      write(f, `#${p.car} (${recap.classes[p.class] ?? p.class}): ${p.penaltyS} s penalty${moved}`, { size: 9, after: 3 });
    }
  }

  // Every car's story, class by class.
  const order = recap.classWinners.map((w) => w.class);
  let cls = "";
  for (const s of orderStories(stories.stories, order)) {
    if (s.cls !== cls) {
      cls = s.cls;
      f.y += 6;
      rule(f, C.accent);
      write(f, `${(recap.classes[cls] ?? cls).toUpperCase()} · CAR STORIES`, { size: 10, bold: true, color: C.head, keep: 50 });
    }
    const team = recap.cars[s.car]?.team ?? "";
    const pos = s.positionClass ? `P${s.positionClass} in class` : "";
    write(f, [`#${s.car} ${team}`, pos].filter(Boolean).join(" · "), { size: 8, bold: true, color: C.muted, after: 1, keep: 40 });
    write(f, t(s.headline), { size: 10.5, bold: true, after: 3 });
    for (const p of s.paragraphs) write(f, t(p), { size: 9, after: 5 });
    f.y += 4;
  }

  footer(pdf, meta, METHOD);
  return pdf.doc.output("blob");
}

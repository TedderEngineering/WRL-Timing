import { useState } from "react";
import { Link } from "react-router-dom";
import { drawText, imageName, makeShareCard, roundRect, type Box, type SiteStyle } from "@/features/share";
import { ShareImageActions } from "@/features/share/ShareImageActions";
import { SupportAsk } from "../support/SupportPrompts";
import { readUi, writeUi } from "./ui-state";

/**
 * "Your 2026" (engagement plan H): one card per followed car and series, opening when that
 * series' season is over on RaceTrace (IMSA and SRO in October, WRL after COTA in December).
 * Facts only; a total that is not a gain is left out. The year's second coffee ask comes at
 * the end (same caps), and the season can be shared as an image on the shared template.
 */

export interface SeasonRecap {
  key: string;
  number: string;
  team: string;
  season: number;
  seriesId: string;
  seriesLabel: string;
  finale: { name: string; end: string };
  races: number;
  laps: number;
  best: { finishClass: number; cls: string; raceId: string; raceName: string; date: string } | null;
  classWins: number;
  podiums: number;
  pitCycles: { count: number; gained: number | null };
  topThreePitStops: number;
  topThreeFastestLaps: number;
  raceList: { id: string; name: string; date: string; finishClass: number | null; cls: string }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The stats worth stating, in order; zeros are left out (nothing negative is summed up). */
export function recapStats(r: SeasonRecap): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [
    { label: "Races", value: String(r.races) },
    { label: "Laps", value: r.laps.toLocaleString("en-US") },
  ];
  if (r.best) out.push({ label: "Best result", value: `P${r.best.finishClass} in ${r.best.cls}` });
  if (r.classWins) out.push({ label: "Class wins", value: String(r.classWins) });
  if (r.podiums) out.push({ label: "Class podiums", value: String(r.podiums) });
  if (r.pitCycles.gained) out.push({ label: `Gained in ${r.pitCycles.count} pit cycles`, value: plural(r.pitCycles.gained, "place") });
  if (r.topThreePitStops) out.push({ label: "Top-three pit stops", value: String(r.topThreePitStops) });
  if (r.topThreeFastestLaps) out.push({ label: "Top-three fastest laps", value: String(r.topThreeFastestLaps) });
  return out;
}

const shortName = (name: string) => name.split(/\s+[—–]\s+/).pop() ?? name;

function drawSeasonBody(ctx: CanvasRenderingContext2D, box: Box, style: SiteStyle, r: SeasonRecap) {
  const stats = recapStats(r).slice(0, 6);
  const cols = 2;
  const gap = 24;
  const tileW = (box.w - gap) / cols;
  const tileH = 150;
  stats.forEach((s, i) => {
    const x = box.x + (i % cols) * (tileW + gap);
    const y = box.y + Math.floor(i / cols) * (tileH + gap);
    roundRect(ctx, x, y, tileW, tileH, 24);
    ctx.fillStyle = style.panel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = style.border;
    ctx.stroke();
    drawText(ctx, s.label.toUpperCase(), x + 28, y + 50, { size: 24, weight: 600, color: style.muted, maxWidth: tileW - 56 });
    drawText(ctx, s.value, x + 28, y + 112, { size: 48, weight: 700, color: style.text, maxWidth: tileW - 56, font: /^[\d,]+$/.test(s.value) ? "mono" : "sans" });
  });
  // The season's finishes, in order.
  const top = box.y + Math.ceil(stats.length / cols) * (tileH + gap) + 16;
  if (top + 60 < box.y + box.h) {
    drawText(ctx, "FINISHES IN CLASS", box.x, top + 24, { size: 24, weight: 600, color: style.muted, font: "mono" });
    const line = r.raceList.map((x) => (x.finishClass ? `P${x.finishClass}` : "–")).join("  ");
    drawText(ctx, line, box.x, top + 76, { size: 38, weight: 500, color: style.text, font: "mono", maxWidth: box.w });
  }
}

export function SeasonRecapCard({ recap, ask = true }: { recap: SeasonRecap; /** Only one coffee ask per page. */ ask?: boolean }) {
  const [hidden, setHidden] = useState(() => (readUi().recapsHidden ?? []).includes(recap.key));
  if (hidden) return null;
  const title = `#${recap.number} ${recap.team}`;
  const stats = recapStats(recap);
  return (
    <section aria-labelledby={`recap-${recap.key}`} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id={`recap-${recap.key}`} className="m-0 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--rt-text-muted)]">
          Your {recap.season} · {recap.seriesLabel}
        </h2>
        <button
          type="button"
          onClick={() => {
            writeUi({ recapsHidden: [...(readUi().recapsHidden ?? []), recap.key] });
            setHidden(true);
          }}
          className="text-[13px] text-[var(--rt-text-muted)] hover:text-[var(--rt-text)]"
        >
          Hide
        </button>
      </div>
      <article
        className="flex flex-col gap-4 overflow-hidden rounded-xl border border-[var(--rt-border)] px-5 py-4 text-left"
        style={{ background: "radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, var(--rt-accent) 14%, var(--rt-surface)) 0%, var(--rt-surface) 55%)" }}
      >
        <div>
          <p className="m-0 text-[17px] font-semibold text-[var(--rt-text)] sm:text-[20px]">{title}</p>
          <p className="m-0 mt-0.5 text-sm text-[var(--rt-text-secondary)]">
            {recap.seriesLabel} {recap.season}, through {recap.finale.name}
          </p>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-[var(--rt-border)] bg-[var(--rt-surface)] px-3 py-2.5">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rt-text-muted)]">{s.label}</dt>
              <dd className="m-0 mt-0.5 text-[17px] font-semibold text-[var(--rt-text)]">{s.value}</dd>
            </div>
          ))}
        </dl>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rt-text-muted)]">Every race</div>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {recap.raceList.map((x) => (
              <li key={x.id}>
                <Link
                  to={`/chart?race=${x.id}&car=${encodeURIComponent(recap.number)}`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--rt-border)] px-2.5 text-xs text-[var(--rt-text-secondary)] hover:border-[var(--rt-accent)] hover:text-[var(--rt-text)]"
                  title={x.name}
                >
                  <span className="font-mono font-semibold text-[var(--rt-text)]">{x.finishClass ? `P${x.finishClass}` : "–"}</span>
                  {shortName(x.name)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <ShareImageActions
            make={() =>
              makeShareCard({
                site: "racetrace",
                title: `${title}: ${recap.season}`,
                subtitle: recap.seriesLabel,
                body: (ctx, box, style) => drawSeasonBody(ctx, box, style, recap),
                fact: recap.best ? { text: `Best result: P${recap.best.finishClass} in ${recap.best.cls} at ${shortName(recap.best.raceName)}`, tone: "good" } : undefined,
              })
            }
            filename={imageName("racetrace", `${title} ${recap.season} ${recap.seriesLabel}`)}
            text={`${title}: ${recap.season} in ${recap.seriesLabel}, on RaceTrace`}
            kind="season"
            label="Share your season"
            className="text-sm font-semibold disabled:opacity-60"
          />
          {recap.best && (
            <Link to={`/chart?race=${recap.best.raceId}&car=${encodeURIComponent(recap.number)}`} className="text-[var(--rt-accent)]">
              Best race →
            </Link>
          )}
        </div>
        {/* The year's second coffee ask (plan H), within the usual caps. */}
        {ask && <SupportAsk />}
      </article>
    </section>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { drawText, imageName, makeShareCard, roundRect, type Box, type SiteStyle } from "@/features/share";
import { ShareImageActions } from "@/features/share/ShareImageActions";
import { SupportAsk } from "../support/SupportPrompts";
import { readUi, writeUi } from "./ui-state";
import { ScrollRow } from "../../components/ScrollRow";
import { formatDayRange } from "./format";

/**
 * "Your 2026" (engagement plan H): one card per followed car and series, opening when that
 * series' season is over on RaceTrace (IMSA and SRO in October, WRL after COTA in December).
 * Facts only; a total that is not a gain is left out. The year's second coffee ask comes at
 * the end (same caps), and the season can be shared as an image on the shared template.
 */

export interface SeasonRecap {
  key: string;
  carId?: string;
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
  raceList: {
    id: string;
    name: string;
    date: string;
    /** Older responses may lack the fields below. */
    track?: string;
    finishClass: number | null;
    finished?: boolean;
    finishOverall?: number | null;
    classSize?: number | null;
    laps?: number;
    cls: string;
    pitCycles?: { net: number }[];
  }[];
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

/** Tab labels: the track, with the race number when a weekend had more than one race. */
export function raceTabLabels(list: SeasonRecap["raceList"]): string[] {
  const base = list.map((r) => r.track || shortName(r.name));
  return base.map((b, i) => {
    const same = base.map((x, j) => (x === b ? j : -1)).filter((j) => j >= 0);
    return same.length > 1 ? `${b} R${same.indexOf(i) + 1}` : b;
  });
}

/**
 * Every race of the season, as the race cards do it: a row of tabs (a tap or click shows the race
 * below, whose link opens it on Position Trace on this car; grab or wheel to scroll).
 */
function RaceTabs({ recap }: { recap: SeasonRecap }) {
  const list = recap.raceList;
  const bestIdx = Math.max(0, list.findIndex((r) => r.id === recap.best?.raceId));
  const [tab, setTab] = useState(bestIdx);
  const labels = raceTabLabels(list);
  const r = list[tab] ?? list[0];
  if (!r) return null;
  const href = (id: string) => `/chart?race=${id}&car=${encodeURIComponent(recap.number)}`;
  const finish =
    r.finishClass !== null && r.finished === false
      ? `Retired after lap ${r.laps} · classified P${r.finishClass} in ${r.cls}${r.classSize ? ` of ${r.classSize}` : ""}`
      : r.finishClass !== null
      ? `Finished P${r.finishClass} in ${r.cls}${r.classSize ? ` of ${r.classSize}` : ""}${r.finishOverall ? ` · P${r.finishOverall} overall` : ""}`
      : "Not classified";
  const gained = (r.pitCycles ?? []).reduce((a, c) => a + c.net, 0);
  return (
    <div className="-mx-5 border-y border-[var(--rt-border)]">
      <ScrollRow
        role="tablist"
        aria-label={`${recap.season} races of #${recap.number}`}
        activeKey={tab}
        className="border-b border-[var(--rt-border)]"
        innerClassName="gap-1 px-5"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          const n = list.length;
          const next = (tab + (e.key === "ArrowRight" ? 1 : n - 1)) % n;
          setTab(next);
          e.currentTarget.querySelectorAll<HTMLElement>("[role=tab]")[next]?.focus();
        }}
      >
        {list.map((x, i) => (
          // A tap shows that race's line below (phones have no hover); "Position Trace →" opens it.
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={i === tab}
            data-active={i === tab}
            tabIndex={i === tab ? 0 : -1}
            onClick={() => setTab(i)}
            draggable={false}
            title={x.name}
            className={`flex min-h-[40px] items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm transition-colors ${
              i === tab
                ? "border-[var(--rt-accent)] font-semibold text-[var(--rt-text)]"
                : "border-transparent text-[var(--rt-text-muted)] hover:text-[var(--rt-text)]"
            }`}
          >
            <span className="font-mono text-xs">{x.finishClass ? `P${x.finishClass}` : "–"}</span>
            {labels[i]}
          </button>
        ))}
      </ScrollRow>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
        <span className="text-[var(--rt-text)]">{finish}</span>
        <span className="text-[var(--rt-text-muted)]">
          {[r.laps ? `${r.laps} laps` : null, gained > 0 ? `gained ${gained} in pit cycles` : null, formatDayRange(r.date, r.date)].filter(Boolean).join(" · ")}
        </span>
        <Link to={href(r.id)} className="ml-auto font-semibold text-[var(--rt-accent)]">
          Position Trace →
        </Link>
      </div>
    </div>
  );
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
        <RaceTabs recap={recap} />
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

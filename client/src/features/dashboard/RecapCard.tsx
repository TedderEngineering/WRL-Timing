import { useState } from "react";
import { Link } from "react-router-dom";
import { SeriesBadge } from "../../components/SeriesBadge";
import { ScrollRow } from "../../components/ScrollRow";
import {
  ProseText,
  formatDuration,
  proseToText,
  type ProseContext,
} from "../../lib/prose";
import { formatDayRange, resultsLabel } from "./format";
import type { LatestEvent, LatestRace, Recap, RecapMoment } from "./types";

const chartHref = (id: string, tab?: string) =>
  `/chart?race=${id}${tab ? `&tab=${tab}` : ""}`;

export function StatusPill({ status }: { status: string | null | undefined }) {
  const label = resultsLabel(status);
  if (!label) return null;
  const color = label === "Official" ? "var(--rt-good)" : "var(--rt-warning)";
  return (
    <span
      className="rounded-full border px-2 py-px text-xs font-semibold"
      style={{ borderColor: color, color }}
    >
      {label}
    </span>
  );
}

export function NewPill() {
  return (
    <span className="rounded-full bg-[var(--rt-accent)] px-2 py-px text-xs font-bold text-[var(--rt-on-accent)]">
      NEW
    </span>
  );
}

function eventLine(ev: LatestEvent): string {
  const parts = [ev.seriesLabel ?? ev.series];
  if (ev.round) parts.push(`Round ${ev.round.number} of ${ev.round.of}`);
  parts.push(ev.track, formatDayRange(ev.startDate, ev.endDate));
  return parts.join(" · ");
}

function surname(name: string): string {
  const p = name.trim().split(/\s+/);
  return p[p.length - 1] ?? name;
}

function causeStyle(m: RecapMoment): { color: string; shape: "dot" | "square" } {
  if (m.causes.includes("penalty"))
    return { color: "var(--rt-critical)", shape: "square" };
  if (m.causes.includes("retirement"))
    return { color: "var(--rt-text-muted)", shape: "square" };
  if (m.causes.includes("fcy")) return { color: "var(--rt-warning)", shape: "dot" };
  if (m.causes.includes("on_track")) return { color: "var(--rt-accent)", shape: "dot" };
  return { color: "var(--rt-info)", shape: "dot" };
}

const lapLabel = (m: RecapMoment) =>
  m.lapEnd && m.lapEnd !== m.lap ? `L${m.lap}–${m.lapEnd}` : `L${m.lap}`;

/** Laps 1…N as a strip: FCY and pit-cycle bands, one marker per key moment. */
export function MomentStrip({
  recap,
  ctx,
  compact = false,
}: {
  recap: Recap;
  ctx: ProseContext;
  compact?: boolean;
}) {
  const total = recap.totalLaps;
  if (!total || total < 2) return null;
  const left = (lap: number) =>
    `${((Math.max(1, Math.min(lap, total)) - 1) / total) * 100}%`;
  const width = (a: number, b: number) =>
    `${((Math.min(b, total) - Math.max(a, 1) + 1) / total) * 100}%`;
  const h = compact ? "h-6" : "h-8";
  return (
    <div
      className={`relative ${h} rounded-md border border-[var(--rt-border)] bg-[var(--rt-surface-2)]`}
      role="img"
      aria-label={`Key moments across ${total} laps`}
    >
      {recap.bands.map((b, i) =>
        b.kind === "fcy" ? (
          <div
            key={`b${i}`}
            title={`${b.label}, laps ${b.fromLap}–${b.toLap}`}
            className="absolute inset-y-0 border-x-2"
            style={{
              left: left(b.fromLap),
              width: width(b.fromLap, b.toLap),
              background: "var(--rt-warning-soft)",
              borderColor: "var(--rt-warning)",
            }}
          />
        ) : (
          <div
            key={`b${i}`}
            title={`${b.label}, laps ${b.fromLap}–${b.toLap}`}
            className="absolute inset-y-0"
            style={{
              left: left(b.fromLap),
              width: width(b.fromLap, b.toLap),
              background:
                "repeating-linear-gradient(135deg, var(--rt-info-soft) 0 6px, transparent 6px 12px)",
            }}
          />
        )
      )}
      {recap.moments
        .filter((m) => !(m.causes.length === 1 && m.causes[0] === "fcy"))
        .map((m) => {
          const s = causeStyle(m);
          const size = compact ? 10 : 14;
          return (
            <span
              key={m.id}
              title={`${lapLabel(m)}: ${proseToText(m.title, ctx)}`}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-[var(--rt-bg)]"
              style={{
                left: `calc(${left(m.lap)} + ${100 / total / 2}%)`,
                width: size,
                height: size,
                background: s.color,
                borderRadius: s.shape === "dot" ? "50%" : 3,
              }}
            >
              <span className="sr-only">
                {lapLabel(m)} <ProseText prose={m.title} ctx={ctx} />
              </span>
            </span>
          );
        })}
    </div>
  );
}

function MomentList({
  recap,
  ctx,
  limit,
}: {
  recap: Recap;
  ctx: ProseContext;
  limit?: number;
}) {
  const list = limit ? recap.moments.slice(0, limit) : recap.moments;
  if (!list.length && !recap.postRace.length) return null;
  return (
    <ol className="mt-2 grid list-none gap-x-5 gap-y-1 p-0 text-[13px] text-[var(--rt-text-secondary)] sm:grid-cols-2">
      {list.map((m) => (
        <li key={m.id}>
          <span
            className="mr-1.5 font-mono tabular-nums"
            style={{ color: causeStyle(m).color }}
          >
            {lapLabel(m)}
          </span>
          <ProseText prose={m.title} ctx={ctx} carClassName="" />
        </li>
      ))}
      {recap.postRace.map((p) => (
        <li key={`pen-${p.car}`} className="text-[var(--rt-text-muted)] sm:col-span-2">
          After the race: <span className="font-mono tabular-nums">#{p.car}</span> given a{" "}
          <span className="font-mono tabular-nums">{formatDuration(p.penaltyS)}</span>{" "}
          time penalty
          {p.before != null && p.after != null && p.before !== p.after ? (
            <>
              , <span className="font-mono tabular-nums">P{p.before}</span> →{" "}
              <span className="font-mono tabular-nums">P{p.after}</span> in{" "}
              {recap.classes[p.class] ?? p.class}
            </>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ClassWinners({ recap, compact }: { recap: Recap; compact: boolean }) {
  if (!recap.classWinners.length) return null;
  if (compact) {
    return (
      <div className="flex flex-wrap gap-2 text-[13px]">
        {recap.classWinners.map((w) => (
          <span
            key={w.class}
            className="rounded-md border border-[var(--rt-border)] bg-[var(--rt-surface-2)] px-2.5 py-1.5"
          >
            <span className="text-[var(--rt-text-muted)]">{w.className}</span>{" "}
            <span className="font-mono tabular-nums">#{w.car}</span> {w.make || w.team}
          </span>
        ))}
      </div>
    );
  }
  return (
    <>
      <ul className="m-0 list-none p-0 text-[13px] sm:hidden">
        {recap.classWinners.map((w) => (
          <li
            key={w.class}
            className="flex justify-between gap-3 border-b border-[var(--rt-rule)] py-1.5 last:border-b-0"
          >
            <span className="text-[var(--rt-text-muted)]">{w.className}</span>
            <span className="min-w-0 truncate text-right">
              <span className="font-mono tabular-nums">#{w.car}</span>{" "}
              {[w.team, w.make].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <div
        className="hidden gap-2.5 sm:grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}
      >
        {recap.classWinners.map((w) => (
          <div
            key={w.class}
            className="rounded-lg border border-[var(--rt-border)] bg-[var(--rt-surface-2)] px-3 py-2.5"
          >
            <div className="text-xs text-[var(--rt-text-muted)]">
              {w.className} · winner
            </div>
            <div className="mt-0.5 font-semibold">
              <span className="font-mono tabular-nums">#{w.car}</span> {w.team}
            </div>
            <div className="text-[13px] text-[var(--rt-text-secondary)]">
              {[w.make, w.drivers.map(surname).join(" / ")].filter(Boolean).join(" · ")}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function RaceBody({ race, variant }: { race: LatestRace; variant: "hero" | "compact" }) {
  const [expanded, setExpanded] = useState(false);
  const hero = variant === "hero";

  if (race.locked) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--rt-text-secondary)]">
        <span aria-hidden>🔒</span>
        {race.lockReason === "available_soon"
          ? "This race opens to free members shortly. Pro members can read it now."
          : "Upgrade to Pro to read this race."}
        <Link to="/settings/billing" className="font-semibold text-[var(--rt-accent)]">
          See plans →
        </Link>
      </div>
    );
  }

  const recap = race.recap;
  if (!recap) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-[var(--rt-text-secondary)]">
          {[
            race.totalCars ? `${race.totalCars} cars` : null,
            race.maxLap ? `${race.maxLap} laps` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="text-[var(--rt-text-muted)]">Chart only · recap coming</span>
        <Link
          to={chartHref(race.id)}
          className="ml-auto font-semibold text-[var(--rt-accent)]"
        >
          Position Trace →
        </Link>
      </div>
    );
  }

  const ctx: ProseContext = { cars: recap.cars, classes: recap.classes };
  return (
    <div className="flex flex-col gap-3.5">
      <p
        className={
          hero
            ? "m-0 max-w-4xl text-[17px] font-medium leading-snug sm:text-[21px]"
            : "m-0 max-w-4xl text-[15px] font-medium leading-snug sm:text-lg"
        }
      >
        <ProseText prose={recap.headline} ctx={ctx} />
      </p>

      <ClassWinners recap={recap} compact={!hero} />

      {hero && (
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-[var(--rt-text-muted)]">
            <span>Key moments</span>
            {recap.totalLaps ? (
              <span className="font-mono tabular-nums">{recap.totalLaps} laps</span>
            ) : null}
          </div>
          <MomentStrip recap={recap} ctx={ctx} />
          <MomentList recap={recap} ctx={ctx} limit={expanded ? undefined : 4} />
        </div>
      )}

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-[var(--rt-rule)] pt-3 text-[15px] leading-relaxed text-[var(--rt-text-secondary)]">
          {recap.paragraphs.map((p, i) => (
            <p key={i} className="m-0 max-w-3xl">
              <ProseText prose={p} ctx={ctx} />
            </p>
          ))}
          {recap.classWinners
            .filter((w) => w.summary)
            .map((w) => (
              <p key={w.class} className="m-0 max-w-3xl">
                <span className="mr-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--rt-text-muted)]">
                  {w.className}
                </span>
                <ProseText prose={w.summary!} ctx={ctx} />
              </p>
            ))}
          {!hero && <MomentList recap={recap} ctx={ctx} />}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          aria-expanded={expanded}
          className={
            hero
              ? "min-h-[40px] rounded-md bg-[var(--rt-accent)] px-3.5 py-2 text-sm font-semibold text-[var(--rt-on-accent)]"
              : "min-h-[40px] text-sm font-semibold text-[var(--rt-accent)]"
          }
        >
          {expanded ? "Show less" : hero ? "Read the full recap" : "Read the recap →"}
        </button>
        <Link
          to={chartHref(race.id)}
          className={
            hero
              ? "rounded-md border border-[var(--rt-border)] px-3 py-2 text-sm text-[var(--rt-text)]"
              : "text-sm text-[var(--rt-text-secondary)]"
          }
        >
          Position Trace
        </Link>
        <Link
          to={chartHref(race.id, "pitanalysis")}
          className={
            hero
              ? "rounded-md border border-[var(--rt-border)] px-3 py-2 text-sm text-[var(--rt-text)]"
              : "text-sm text-[var(--rt-text-secondary)]"
          }
        >
          Pit Stops &amp; Cycles
        </Link>
        <span className="ml-auto text-xs text-[var(--rt-text-muted)]">
          Written by Claude from the timing files · every number checked
        </span>
      </div>
    </div>
  );
}

export type RecapVariant = "hero" | "compact" | "mini";

/** The small card's body: the race's size and one link, no recap prose. */
function MiniBody({ race }: { race: LatestRace }) {
  const size = [race.totalCars ? `${race.totalCars} cars` : null, race.maxLap ? `${race.maxLap} laps` : null].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-[var(--rt-text-secondary)]">{size}</span>
      <span className="text-[var(--rt-text-muted)]">{race.locked ? "🔒" : race.recap ? "Recap ready" : "Chart only"}</span>
      <Link to={chartHref(race.id)} className="ml-auto whitespace-nowrap font-semibold text-[var(--rt-accent)]">
        Position Trace →
      </Link>
    </div>
  );
}

/**
 * A weekend: its races as tabs (hover or focus previews one below, a click opens it on
 * Position Trace). "hero" and "compact" are the latest weekends, with the recap; "mini" is
 * the smaller card in the "Earlier races" grid, with the same tabs and links.
 */
export function RecapCard({
  event,
  variant,
}: {
  event: LatestEvent;
  variant: RecapVariant;
}) {
  const mini = variant === "mini";
  const firstWithRecap = Math.max(
    0,
    event.races.findIndex((r) => r.recap)
  );
  const [tab, setTab] = useState(firstWithRecap);
  const race = event.races[tab] ?? event.races[0];
  const status = race.resultsStatus;
  const pad = mini ? "px-4" : "px-5";

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] text-left">
      {mini ? (
        <div className={`flex items-center gap-2 ${pad} pt-3`}>
          <SeriesBadge series={event.series} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--rt-text)]" title={eventLine(event)}>
            {event.track}
          </span>
          <span className="shrink-0 text-xs text-[var(--rt-text-muted)]">{formatDayRange(event.startDate, event.endDate, false)}</span>
        </div>
      ) : (
        <div className={`flex flex-wrap items-center gap-2.5 ${pad} pt-3.5`}>
          <SeriesBadge series={event.series} size="sm" />
          <span className="text-sm text-[var(--rt-text-secondary)]">
            {eventLine(event)}
          </span>
          <StatusPill status={status} />
          {event.isNew && (
            <span className="ml-auto">
              <NewPill />
            </span>
          )}
        </div>
      )}
      {event.races.length > 1 ? (
        <ScrollRow
          role="navigation"
          aria-label="Races this weekend: open on Position Trace"
          activeKey={tab}
          className={`${mini ? "mt-1.5" : "mt-2.5"} border-b border-[var(--rt-border)]`}
          innerClassName={`gap-1 ${mini ? "px-2" : "px-5"}`}
          onKeyDown={(e) => {
            // Arrows move between races (previewing each); Enter opens it.
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const n = event.races.length;
            const next = (tab + (e.key === "ArrowRight" ? 1 : n - 1)) % n;
            setTab(next);
            (e.currentTarget.querySelectorAll<HTMLElement>("a")[next])?.focus();
          }}
        >
          {event.races.map((r, i) => (
            // One click opens the race on Position Trace; hovering or focusing a race previews it below.
            <Link
              key={r.id}
              to={chartHref(r.id)}
              aria-current={i === tab ? "true" : undefined}
              data-active={i === tab}
              tabIndex={i === tab ? 0 : -1}
              onMouseEnter={() => setTab(i)}
              onFocus={() => setTab(i)}
              draggable={false}
              className={`flex items-center whitespace-nowrap border-b-2 transition-colors ${
                mini ? "min-h-[34px] px-2 text-xs" : "min-h-[40px] px-3 text-sm"
              } ${
                i === tab
                  ? "border-[var(--rt-accent)] font-semibold text-[var(--rt-text)]"
                  : "border-transparent text-[var(--rt-text-muted)] hover:text-[var(--rt-text)]"
              }`}
            >
              {r.session}
            </Link>
          ))}
        </ScrollRow>
      ) : (
        <div className={`${pad} ${mini ? "pt-1.5 text-xs" : "pt-1 text-sm"} font-semibold text-[var(--rt-text)]`}>
          {race.session}
        </div>
      )}
      <div className={mini ? "mt-auto px-4 pb-3 pt-2.5" : "px-5 pb-4 pt-4"}>
        {mini ? <MiniBody race={race} /> : <RaceBody key={race.id} race={race} variant={variant as "hero" | "compact"} />}
      </div>
    </article>
  );
}

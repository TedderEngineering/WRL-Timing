import { useEffect, useRef, useState } from "react";
import { LiveDemoCard } from "../live/LiveDemoCard";
import { Link } from "react-router-dom";
import { formatDayRange, whenLabel } from "./format";
import { whenText } from "../live/banner";
import type { SeasonResponse, SeasonRound, SeasonSeries } from "./types";

const STORE_KEY = "racetrace.dashboard.series";

function loadChoice(): string[] | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

function saveChoice(ids: string[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(ids));
  } catch {
    // private window or storage blocked: the choice lasts for this visit only
  }
}

const STATUS_TEXT: Record<SeasonRound["status"], string> = {
  on_site: "on RaceTrace",
  missing: "not on RaceTrace yet",
  live: "this weekend",
  upcoming: "upcoming",
};

function Segment({ r }: { r: SeasonRound }) {
  const label = `Round ${r.round} ${r.name}, ${formatDayRange(r.start, r.end, false)}: ${r.isNext ? "next" : STATUS_TEXT[r.status]}`;
  const base = "block h-2.5 rounded-[3px] box-border";
  // A round on RaceTrace opens its weekend (the race page lists every race of the event).
  // The link is taller than the bar so it is easy to hit.
  if (r.status === "on_site" && r.races.length)
    return (
      <Link
        to={`/chart?race=${r.races[0].id}`}
        title={label}
        aria-label={`${label}. Open`}
        className="group block rounded py-1.5 -my-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--rt-accent)]"
      >
        <span
          className={`${base} transition-[filter] group-hover:brightness-125`}
          style={{ background: "var(--rt-accent)" }}
        />
      </Link>
    );
  if (r.status === "on_site")
    return <span title={label} aria-label={label} className={base} style={{ background: "var(--rt-accent)" }} />;
  if (r.status === "missing")
    return (
      <span
        title={label}
        aria-label={label}
        className={`${base} border`}
        style={{ borderColor: "var(--rt-accent)" }}
      />
    );
  return (
    <span
      title={label}
      aria-label={label}
      className={`${base} border border-dashed`}
      style={{
        borderColor: "var(--rt-text-muted)",
        outline:
          r.isNext || r.status === "live" ? "2px solid var(--rt-accent-soft)" : undefined,
        outlineOffset: 1,
      }}
    />
  );
}

/** "WRL Saturday 8 Hour — Road Atlanta" → "Sat", "GT4 America Race 1 — Sonoma Raceway" → "Race 1". */
export function shortRaceLabel(name: string): string {
  const base = name
    .replace(/\s+—.*$/, "")
    // The championship is the card's title: "WRL Saturday 8 Hour" → "Saturday 8 Hour".
    .replace(/^(?:WRL|(?:Pirelli\s+)?GT4(?:\s+America)?|GR Cup|Pilot Challenge|WeatherTech|VP Racing Challenge|MX-5 Cup|Super Trofeo|Carrera Cup|Mustang Challenge|GT World Challenge)\s+/i, "")
    .trim();
  const day = base.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*day\b/i);
  return day ? day[1] : base;
}

function RoundRow({ r }: { r: SeasonRound }) {
  const next = r.isNext;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-[var(--rt-rule)] py-1.5 last:border-b-0">
      <span className="min-w-0">
        <span
          className="mr-1.5 font-mono tabular-nums"
          style={{ color: next ? "var(--rt-accent)" : "var(--rt-text-muted)" }}
        >
          R{r.round}
        </span>
        {r.status === "on_site" && r.races.length ? (
          <Link to={`/chart?race=${r.races[0].id}`} className="hover:text-[var(--rt-accent)]">
            {r.name}
          </Link>
        ) : (
          r.name
        )}
        {r.note ? <span className="text-[var(--rt-text-muted)]"> · {r.note}</span> : null}
      </span>
      <span
        className="ml-auto text-right"
        style={{ color: next ? "var(--rt-accent)" : "var(--rt-text-muted)" }}
      >
        {formatDayRange(r.start, r.end, false)} ·{" "}
        {r.status === "on_site"
          ? r.races.map((x, i) => (
              <Link
                key={x.id}
                to={`/chart?race=${x.id}`}
                className="text-[var(--rt-accent)]"
              >
                {i ? " · " : ""}
                {r.races.length > 1 ? shortRaceLabel(x.name) : "Chart"}
              </Link>
            ))
          : next
            ? "next"
            : STATUS_TEXT[r.status]}
      </span>
    </li>
  );
}

function SeriesCard({
  s,
  expanded,
  onToggle,
}: {
  s: SeasonSeries;
  expanded: boolean;
  onToggle: () => void;
}) {
  const summary = s.complete
    ? `Season complete · ${s.counts.onSite} of ${s.counts.total} on RaceTrace`
    : `${s.counts.run} of ${s.counts.total} run · ${s.counts.onSite} on RaceTrace`;
  // Collapsed: the rounds around "now" (last two run, the next two).
  const pivotAt = s.next ? s.rounds.findIndex((r) => r.round === s.next!.round) : -1;
  const pivot = pivotAt >= 0 ? pivotAt : s.rounds.length;
  const shown = expanded ? s.rounds : s.rounds.slice(Math.max(0, pivot - 3), pivot + 2);
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] px-4 py-3.5 text-left">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[15px] font-semibold">{s.label}</h3>
        <span className="text-xs text-[var(--rt-text-muted)]">{summary}</span>
      </div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${s.rounds.length}, minmax(0, 1fr))` }}
        role="list"
        aria-label={`${s.label} rounds`}
      >
        {s.rounds.map((r) => (
          <span role="listitem" key={r.round}>
            <Segment r={r} />
          </span>
        ))}
      </div>
      {s.complete && !expanded ? (
        s.latestOnSite ? (
          <div className="text-[13px] text-[var(--rt-text-secondary)]">
            Latest:{" "}
            <Link
              to={`/chart?race=${s.latestOnSite.races[0].id}`}
              className="text-[var(--rt-accent)]"
            >
              R{s.latestOnSite.round} {s.latestOnSite.name}
            </Link>{" "}
            · {formatDayRange(s.latestOnSite.start, s.latestOnSite.end, false)}
          </div>
        ) : null
      ) : (
        <ul className="m-0 flex list-none flex-col p-0 text-[13px]">
          {shown.map((r) => (
            <RoundRow key={r.round} r={r} />
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="self-start text-[13px] text-[var(--rt-accent)]"
        aria-expanded={expanded}
      >
        {expanded ? "Show fewer rounds" : `All ${s.counts.total} rounds →`}
      </button>
    </section>
  );
}

type NextRound = NonNullable<SeasonResponse["next"]>;

/** Pick the next round among the chosen series (shared by the phone header and the panel). */
export function nextFor(data: SeasonResponse | null): NextRound | null {
  if (!data?.upcoming) return null;
  const ids = (loadChoice() ?? data.suggested ?? []).filter(Boolean);
  return data.upcoming.find((n) => !ids.length || ids.includes(n.seriesId)) ?? null;
}

export function NextUp({ next, today, now = Date.now() }: { next: NextRound; today: string; now?: number }) {
  // A weekend under way names its next session ("Race 2 · 7 Hour", tomorrow 8:00 AM) in the
  // viewer's time zone; otherwise the round's dates.
  const s = next.session;
  const sw = s ? whenText(s.startsAt, now) : "";
  const when = s ? (sw === "Starting now" ? "starting now" : `${sw.charAt(0).toLowerCase()}${sw.slice(1)}`) : whenLabel(next.start, next.end, today);
  // A session on the live schedule opens its live page (before the start it says so, and turns
  // into live timing when the session opens); the card's last line says which.
  const liveTo = s?.id ? `/live/next/${encodeURIComponent(s.id)}` : null;
  const started = s ? Date.parse(s.startsAt) <= now : false;
  const box = "block rounded-xl border px-4 py-3.5 text-left";
  const style = { borderColor: "var(--rt-accent)", background: "var(--rt-accent-soft)" };
  const content = (
    <>
      <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--rt-accent)]">
        Next up{when ? ` · ${when}` : ""}
      </div>
      <div className="mt-1 text-[17px] font-semibold">
        {next.seriesLabel} {next.name}
        {s ? ` · ${s.name}` : next.note ? ` · ${next.note}` : ""}
      </div>
      <div className="text-[13px] text-[var(--rt-text-secondary)]">
        {next.track} · {formatDayRange(next.start, next.end, false)}
      </div>
      {liveTo ? (
        <div className="mt-1.5 text-xs">
          <span className="text-[var(--rt-text-muted)]">{started ? "Live timing" : "Not live yet"} · </span>
          <span className="font-semibold text-[var(--rt-accent)]">Open live timing →</span>
        </div>
      ) : (
        <div className="mt-1.5 text-xs text-[var(--rt-text-muted)]">
          Results and recaps appear here after the race.
        </div>
      )}
    </>
  );
  return liveTo ? (
    <Link to={liveTo} className={`${box} hover:brightness-110`} style={style}>
      {content}
    </Link>
  ) : (
    <div className={box} style={style}>
      {content}
    </div>
  );
}

export function SeasonPanel({ data }: { data: SeasonResponse | null }) {
  const [chosen, setChosen] = useState<string[] | null>(() => loadChoice());
  const [picking, setPicking] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicking(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picking]);

  // No season (loading, or not reachable): the live demo still has its place on wide screens.
  if (!data || !data.season)
    return (
      <div className="hidden lg:block">
        <LiveDemoCard />
      </div>
    );
  const order = data.suggested?.length ? data.suggested : data.series.map((s) => s.id);
  const ids = (chosen ?? order).filter((id) => data.series.some((s) => s.id === id));
  const visible = ids.map((id) => data.series.find((s) => s.id === id)!).filter(Boolean);
  const next = data.upcoming?.find((n) => ids.includes(n.seriesId)) ?? null;

  const toggle = (id: string) => {
    const base = chosen ?? order;
    const nextIds = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    setChosen(nextIds);
    saveChoice(nextIds);
  };

  return (
    <aside aria-label={`${data.season} season`} className="flex min-w-0 flex-col gap-4">
      <div className="relative flex items-baseline justify-between">
        <h2 className="m-0 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--rt-text-muted)]">
          {data.season} season
        </h2>
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          aria-expanded={picking}
          className="text-[13px] text-[var(--rt-accent)]"
        >
          Choose series
        </button>
        {picking && (
          <div
            ref={pickerRef}
            role="dialog"
            aria-label="Choose series"
            className="absolute right-0 top-7 z-20 w-64 rounded-lg border border-[var(--rt-border)] bg-[var(--rt-surface)] p-3 text-left shadow-xl"
          >
            {data.series.map((s) => (
              <label
                key={s.id}
                className="flex min-h-[36px] cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={ids.includes(s.id)}
                  onChange={() => toggle(s.id)}
                  className="accent-[var(--rt-accent)]"
                />
                {s.label}
              </label>
            ))}
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="mt-1 text-[13px] text-[var(--rt-accent)]"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {next && (
        <div className="hidden lg:block">
          <NextUp next={next} today={data.today} />
        </div>
      )}
      <div className="hidden lg:block">
        <LiveDemoCard />
      </div>

      {visible.map((s) => (
        <SeriesCard
          key={s.id}
          s={s}
          expanded={!!expanded[s.id]}
          onToggle={() => setExpanded((e) => ({ ...e, [s.id]: !e[s.id] }))}
        />
      ))}
      {!visible.length && (
        <p className="m-0 text-sm text-[var(--rt-text-muted)]">
          No series chosen. Use “Choose series” to add one.
        </p>
      )}

      <div className="flex flex-wrap gap-3.5 text-xs text-[var(--rt-text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-3.5 rounded-sm"
            style={{ background: "var(--rt-accent)" }}
          />
          On RaceTrace
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-3.5 rounded-sm border"
            style={{ borderColor: "var(--rt-accent)" }}
          />
          Run, not on RaceTrace yet
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-3.5 rounded-sm border border-dashed"
            style={{ borderColor: "var(--rt-text-muted)" }}
          />
          Upcoming
        </span>
      </div>
      <p className="m-0 text-[11px] text-[var(--rt-text-muted)]">
        Calendars:{" "}
        {data.series.map((s, i) => (
          <span key={s.id}>
            {i ? " · " : ""}
            <a
              href={s.source.url}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted"
            >
              {s.shortLabel}
            </a>
          </span>
        ))}
      </p>
    </aside>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { SeriesBadge } from "../../components/SeriesBadge";
import { ProseText, formatDuration, type Prose, type ProseContext } from "../../lib/prose";
import { track } from "../../lib/analytics";
import { SupportAsk } from "../support/SupportPrompts";
import { StatusPill } from "./RecapCard";
import { formatDayRange } from "./format";
import { readUi, writeUi } from "./ui-state";
import { switchAlerts } from "../my-cars/alerts";

/**
 * "Your car's latest race" (engagement plan C, the peak moment): the followed car's finish,
 * its pit cycles in class, its best lap, and its story when the race's analysis package is
 * published. Facts only, no blame; the coffee ask comes at the end, within its usual caps.
 */

export interface MyCarResponse {
  carCount: number;
  car: { id: string; label: string | null; number: string; series: string; teamName: string | null } | null;
  race: {
    id: string;
    name: string;
    date: string;
    track: string;
    series: string;
    resultsStatus: string | null;
    locked: boolean;
    lockReason: string | null;
  } | null;
  facts?: {
    number: string;
    team: string;
    cls: string;
    vehicle: string | null;
    finishClass: number | null;
    finishOverall: number | null;
    classSize: number | null;
    status: string | null;
    laps: number;
    raceLaps: number;
    bestLap: { sec: number; lap: number } | null;
    bestLapClassRank: number | null;
    pitCycles: { cycle: number; lap: number; before: number; after: number; net: number }[];
    /** Class benchmarks (plan E), facts in the class top three only. */
    benchmarks?: string[];
  } | null;
  story?: { headline: Prose; paragraphs: Prose[]; cars: ProseContext["cars"]; classes: Record<string, string> } | null;
  viewed?: boolean;
  /** Race-ready emails are on. */
  alerts?: boolean;
  /** All the user's cars, for the car tabs. */
  cars?: { id: string; number: string; label: string | null; series: string; teamName: string | null }[];
}

const chartHref = (id: string, tab?: string) => `/chart?race=${id}${tab ? `&tab=${tab}` : ""}`;
const ORDINAL = ["", "fastest", "2nd fastest", "3rd fastest"];

export function finishLine(f: NonNullable<MyCarResponse["facts"]>): string {
  if (f.finishClass !== null) {
    const of = f.classSize ? ` of ${f.classSize}` : "";
    return `Finished P${f.finishClass} in ${f.cls}${of} · P${f.finishOverall} overall`;
  }
  if (f.status === "dsq") return "Disqualified";
  if (f.status === "dns") return "Did not start";
  if (f.status === "dnf") return "Did not finish";
  return "Not classified";
}

export function pitCycleLine(c: NonNullable<MyCarResponse["facts"]>["pitCycles"][number], cls: string): string {
  const change = c.net > 0 ? `gained ${c.net}` : c.net < 0 ? `lost ${-c.net}` : "held position";
  return `Pit cycle ${c.cycle} (settled lap ${c.lap}): P${c.before} → P${c.after} in ${cls}, ${change}`;
}

export function MyCarCard({ data, ask = true }: { data: MyCarResponse; /** False when the season recap carries the coffee ask. */ ask?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { car, race, facts, story } = data;
  if (!car) return null;
  const name = car.label ? `${car.label} · #${car.number}` : `#${car.number}${car.teamName ? ` · ${car.teamName}` : ""}`;

  if (!race) {
    return (
      <section className="rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] px-5 py-4 text-left">
        <div className="text-sm font-semibold text-[var(--rt-text)]">{name}</div>
        <p className="m-0 mt-1 text-sm text-[var(--rt-text-secondary)]">
          No race for this car on RaceTrace yet. Its next race will show here once it is published.{" "}
          <Link to="/settings/cars" className="text-[var(--rt-accent)]">My cars →</Link>
        </p>
      </section>
    );
  }

  const open = () => track("open_story", { raceId: race.id, hasPackage: !!story });
  const ctx: ProseContext = { cars: story?.cars, classes: story?.classes };

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] text-left">
      <div className="flex flex-wrap items-center gap-2.5 px-5 pt-3.5">
        <SeriesBadge series={race.series} size="sm" />
        <span className="text-sm font-semibold text-[var(--rt-text)]">{name}</span>
        <span className="text-sm text-[var(--rt-text-secondary)]">
          {race.name} · {formatDayRange(race.date, race.date)}
        </span>
        <StatusPill status={race.resultsStatus} />
      </div>

      <div className="flex flex-col gap-3 px-5 pb-4 pt-3">
        {race.locked ? (
          <p className="m-0 text-sm text-[var(--rt-text-secondary)]">
            🔒 {race.lockReason === "available_soon" ? "This race opens to free members shortly." : "Upgrade to Pro to read this race."}{" "}
            <Link to="/settings/billing" className="font-semibold text-[var(--rt-accent)]">See plans →</Link>
          </p>
        ) : (
          <>
            {story ? (
              <p className="m-0 max-w-4xl text-[17px] font-medium leading-snug sm:text-[20px]">
                <ProseText prose={story.headline} ctx={ctx} />
              </p>
            ) : facts ? (
              <p className="m-0 text-[17px] font-medium leading-snug sm:text-[20px]">{finishLine(facts)}</p>
            ) : null}

            {facts && (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-[var(--rt-text-secondary)]">
                {story && <li>{finishLine(facts)}</li>}
                <li>
                  {facts.laps} of {facts.raceLaps} laps
                  {facts.bestLap && (
                    <>
                      {" · "}best lap <span className="font-mono">{formatDuration(facts.bestLap.sec)}</span> on lap {facts.bestLap.lap}
                      {!facts.benchmarks && facts.bestLapClassRank ? `, ${ORDINAL[facts.bestLapClassRank]} in ${facts.cls}` : ""}
                    </>
                  )}
                </li>
                {facts.pitCycles.map((c) => (
                  <li key={c.cycle}>{pitCycleLine(c, facts.cls)}</li>
                ))}
              </ul>
            )}

            {facts?.benchmarks && facts.benchmarks.length > 0 && (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Class benchmarks">
                {facts.benchmarks.map((b) => (
                  <li
                    key={b}
                    className="rounded-md border px-2 py-0.5 text-[12px] text-[var(--rt-text-secondary)]"
                    style={{ borderColor: "color-mix(in srgb, var(--rt-good) 40%, transparent)", background: "color-mix(in srgb, var(--rt-good) 7%, transparent)" }}
                  >
                    {b}
                  </li>
                ))}
              </ul>
            )}

            {story && story.paragraphs.length > 0 && expanded && (
              <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-[var(--rt-text-secondary)]">
                {story.paragraphs.map((p, i) => (
                  <p key={i} className="m-0 max-w-3xl">
                    <ProseText prose={p} ctx={ctx} />
                  </p>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {story && story.paragraphs.length > 0 && (
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => {
                    if (!expanded) open();
                    setExpanded((x) => !x);
                  }}
                  className="font-semibold text-[var(--rt-text)]"
                >
                  {expanded ? "Show less" : "Read the car's story"}
                </button>
              )}
              <Link to={chartHref(race.id)} onClick={open} className="font-semibold text-[var(--rt-accent)]">
                Position Trace →
              </Link>
              <Link to={chartHref(race.id, "pitanalysis")} onClick={open} className="text-[var(--rt-accent)]">
                Pit stops →
              </Link>
              {data.carCount > 1 && (
                <Link to="/settings/cars" className="ml-auto text-[13px] text-[var(--rt-text-muted)]">
                  {data.carCount} cars followed
                </Link>
              )}
            </div>

            {/* After the peak moment: the one contextual ask, at most every 30 days. */}
            {ask && <SupportAsk />}
          </>
        )}
      </div>
    </article>
  );
}

/**
 * First steps, the first already ticked; shows until all are done or hidden. It teaches the
 * loop: follow your car, open its race (alerts join it when they ship).
 */
export function FirstStepsChecklist({ data }: { data: MyCarResponse | null }) {
  const [hidden, setHidden] = useState(() => !!readUi().checklistHidden);
  const [alertsOn, setAlertsOn] = useState<boolean | null>(null);
  if (!data) return null;
  const alerts = alertsOn ?? !!data.alerts;
  type Step = {
    key: string;
    label: string;
    done: boolean;
    to: string | null;
    start?: string;
    alt?: { label: string; to: string; key: string };
    /** A step done right here (a switch), not on another page. */
    action?: { label: string; run: () => void };
  };
  const steps: Step[] = [
    { key: "account", label: "Create your account", done: true, to: null },
    {
      key: "follow",
      label: "Follow your car",
      done: data.carCount > 0,
      to: "/races",
      start: "Find its race →",
      // Or type the number: no need to find a race first.
      alt: { key: "follow_by_number", label: "Add it by number →", to: "/settings/cars" },
    },
    { key: "open_race", label: "Open your car's latest race", done: !!data.viewed, to: data.race ? chartHref(data.race.id) : null },
    {
      key: "alerts",
      label: "Get an email when your car's race is up",
      done: alerts,
      to: null,
      // Only once there is a car to be emailed about.
      action: data.carCount === 0 ? undefined : {
        label: "Turn on",
        run: () => {
          track("checklist_step", { step: "alerts" });
          switchAlerts(true, "checklist").then(setAlertsOn).catch(() => undefined);
        },
      },
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (hidden || done === steps.length) return null;
  // A step that cannot be done yet (no race to open) is not "next".
  const next = steps.find((s) => !s.done && (s.to || s.action));

  return (
    <section aria-labelledby="first-steps" className="rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] px-5 py-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="first-steps" className="m-0 text-[15px] font-semibold text-[var(--rt-text)]">Make RaceTrace yours</h2>
          <p className="m-0 mt-0.5 text-[13px] text-[var(--rt-text-muted)]">
            {done} of {steps.length} done
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            writeUi({ checklistHidden: true });
            setHidden(true);
          }}
          className="min-h-[36px] px-1 text-[13px] text-[var(--rt-text-muted)] hover:text-[var(--rt-text)]"
        >
          Hide
        </button>
      </div>
      <div
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--rt-border)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        aria-label="First steps progress"
      >
        <div className="h-full rounded-full bg-[var(--rt-accent)]" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="m-0 mt-2 list-none p-0">
        {steps.map((s) => {
          const isNext = s === next;
          const body = (
            <>
              <span
                aria-hidden
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold ${
                  s.done ? "border-[var(--rt-good)] bg-[var(--rt-good)] text-[var(--rt-surface)]" : isNext ? "border-2 border-[var(--rt-accent)]" : "border-[var(--rt-border)]"
                }`}
              >
                {s.done ? "✓" : null}
              </span>
              <span className={`text-sm ${s.done ? "text-[var(--rt-text-muted)] line-through" : isNext ? "font-semibold text-[var(--rt-text)]" : "text-[var(--rt-text-secondary)]"}`}>
                {s.label}
                <span className="sr-only">{s.done ? " (done)" : ""}</span>
              </span>
              {isNext && !s.alt && !s.action && <span className="ml-auto text-sm font-semibold text-[var(--rt-accent)]">Start →</span>}
            </>
          );
          if (!s.done && s.action) {
            return (
              <li key={s.key} className="flex min-h-[40px] items-center gap-3">
                {body}
                <button type="button" onClick={s.action.run} className="ml-auto text-sm font-semibold text-[var(--rt-accent)]">
                  {s.action.label}
                </button>
              </li>
            );
          }
          if (isNext && s.alt && s.to) {
            // Two ways to do this step: find a race and press Follow, or type the number.
            return (
              <li key={s.key} className="flex min-h-[40px] flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex items-center gap-3">{body}</span>
                <span className="ml-auto flex items-center gap-4 text-sm font-semibold">
                  <Link to={s.to} onClick={() => track("checklist_step", { step: s.key })} className="text-[var(--rt-accent)]">
                    {s.start}
                  </Link>
                  <Link to={s.alt.to} onClick={() => track("checklist_step", { step: s.alt!.key })} className="text-[var(--rt-accent)]">
                    {s.alt.label}
                  </Link>
                </span>
              </li>
            );
          }
          return (
            <li key={s.key}>
              {s.done || !s.to ? (
                <div className="flex min-h-[40px] items-center gap-3">{body}</div>
              ) : (
                <Link to={s.to} onClick={() => track("checklist_step", { step: s.key })} className="flex min-h-[40px] items-center gap-3 rounded-md hover:bg-[color-mix(in_srgb,var(--rt-text)_5%,transparent)]">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

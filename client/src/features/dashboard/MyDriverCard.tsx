import { useState } from "react";
import { Link } from "react-router-dom";
import { SeriesBadge } from "../../components/SeriesBadge";
import { ProseText, formatDuration, type ProseContext } from "../../lib/prose";
import { track } from "../../lib/analytics";
import { FollowTabs } from "./FollowTabs";
import { formatDayRange } from "./format";
import { StatusPill } from "./RecapCard";
import { finishLine, type MyCarResponse } from "./MyCarCard";
import { driveTimeText } from "../my-drivers/stints";
import { displayName } from "../my-drivers/api";
import { ShareDriverCardButton } from "../my-drivers/driverCard";

/**
 * "Your driver's latest race": a followed driver's newest race whatever the car or series, the
 * car's result and story, and the driver's own part (stints, drive time, best lap) when the timing
 * says who drove when. Facts only, as on My Car.
 */

interface DriverStint {
  start: number;
  end: number;
  driver: string | null;
  mine: boolean;
}

export interface MyDriverResponse {
  driverCount: number;
  driver: { id: string; name: string; alerts?: boolean } | null;
  drivers: { id: string; name: string }[];
  alerts?: boolean;
  race: MyCarResponse["race"];
  car?: { number: string; team: string; cls: string; coDrivers: string[] };
  facts?: MyCarResponse["facts"];
  driverFacts?: {
    known: boolean;
    stints: DriverStint[];
    myStints: number;
    driveTimeS: number;
    carTimeS: number;
    bestLap: { sec: number; lap: number } | null;
    bestRank: { rank: number; of: number } | null;
  } | null;
  story?: MyCarResponse["story"];
  viewed?: boolean;
  recent?: {
    raceId: string;
    raceName: string;
    date: string;
    track: string;
    series: string;
    subSeries: string | null;
    carNumber: string;
    carClass: string;
    finishPos: number | null;
    finishPosClass: number | null;
  }[];
  totals?: { races: number; series: string[] };
}

const chartHref = (id: string, car?: string, tab?: string) =>
  `/chart?race=${id}${car ? `&car=${encodeURIComponent(car)}` : ""}${tab ? `&tab=${tab}` : ""}`;
const firstName = (name: string) => name.split(/\s+/)[0];
/** The other drivers' stints, in two shades so neighbours differ. */
const OTHER = ["color-mix(in srgb, var(--rt-text-muted) 45%, transparent)", "color-mix(in srgb, var(--rt-text-muted) 75%, transparent)"];

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function result(r: NonNullable<MyDriverResponse["recent"]>[number]): string {
  if (r.finishPosClass && r.finishPosClass < 900) return `P${r.finishPosClass}`;
  if (r.finishPos && r.finishPos < 900) return `P${r.finishPos}`;
  return "—";
}

/** The followed drivers as tabs, like the car tabs (hold and drag to reorder). */
export function DriverTabs({
  drivers,
  active,
  onChoose,
  onReorder,
  className,
}: {
  drivers: MyDriverResponse["drivers"];
  active: string | null;
  onChoose: (id: string) => void;
  onReorder?: (ids: string[]) => void;
  className?: string;
}) {
  return (
    <FollowTabs
      label="Your drivers"
      tabs={drivers.map((d) => ({ id: d.id, label: d.name }))}
      active={active}
      onChoose={onChoose}
      onReorder={onReorder}
      className={className}
    />
  );
}

export function MyDriverCard({ data }: { data: MyDriverResponse }) {
  const [expanded, setExpanded] = useState(false);
  const { driver, race, car, facts, driverFacts: drive, story } = data;
  if (!driver) return null;
  const first = firstName(driver.name);

  if (!race || !car) {
    return (
      <section className="rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] px-5 py-4 text-left">
        <div className="text-sm font-semibold text-[var(--rt-text)]">{driver.name}</div>
        <p className="m-0 mt-1 text-sm text-[var(--rt-text-secondary)]">
          No race for {first} on RaceTrace yet. Their next race shows here once it is published.
        </p>
      </section>
    );
  }

  const open = () => track("open_story", { raceId: race.id, hasPackage: !!story, from: "driver" });
  const ctx: ProseContext = { cars: story?.cars, classes: story?.classes };
  const recent = data.recent ?? [];
  const totals = data.totals;

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] text-left">
      <div className="flex flex-wrap items-center gap-2.5 px-5 pt-3">
        <SeriesBadge series={race.series} size="sm" />
        <span className="text-sm font-semibold text-[var(--rt-text)]">{driver.name}</span>
        <span className="text-sm text-[var(--rt-text-secondary)]">
          {race.name} · {formatDayRange(race.date, race.date)}
        </span>
        <StatusPill status={race.resultsStatus} />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pt-2.5 text-[13px] text-[var(--rt-text-secondary)]">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--rt-border)] px-2.5 py-1">
          <span className="font-mono font-bold text-[var(--rt-accent)]">#{car.number}</span>
          <span>{car.team}</span>
          <span className="text-[var(--rt-text-muted)]">· {car.cls}</span>
        </span>
        {car.coDrivers.length > 0 && <span className="text-[var(--rt-text-muted)]">with {list(car.coDrivers)}</span>}
      </div>

      <div className="flex flex-col gap-2.5 px-5 pb-3.5 pt-2.5">
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
            ) : null}
            {facts && (
              <p className={`m-0 tabular-nums ${story ? "text-sm text-[var(--rt-text-secondary)]" : "text-[17px] font-medium leading-snug sm:text-[20px]"}`}>
                {finishLine(facts)} · {facts.laps} of {facts.raceLaps} laps
              </p>
            )}

            {drive && <DriveBox name={driver.name} drive={drive} carBest={facts?.bestLap ?? null} />}

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
              <Link to={chartHref(race.id, car.number)} onClick={open} className="font-semibold text-[var(--rt-accent)]">
                Position Trace →
              </Link>
              <Link to={chartHref(race.id, car.number, "pitanalysis")} onClick={open} className="text-[var(--rt-accent)]">
                Pit stops →
              </Link>
              <ShareDriverCardButton input={{ driverName: driver.name, race, car, facts: facts ?? null, drive: drive ?? null }} />
            </div>
          </>
        )}
      </div>

      {recent.length > 1 && (
        <div className="border-t border-[var(--rt-border)] px-5 pb-3 pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--rt-text-muted)]">{first}&apos;s recent races</h3>
            {totals && (
              <span className="text-[12px] text-[var(--rt-text-muted)]">
                {totals.races} race{totals.races === 1 ? "" : "s"} · {totals.series.length} series
              </span>
            )}
          </div>
          <ul className="m-0 mt-1.5 flex list-none flex-col p-0 text-[13px] tabular-nums">
            {recent.slice(1, 5).map((r) => (
              <li key={r.raceId} className="flex min-h-[40px] items-center gap-3 border-t border-[var(--rt-border)]">
                <span className="w-12 shrink-0 text-[var(--rt-text-muted)]">{formatDayRange(r.date, r.date).replace(/,\s*\d{4}$/, "")}</span>
                <SeriesBadge series={r.series} size="sm" />
                <Link to={chartHref(r.raceId, r.carNumber)} className="min-w-0 flex-1 truncate text-[var(--rt-text)] hover:text-[var(--rt-accent)]">
                  {r.raceName}
                </Link>
                <span className="hidden shrink-0 text-[var(--rt-text-secondary)] sm:inline">
                  #{r.carNumber} · {r.carClass}
                </span>
                <span className="w-10 shrink-0 text-right font-semibold text-[var(--rt-text)]">{result(r)}</span>
              </li>
            ))}
          </ul>
          {totals && totals.races > 5 && (
            <Link to={`/races?q=${encodeURIComponent(driver.name)}`} className="mt-1.5 inline-flex min-h-[36px] items-center text-[13px] text-[var(--rt-accent)]">
              All of {first}&apos;s races →
            </Link>
          )}
        </div>
      )}
    </article>
  );
}

function DriveBox({
  name,
  drive,
  carBest,
}: {
  name: string;
  drive: NonNullable<MyDriverResponse["driverFacts"]>;
  carBest: { sec: number; lap: number } | null;
}) {
  const first = firstName(name);
  if (!drive.known || drive.myStints === 0) {
    return (
      <div className="rounded-lg border border-[var(--rt-border)] px-4 py-3 text-[13px] text-[var(--rt-text-secondary)]">
        <span className="font-semibold text-[var(--rt-text)]">{first}&apos;s drive · </span>
        {drive.known
          ? `The timing names the car's drivers, but not ${first} in any stint.`
          : "This race's timing doesn't say who drove when, so the numbers here are the car's."}
        {carBest && (
          <span className="tabular-nums">
            {" "}
            Car&apos;s best lap <span className="font-mono">{formatDuration(carBest.sec)}</span> on lap {carBest.lap}.
          </span>
        )}
      </div>
    );
  }
  const share = drive.carTimeS > 0 ? Math.round((drive.driveTimeS / drive.carTimeS) * 100) : null;
  const total = Math.max(1, drive.stints.reduce((n, s) => n + s.end - s.start + 1, 0));
  const others = [...new Set(drive.stints.filter((s) => !s.mine && s.driver).map((s) => displayName(s.driver!)))];
  const shade = (d: string | null) => (d ? OTHER[Math.max(0, others.indexOf(displayName(d))) % 2] : "var(--rt-border)");
  const mine = drive.stints.filter((s) => s.mine);
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-[var(--rt-border)] px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--rt-text-muted)]">{first}&apos;s drive</div>
      <dl className="m-0 grid grid-cols-3 gap-3 tabular-nums">
        <div>
          <dd className="m-0 text-[20px] font-bold leading-none text-[var(--rt-text)]">{driveTimeText(drive.driveTimeS)}</dd>
          <dt className="mt-1 text-[12px] text-[var(--rt-text-muted)]">drive time{share !== null ? ` · ${share}%` : ""}</dt>
        </div>
        <div>
          <dd className="m-0 text-[20px] font-bold leading-none text-[var(--rt-text)]">
            {drive.myStints} <span className="text-[13px] font-semibold text-[var(--rt-text-muted)]">stint{drive.myStints === 1 ? "" : "s"}</span>
          </dd>
          <dt className="mt-1 truncate text-[12px] text-[var(--rt-text-muted)]">laps {mine.map((s) => `${s.start}–${s.end}`).join(", ")}</dt>
        </div>
        <div>
          <dd className="m-0 font-mono text-[20px] font-bold leading-none text-[var(--rt-text)]">{drive.bestLap ? formatDuration(drive.bestLap.sec) : "—"}</dd>
          <dt className="mt-1 text-[12px] text-[var(--rt-text-muted)]">
            {/* Co-drivers race together: no ranking against them here. */}
            {drive.bestLap ? `best lap, lap ${drive.bestLap.lap}` : "no green lap"}
          </dt>
        </div>
      </dl>
      <div>
        <div
          role="img"
          aria-label={`Who drove when: ${drive.stints.map((s) => `${s.driver ?? "not named"} laps ${s.start} to ${s.end}`).join("; ")}`}
          className="flex h-2.5 gap-0.5 overflow-hidden rounded"
        >
          {drive.stints.map((s) => (
            <span key={s.start} style={{ flex: s.end - s.start + 1, background: s.mine ? "var(--rt-accent)" : shade(s.driver) }} />
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-[var(--rt-text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[var(--rt-accent)]" aria-hidden />
            {first}
          </span>
          {others.map((o) => (
            <span key={o} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: shade(o) }} aria-hidden />
              {o}
            </span>
          ))}
          <span className="ml-auto tabular-nums">{total} laps</span>
        </div>
      </div>
    </div>
  );
}

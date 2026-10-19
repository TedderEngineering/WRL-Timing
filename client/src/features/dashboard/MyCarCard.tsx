import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SeriesBadge } from "../../components/SeriesBadge";
import { ProseText, formatDuration, type Prose, type ProseContext } from "../../lib/prose";
import { track } from "../../lib/analytics";
import { SupportAsk } from "../support/SupportPrompts";
import { useSupport } from "../support/SupportContext";
import { canAsk } from "../support/storage";
import { StatusPill } from "./RecapCard";
import { formatDayRange } from "./format";
import { readUi, writeUi } from "./ui-state";
import { switchAlerts } from "../my-cars/alerts";
import { displayName } from "../my-drivers/api";
import { driveTimeText } from "../my-drivers/stints";
import { ShareCarCardButton } from "./carShare";

/**
 * "Your car's latest race" (engagement plan C, the peak moment), laid out like the driver card:
 * the car and its drivers, the story's headline and the result, then the car's race (best lap,
 * stops, places over the pit cycles, who drove when with each stint's average), its pit cycles
 * one tile each, and the car's other races to pick from. Facts only, no blame; the coffee ask
 * comes at the end within its usual caps, and the share card shows when the ask does not.
 */

interface CarStint {
  start: number;
  end: number;
  driver: string | null;
  avgLapS: number | null;
  avgLaps: number;
}

export interface CarDriveFacts {
  known: boolean;
  stints: CarStint[];
  drivers: { name: string; stints: number; laps: number; driveTimeS: number; bestLap: { sec: number; lap: number } | null }[];
  carTimeS: number;
}

export interface PitCycleFact {
  cycle: number;
  lap: number;
  before: number;
  after: number;
  net: number;
  /** The car's stop in the cycle (its in-lap); absent from older servers. */
  stopLap?: number | null;
  driveThrough?: boolean;
  caution?: boolean;
  /** The stop's time lost in the class's same cycle, top three of three or more only. */
  quickest?: { rank: number; of: number } | null;
}

export interface CarRaceRow {
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
}

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
    /** The chart's key for the car (the race page's car number). */
    carKey?: string;
    number: string;
    team: string;
    cls: string;
    vehicle: string | null;
    finishClass: number | null;
    finishOverall: number | null;
    classSize: number | null;
    status: string | null;
    /** Took the chequered flag (false for a car that retired, even when classified). */
    finished?: boolean;
    laps: number;
    raceLaps: number;
    bestLap: { sec: number; lap: number } | null;
    bestLapClassRank: number | null;
    pitCycles: PitCycleFact[];
    /** Class benchmarks (plan E), facts in the class top three only. */
    benchmarks?: string[];
  } | null;
  /** The entry's drivers, display-cased. */
  drivers?: string[];
  /** Who drove when, every driver at once (server dashboard/my-driver.ts carDrive). */
  drive?: CarDriveFacts | null;
  story?: { headline: Prose; paragraphs: Prose[]; cars: ProseContext["cars"]; classes: Record<string, string> } | null;
  viewed?: boolean;
  /** Race-ready emails are on. */
  alerts?: boolean;
  /** All the user's cars, for the car tabs. */
  cars?: { id: string; number: string; label: string | null; series: string; teamName: string | null }[];
  /** The car's races, newest first, to pick from. */
  recent?: CarRaceRow[];
  totalRaces?: number;
  /** False when the card shows an earlier race of the car's (?race=). */
  isLatest?: boolean;
}

const chartHref = (id: string, car?: string, tab?: string) =>
  `/chart?race=${id}${car ? `&car=${encodeURIComponent(car)}` : ""}${tab ? `&tab=${tab}` : ""}`;
const ORDINAL = ["", "fastest", "2nd fastest", "3rd fastest"];
const QUICKEST = ["", "Quickest", "2nd quickest", "3rd quickest"];
/** Each driver's colour in the stint bar, in the order they first drove. */
const DRIVER_COLORS = ["var(--rt-accent)", "var(--rt-info)", "#a78bfa", "#2dd4bf", "var(--rt-text-muted)"];
/** How many of the car's races show before "More races". */
const RACES_SHOWN = 5;

export function finishLine(f: NonNullable<MyCarResponse["facts"]>): string {
  if (f.finishClass !== null) {
    const of = f.classSize ? ` of ${f.classSize}` : "";
    // A car that stopped before the end can still be classified: say both, never "finished".
    if (f.finished === false) return `Retired after lap ${f.laps} · classified P${f.finishClass} in ${f.cls}${of}`;
    return `Finished P${f.finishClass} in ${f.cls}${of} · P${f.finishOverall} overall`;
  }
  if (f.status === "dsq") return "Disqualified";
  if (f.status === "dns") return "Did not start";
  if (f.status === "dnf") return "Did not finish";
  return "Not classified";
}

/** One pit cycle in words (screen readers, the share card's lines). */
export function pitCycleLine(c: PitCycleFact, cls: string): string {
  const change = c.net > 0 ? `gained ${c.net}` : c.net < 0 ? `lost ${-c.net}` : "held position";
  const stop = c.stopLap ? `stop on lap ${c.stopLap}` : `settled lap ${c.lap}`;
  return `Pit cycle ${c.cycle} (${stop}): P${c.before} → P${c.after} in ${cls}, ${change}`;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Oct 11", with the year for a race of another year ("Oct 11, 2025"). */
function shortDate(date: string): string {
  const d = formatDayRange(date, date);
  return date.slice(0, 4) === String(new Date().getFullYear()) ? d.replace(/,\s*\d{4}$/, "") : d;
}

function result(r: CarRaceRow): string {
  if (r.finishPosClass && r.finishPosClass < 900) return `P${r.finishPosClass}`;
  if (r.finishPos && r.finishPos < 900) return `P${r.finishPos}`;
  return "—";
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

export function MyCarCard({
  data,
  ask = true,
  onPickRace,
  picking = null,
}: {
  data: MyCarResponse;
  /** False when the season recap carries the coffee ask. */
  ask?: boolean;
  /** Show one of the car's races on the card; null for the latest. */
  onPickRace?: (raceId: string | null) => void;
  /** The race being loaded, while it loads. */
  picking?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [allRaces, setAllRaces] = useState(false);
  const { support } = useSupport();
  // The coffee ask and the share card don't sit together: the share shows when the ask does not.
  const [askNow] = useState(() => ask && support.enabled && canAsk());
  const { car, race, facts, story } = data;
  const raceId = race?.id;
  useEffect(() => setExpanded(false), [raceId]);
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
  const number = facts?.number ?? car.number;
  const drivers = data.drivers ?? [];
  const recent = data.recent ?? [];
  const shownRaces = allRaces ? recent : recent.slice(0, RACES_SHOWN);
  const earlier = data.isLatest === false;

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--rt-border)] bg-[var(--rt-surface)] text-left">
      <div className="flex flex-wrap items-center gap-2.5 px-5 pt-3">
        <SeriesBadge series={race.series} size="sm" />
        <span className="text-sm font-semibold text-[var(--rt-text)]">{car.label ?? `#${car.number}`}</span>
        <span className="text-sm text-[var(--rt-text-secondary)]">
          {race.name} · {formatDayRange(race.date, race.date)}
        </span>
        <StatusPill status={race.resultsStatus} />
        {earlier && onPickRace && (
          <button
            type="button"
            onClick={() => onPickRace(null)}
            disabled={picking !== null}
            className="ml-auto min-h-[32px] text-[13px] font-semibold text-[var(--rt-accent)] disabled:opacity-60"
          >
            ← Latest race
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pt-2.5 text-[13px] text-[var(--rt-text-secondary)]">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--rt-border)] px-2.5 py-1">
          <span className="font-mono font-bold text-[var(--rt-accent)]">#{number}</span>
          <span>{facts?.team ?? car.teamName ?? ""}</span>
          {facts?.cls && <span className="text-[var(--rt-text-muted)]">· {facts.cls}</span>}
        </span>
        {drivers.length > 0 && <span className="text-[var(--rt-text-muted)]">{list(drivers)}</span>}
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

            {facts && <CarRaceBox facts={facts} drive={data.drive ?? null} />}
            {facts && facts.pitCycles.length > 0 && <PitCycles cls={facts.cls} cycles={facts.pitCycles} />}

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
              <Link to={chartHref(race.id, number)} onClick={open} className="font-semibold text-[var(--rt-accent)]">
                Position Trace →
              </Link>
              <Link to={chartHref(race.id, number, "pitanalysis")} onClick={open} className="text-[var(--rt-accent)]">
                Pit stops →
              </Link>
              {!askNow && facts?.carKey && <ShareCarCardButton race={race} carKey={facts.carKey} short={`#${number}`} />}
              {data.carCount > 1 && (
                <Link to="/settings/cars" className="ml-auto text-[13px] text-[var(--rt-text-muted)]">
                  {data.carCount} cars followed
                </Link>
              )}
            </div>

            {/* After the peak moment: the one contextual ask, at most every 30 days. */}
            {askNow && <SupportAsk />}
          </>
        )}
      </div>

      {recent.length > 1 && (
        <div className="border-t border-[var(--rt-border)] px-5 pb-3 pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--rt-text-muted)]">#{number}&apos;s races</h3>
            {data.totalRaces ? (
              <span className="text-[12px] text-[var(--rt-text-muted)]">
                {data.totalRaces} race{data.totalRaces === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          {onPickRace && <p className="m-0 mt-0.5 text-[12px] text-[var(--rt-text-muted)]">Pick a race to see it above.</p>}
          <ul className="m-0 mt-1.5 flex list-none flex-col p-0 text-[13px] tabular-nums">
            {shownRaces.map((r) => {
              const current = r.raceId === race.id;
              const row = (
                <>
                  <span className="min-w-12 shrink-0 text-[var(--rt-text-muted)]">{shortDate(r.date)}</span>
                  <SeriesBadge series={r.series} size="sm" />
                  <span className={`min-w-0 flex-1 truncate ${current ? "font-semibold text-[var(--rt-accent)]" : "text-[var(--rt-text)]"}`}>
                    {picking === r.raceId ? "Loading…" : r.raceName}
                  </span>
                  <span className="hidden shrink-0 text-[var(--rt-text-secondary)] sm:inline">
                    #{r.carNumber} · {r.carClass}
                  </span>
                  <span className="w-10 shrink-0 text-right font-semibold text-[var(--rt-text)]">{result(r)}</span>
                </>
              );
              return (
                <li key={r.raceId} className="border-t border-[var(--rt-border)]">
                  {onPickRace ? (
                    <button
                      type="button"
                      aria-current={current ? "true" : undefined}
                      disabled={picking !== null}
                      onClick={() => !current && onPickRace(r.raceId === recent[0]?.raceId ? null : r.raceId)}
                      className="flex min-h-[40px] w-full items-center gap-3 text-left hover:text-[var(--rt-accent)] disabled:cursor-wait"
                    >
                      {row}
                    </button>
                  ) : (
                    <Link to={chartHref(r.raceId, r.carNumber)} className="flex min-h-[40px] items-center gap-3">
                      {row}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {!allRaces && recent.length > RACES_SHOWN && (
            <button type="button" onClick={() => setAllRaces(true)} className="mt-1.5 inline-flex min-h-[36px] items-center text-[13px] text-[var(--rt-accent)]">
              More races ({recent.length - RACES_SHOWN})
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/** The car's race: best lap, stops and places over the pit cycles, then who drove when. */
function CarRaceBox({ facts, drive }: { facts: NonNullable<MyCarResponse["facts"]>; drive: CarDriveFacts | null }) {
  const cycles = facts.pitCycles;
  const net = cycles.reduce((a, c) => a + c.net, 0);
  // Stops: the stints' splits when the timing has them, else the pit cycles.
  const stops = drive && drive.stints.length > 0 ? drive.stints.length - 1 : cycles.length;
  const stopLaps = drive && drive.stints.length > 1 ? drive.stints.slice(0, -1).map((s) => s.end) : cycles.map((c) => c.stopLap).filter((l): l is number => !!l);
  const named = !!drive?.known && drive.drivers.length > 0;
  const colorOf = (d: string | null) => {
    if (!d || !drive) return "var(--rt-border)";
    const i = drive.drivers.findIndex((x) => displayName(x.name) === displayName(d));
    return i < 0 ? "var(--rt-border)" : DRIVER_COLORS[i % DRIVER_COLORS.length];
  };
  const total = Math.max(1, facts.laps);
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-[var(--rt-border)] px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--rt-text-muted)]">#{facts.number}&apos;s race</div>
      <dl className={`m-0 grid gap-3 tabular-nums [&>div]:min-w-0 ${cycles.length ? "grid-cols-3" : "grid-cols-2"}`}>
        <div>
          <dd className="m-0 font-mono text-[16px] font-bold leading-none text-[var(--rt-text)] sm:text-[20px]">{facts.bestLap ? formatDuration(facts.bestLap.sec) : "—"}</dd>
          <dt className="mt-1 text-[12px] text-[var(--rt-text-muted)]">
            {facts.bestLap ? `best lap, lap ${facts.bestLap.lap}${facts.bestLapClassRank ? ` · ${ORDINAL[facts.bestLapClassRank]} in ${facts.cls}` : ""}` : "no green lap"}
          </dt>
        </div>
        <div>
          <dd className="m-0 text-[16px] font-bold leading-none text-[var(--rt-text)] sm:text-[20px]">
            {stops} <span className="text-[13px] font-semibold text-[var(--rt-text-muted)]">stop{stops === 1 ? "" : "s"}</span>
          </dd>
          <dt className="mt-1 truncate text-[12px] text-[var(--rt-text-muted)]">{stopLaps.length ? `laps ${stopLaps.join(", ")}` : stops > 0 ? "in the pit lane" : "no pit stops"}</dt>
        </div>
        {cycles.length > 0 && (
          <div>
            <dd
              className="m-0 text-[16px] font-bold leading-none sm:text-[20px]"
              style={{ color: net > 0 ? "var(--rt-good)" : net < 0 ? "var(--rt-critical)" : "var(--rt-text)" }}
            >
              {signed(net)}
            </dd>
            <dt className="mt-1 text-[12px] text-[var(--rt-text-muted)]">
              place{Math.abs(net) === 1 ? "" : "s"} in {facts.cls} over {cycles.length} pit cycle{cycles.length === 1 ? "" : "s"}
            </dt>
          </div>
        )}
      </dl>

      {named ? (
        <div className="flex flex-col gap-1.5">
          <div
            role="img"
            aria-label={`Who drove when: ${drive!.stints.map((s) => `${s.driver ? displayName(s.driver) : "not named"} laps ${s.start} to ${s.end}`).join("; ")}`}
            className="flex h-2.5 w-full gap-[3px] overflow-hidden rounded-full"
          >
            {drive!.stints.map((s) => (
              <span
                key={s.start}
                title={`${s.driver ? displayName(s.driver) : "Not named"} · laps ${s.start}–${s.end}`}
                style={{ flexGrow: s.end - s.start + 1, flexBasis: 0, background: colorOf(s.driver) }}
              />
            ))}
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px] text-[var(--rt-text-secondary)]">
            {drive!.drivers.map((d) => (
              <li key={d.name} className="inline-flex items-center gap-1.5 tabular-nums">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(d.name) }} />
                <span className="text-[var(--rt-text)]">{displayName(d.name)}</span>
                <span className="text-[var(--rt-text-muted)]">
                  {driveTimeText(d.driveTimeS)}
                  {drive!.carTimeS > 0 ? ` · ${Math.round((d.driveTimeS / drive!.carTimeS) * 100)}%` : ""}
                </span>
              </li>
            ))}
            <li className="ml-auto text-[var(--rt-text-muted)]">{total} laps</li>
          </ul>
          {drive!.stints.some((s) => s.avgLapS) && (
            <div className="mt-1">
              <div className="text-[12px] font-semibold text-[var(--rt-text-muted)]">Stint averages</div>
              <ul className="m-0 mt-1 grid list-none grid-cols-1 gap-x-10 gap-y-0.5 p-0 text-[12px] tabular-nums text-[var(--rt-text-muted)] md:grid-cols-2">
                {drive!.stints.map((s) => (
                  <li
                    key={s.start}
                    className="grid grid-cols-[8px_92px_minmax(0,150px)_auto] items-center gap-x-2"
                    title={s.avgLapS ? `Average of ${s.avgLaps} green laps (no pit, out-lap or caution laps)` : "No green laps to average"}
                  >
                    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: colorOf(s.driver) }} />
                    <span className="whitespace-nowrap">laps {s.start}–{s.end}</span>
                    <span className="truncate">{s.driver ? displayName(s.driver) : "—"}</span>
                    <span className="font-mono font-semibold text-[var(--rt-text)]">{s.avgLapS ? formatDuration(s.avgLapS) : "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        drive && <p className="m-0 text-[12px] text-[var(--rt-text-muted)]">This race&apos;s timing doesn&apos;t say who drove when.</p>
      )}
    </div>
  );
}

/** The car's pit cycles, one tile each: class position before → after and the change. */
function PitCycles({ cls, cycles }: { cls: string; cycles: PitCycleFact[] }) {
  return (
    <section aria-label={`Pit cycles in ${cls}`} className="flex flex-col gap-1.5">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--rt-text-muted)]">Pit cycles in {cls}</div>
      <ol className="m-0 grid list-none grid-cols-2 gap-1.5 p-0 sm:grid-cols-3 lg:grid-cols-6">
        {cycles.map((c) => {
          const tone = c.net > 0 ? "var(--rt-good)" : c.net < 0 ? "var(--rt-critical)" : "var(--rt-text-muted)";
          return (
            <li
              key={c.cycle}
              aria-label={pitCycleLine(c, cls)}
              className="flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 tabular-nums"
              style={{
                borderColor: c.net === 0 ? "var(--rt-border)" : `color-mix(in srgb, ${tone} 45%, transparent)`,
                background: c.net === 0 ? "transparent" : `color-mix(in srgb, ${tone} 7%, transparent)`,
              }}
            >
              <span className="text-[11px] text-[var(--rt-text-muted)]">
                {c.cycle} · {c.stopLap ? `lap ${c.stopLap}` : `settled lap ${c.lap}`}
                {c.driveThrough ? " · drive-through" : c.caution ? " · caution" : ""}
              </span>
              <span className="text-[15px] font-semibold text-[var(--rt-text)]">
                P{c.before} → P{c.after}
              </span>
              <span className="text-[12px] font-semibold" style={{ color: tone }}>
                {c.net > 0 ? `Gained ${c.net}` : c.net < 0 ? `Lost ${-c.net}` : "Held"}
              </span>
              {c.quickest && (
                <span className="text-[11px]" style={{ color: "var(--rt-good)" }}>
                  {QUICKEST[c.quickest.rank]} stop of {c.quickest.of}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * First steps, the first already ticked; shows until all are done or hidden. It teaches the
 * loop: follow your car, open its race (alerts join it when they ship).
 */
export function FirstStepsChecklist({
  data,
  driver = null,
}: {
  data: MyCarResponse | null;
  /** The followed drivers' side (Dashboard /my-driver): following a driver counts as following. */
  driver?: { driverCount: number; race: { id: string } | null; car?: { number: string }; viewed?: boolean } | null;
}) {
  const [hidden, setHidden] = useState(() => !!readUi().checklistHidden);
  const [alertsOn, setAlertsOn] = useState<boolean | null>(null);
  if (!data) return null;
  const alerts = alertsOn ?? !!data.alerts;
  const drivers = driver?.driverCount ?? 0;
  const follows = data.carCount > 0 || drivers > 0;
  // The race to open: the car's when there is one, else the driver's.
  const carFirst = data.carCount > 0 || drivers === 0;
  const openTo = carFirst
    ? data.race
      ? chartHref(data.race.id)
      : null
    : driver?.race
      ? `${chartHref(driver.race.id)}${driver.car ? `&car=${encodeURIComponent(driver.car.number)}` : ""}`
      : null;
  const whose = carFirst ? "your car's" : "your driver's";
  type Step = {
    key: string;
    label: string;
    done: boolean;
    to: string | null;
    start?: string;
    /** Other ways to do the step, beside `start`. */
    alts?: { label: string; to: string; key: string }[];
    /** A step done right here (a switch), not on another page. */
    action?: { label: string; run: () => void };
  };
  const steps: Step[] = [
    { key: "account", label: "Create your account", done: true, to: null },
    {
      key: "follow",
      label: "Follow your car or a driver",
      done: follows,
      to: "/races",
      start: "Find a race →",
      // Or type the car's number, or find the driver by name: no need to find a race first.
      alts: [
        { key: "follow_by_number", label: "Add a car →", to: "/settings/cars" },
        { key: "follow_driver", label: "Find a driver →", to: "/settings/drivers" },
      ],
    },
    { key: "open_race", label: `Open ${whose} latest race`, done: !!data.viewed || !!driver?.viewed, to: openTo },
    {
      key: "alerts",
      label: `Get an email when ${whose} race is up`,
      done: alerts,
      to: null,
      // Only once there is a car or driver to be emailed about.
      action: !follows ? undefined : {
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
              {isNext && !s.alts && !s.action && <span className="ml-auto text-sm font-semibold text-[var(--rt-accent)]">Start →</span>}
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
          if (isNext && s.alts && s.to) {
            // Several ways to do this step: find a race and press Follow, add a car, find a driver.
            return (
              <li key={s.key} className="flex min-h-[40px] flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex items-center gap-3">{body}</span>
                <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold">
                  <Link to={s.to} onClick={() => track("checklist_step", { step: s.key })} className="text-[var(--rt-accent)]">
                    {s.start}
                  </Link>
                  {s.alts.map((a) => (
                    <Link key={a.key} to={a.to} onClick={() => track("checklist_step", { step: a.key })} className="text-[var(--rt-accent)]">
                      {a.label}
                    </Link>
                  ))}
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

/**
 * Beside the log-in and sign-up forms: what an account opens, shown rather than told. The race the
 * visitor's link leads to, a live race or the countdown to the next one, the latest race's story
 * headline, a chart preview, what RaceTrace does in four lines, and how much of it there is (real
 * counts from the site). Every figure comes from /api/landing and the live listing; nothing here
 * is made up, and a missing piece is simply left out.
 */
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { ProseText } from "../../lib/prose";
import { HeroChart } from "../../components/landing/HeroChart";
import { fetchLiveSessions } from "../../hooks/useLiveChartData";
import { shortEvent, type LiveListing } from "../live/banner";
import { datesText, untilText, type Landing } from "../landing/RaceNews";
import { liveName, type GateRace, type GateTarget } from "./gate";

const POINTS = [
  [
    "Every car, every lap",
    "A position trace of the whole field: who gained, who lost, and where.",
  ],
  [
    "The story of each car's race",
    "Stop by stop, written from the timing for every car in the race.",
  ],
  [
    "Pit stops, lap times, strategy",
    "Time lost in the pits against the class, and every stint lap by lap.",
  ],
  [
    "Live timing",
    "Every WRL race as it happens, with the track map. Follow your car and it's always on top.",
  ],
] as const;

/** "WRL, IMSA and SRO". */
function listText(xs: string[]): string {
  return xs.length <= 1
    ? (xs[0] ?? "")
    : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function Check() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 shrink-0 text-brand-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

/** `free`: end with "free for everyone" (the sign-up page says it under its button instead). */
export function AuthShowcase({
  target,
  race,
  free = true,
}: {
  target: GateTarget;
  race: GateRace | null;
  free?: boolean;
}) {
  const [landing, setLanding] = useState<Landing | null>(null);
  const [live, setLive] = useState<LiveListing | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<Landing>("/landing")
      .then((d) => alive && setLanding(d))
      .catch(() => undefined);
    fetchLiveSessions()
      .then((l) => alive && setLive(l))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const liveRace = live?.sessions.find((s) => s.kind === "race") ?? null;
  const next = landing?.next ?? null;
  const latest = landing?.latest ?? null;
  const stats = landing?.stats;

  return (
    <aside
      className="flex flex-col gap-5 rounded-2xl border border-gray-800 bg-gradient-to-b from-gray-900 to-gray-950 p-6 text-white sm:p-7"
      aria-label="What you get with RaceTrace"
    >
      {/* Right now: the race live, else the countdown to the next one. */}
      {liveRace ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
          <b className="text-red-300">Live now</b>
          <span className="text-gray-200">
            {shortEvent(liveRace.eventName, liveRace.track)} · {liveRace.sessionName}
            {liveRace.status ? ` · lap ${liveRace.status.leaderLap}` : ""}
          </span>
        </p>
      ) : next ? (
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm">
          <b className="text-cyan-300">
            Next race {untilText(next.start, next.end, new Date()).toLowerCase()}
          </b>
          <span className="text-gray-300">
            {next.series} · {next.name} · {datesText(next.start, next.end)}
            {next.series === "WRL" ? " · live timing every lap" : ""}
          </span>
        </p>
      ) : null}

      {/* What their link opens, or the latest race. */}
      {target?.kind === "race" && race ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-400">
            Your link
          </p>
          <p className="mt-1 text-lg font-bold leading-snug">{race.name}</p>
          <p className="mt-1 text-sm text-gray-400">
            {race.series} · {datesText(race.date)} · the position trace, pit stops and lap
            times of every car.
          </p>
        </div>
      ) : target?.kind === "live" ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-red-400">
            Your link
          </p>
          <p className="mt-1 text-lg font-bold leading-snug">
            {liveName(target.slug)}, live
          </p>
          <p className="mt-1 text-sm text-gray-400">
            Positions lap by lap, pit stops as they happen, and the track map.
          </p>
        </div>
      ) : latest ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-400">
            Latest race · {latest.series} · {datesText(latest.date)}
          </p>
          <p className="mt-1 text-lg font-bold leading-snug">
            {latest.name.split(" — ")[0]}
          </p>
          {latest.headline && (
            <p className="mt-2 text-[15px] leading-relaxed text-gray-200">
              <ProseText
                prose={latest.headline}
                ctx={{ cars: latest.cars, classes: latest.classes }}
              />
            </p>
          )}
        </div>
      ) : null}

      <div
        className="hidden rounded-xl border border-gray-800 bg-gray-900 p-3 sm:block"
        aria-hidden
      >
        <HeroChart />
      </div>

      <ul className="space-y-2.5">
        {POINTS.map(([title, text]) => (
          <li key={title} className="flex gap-2.5 text-sm leading-snug">
            <Check />
            <span>
              <b className="text-gray-100">{title}.</b>{" "}
              <span className="text-gray-400">{text}</span>
            </span>
          </li>
        ))}
      </ul>

      {((stats && stats.races > 0) || free) && (
        <p className="border-t border-gray-800 pt-4 text-sm text-gray-400">
          {stats && stats.races > 0 ? (
            <>
              <b className="text-gray-100">{stats.races} races</b> from{" "}
              {listText(stats.series)}, and more every race weekend.{" "}
            </>
          ) : null}
          {free ? "Free for everyone: no credit card, no ads." : null}
        </p>
      )}
    </aside>
  );
}

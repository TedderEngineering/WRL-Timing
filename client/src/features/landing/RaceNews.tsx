/**
 * The home page's race news, for everyone (signed out, it is all of RaceTrace a visitor sees): the
 * latest race and its published headline, the next race weekend on the calendars, and live timing,
 * with the race live now when there is one.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { ProseText, type Prose } from "../../lib/prose";
import { useAuth } from "../auth/AuthContext";
import { fetchLiveSessions } from "../../hooks/useLiveChartData";
import { shortEvent, type LiveListing } from "../live/banner";

export interface Landing {
  latest: {
    name: string;
    date: string;
    track: string;
    series: string;
    official: boolean;
    headline: Prose | null;
    cars: Record<string, { team?: string; drivers?: string[]; driverNumbers?: number[] }>;
    classes: Record<string, string>;
  } | null;
  next: LandingWeekend | null;
  upcoming: LandingWeekend[];
}

export interface LandingWeekend {
  series: string;
  name: string;
  track: string;
  start: string;
  end: string;
  session: { name: string; startsAt: string } | null;
}

const MONTH = { month: "short", day: "numeric", timeZone: "UTC" } as const;

/** "Oct 30 – Nov 1, 2026", "Oct 18, 2026". */
export function datesText(start: string, end?: string): string {
  const a = new Date(`${start}T12:00:00Z`);
  const year = a.getUTCFullYear();
  if (!end || end === start) return `${a.toLocaleDateString("en-US", MONTH)}, ${year}`;
  const b = new Date(`${end}T12:00:00Z`);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  return `${a.toLocaleDateString("en-US", MONTH)}–${sameMonth ? b.getUTCDate() : b.toLocaleDateString("en-US", MONTH)}, ${year}`;
}

/** "Under way", "Today", "Tomorrow", "In 9 days" (calendar days, UTC dates of the round). */
export function untilText(start: string, end: string, now: Date): string {
  const day = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const d = Math.round((day(start) - today) / 86_400_000);
  if (d <= 0 && today <= day(end)) return d === 0 ? "Today" : "Under way";
  if (d === 1) return "Tomorrow";
  return `In ${d} days`;
}

const card = "rounded-xl border border-gray-800 bg-gray-900/70 p-5 sm:p-6 flex flex-col";
const kicker = "text-xs font-semibold uppercase tracking-[0.12em]";

export function RaceNews() {
  const { isAuthenticated } = useAuth();
  const [data, setData] = useState<Landing | null>(null);
  const [live, setLive] = useState<LiveListing | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<Landing>("/landing")
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ latest: null, next: null, upcoming: [] }));
    fetchLiveSessions()
      .then((l) => alive && setLive(l))
      .catch(() => alive && setLive(null));
    return () => {
      alive = false;
    };
  }, []);

  const liveRace = live?.sessions.find((s) => s.kind === "race") ?? live?.sessions[0] ?? null;
  const nextLive = live?.upcoming?.[0] ?? null;
  const cta = (to: string, label: string) =>
    isAuthenticated ? (
      <Link to={to} className="mt-auto inline-flex pt-5 text-sm font-semibold text-brand-400 hover:text-brand-300">
        {label} →
      </Link>
    ) : (
      <Link to="/signup" className="mt-auto inline-flex pt-5 text-sm font-semibold text-brand-400 hover:text-brand-300">
        Sign up free to {label.charAt(0).toLowerCase()}
        {label.slice(1)} →
      </Link>
    );

  return (
    <section className="bg-gray-950 text-white" aria-labelledby="race-news">
      <div className="container-page pb-20 pt-4 lg:pb-24">
        <h2 id="race-news" className="sr-only">
          Race news
        </h2>
        <div className="grid gap-5 lg:grid-cols-3">
          {/* The latest race */}
          <article className={card}>
            <p className={`${kicker} text-brand-400`}>Latest race</p>
            {data?.latest ? (
              <>
                <h3 className="mt-2 text-lg font-bold leading-snug">{data.latest.name}</h3>
                <p className="mt-1 text-sm text-gray-400">
                  {data.latest.series} · {datesText(data.latest.date)}
                  {!data.latest.official && <span className="ml-2 rounded-full border border-amber-400/60 px-2 py-px text-xs text-amber-300">Provisional</span>}
                </p>
                {data.latest.headline && (
                  <p className="mt-4 text-[15px] leading-relaxed text-gray-200">
                    <ProseText prose={data.latest.headline} ctx={{ cars: data.latest.cars, classes: data.latest.classes }} />
                  </p>
                )}
                {cta("/races", "Read every car's story")}
              </>
            ) : (
              <p className="mt-3 text-sm text-gray-500">{data ? "No race yet." : "Loading…"}</p>
            )}
          </article>

          {/* The next race weekend */}
          <article className={card}>
            <p className={`${kicker} text-cyan-400`}>Next race</p>
            {data?.next ? (
              <>
                <h3 className="mt-2 text-lg font-bold leading-snug">
                  {data.next.series} · {data.next.name}
                </h3>
                <p className="mt-1 text-sm text-gray-400">
                  {data.next.track} · {datesText(data.next.start, data.next.end)}
                </p>
                <p className="mt-4 text-3xl font-extrabold tracking-tight">{untilText(data.next.start, data.next.end, new Date())}</p>
                {data.next.session && (
                  <p className="mt-1 text-sm text-gray-400">
                    {data.next.session.name} starts{" "}
                    {new Date(data.next.session.startsAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
                  </p>
                )}
                {data.upcoming.length > 0 && (
                  <ul className="mt-4 space-y-1 border-t border-gray-800 pt-3 text-sm text-gray-400">
                    {data.upcoming.map((u) => (
                      <li key={`${u.series}-${u.start}`}>
                        <span className="text-gray-200">{u.series}</span> · {u.name} · {datesText(u.start, u.end)}
                      </li>
                    ))}
                  </ul>
                )}
                {cta("/dashboard", "Follow your car")}
              </>
            ) : (
              <p className="mt-3 text-sm text-gray-500">{data ? "The calendar is quiet for now." : "Loading…"}</p>
            )}
          </article>

          {/* Live timing */}
          <article className={card}>
            <p className={`${kicker} flex items-center gap-2 text-red-400`}>
              <span className={`h-2 w-2 rounded-full bg-red-500 ${liveRace ? "animate-pulse" : "opacity-60"}`} />
              {liveRace ? "Live now" : "Live timing"}
            </p>
            {liveRace ? (
              <>
                <h3 className="mt-2 text-lg font-bold leading-snug">
                  {shortEvent(liveRace.eventName, liveRace.track)} · {liveRace.sessionName}
                </h3>
                {liveRace.status && (
                  <p className="mt-1 text-sm text-gray-400">
                    Lap {liveRace.status.leaderLap}
                    {liveRace.status.flag ? ` · ${liveRace.status.flag}` : ""}
                  </p>
                )}
              </>
            ) : (
              <h3 className="mt-2 text-lg font-bold leading-snug">Every WRL race, as it happens</h3>
            )}
            <p className="mt-4 text-[15px] leading-relaxed text-gray-300">
              Positions lap by lap, every pit stop as it happens, and every car on the track map, updated every few seconds. Follow your car
              and it's always on top.
            </p>
            {!liveRace && nextLive && (
              <p className="mt-3 text-sm text-gray-400">
                Next live: {shortEvent(nextLive.eventName, nextLive.track)} · {nextLive.sessionName},{" "}
                {new Date(nextLive.startsAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
              </p>
            )}
            {cta(liveRace ? `/live/${liveRace.slug}` : "/live", liveRace ? "Watch it live" : "See what's on")}
          </article>
        </div>
      </div>
    </section>
  );
}

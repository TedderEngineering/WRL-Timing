/**
 * RaceTrace Live: a WRL session still running, drawn with the same
 * Position Trace and Lap Times as a finished race and refreshed as laps
 * complete. Public, no login. Nothing here is stored as a race.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { LapChart } from "../features/chart/LapChart";
import { LapTimeChart } from "../features/chart/LapTimeChart";
import { PitAnalysisTab } from "../features/chart/PitAnalysisTab";
import { TrackMap } from "../features/chart/TrackMap";
import { TraceControls } from "../features/chart/TraceControls";
import { pitAnalysisFromChart } from "../features/chart/live-pit-analysis";
import { useTraceView } from "../features/chart/trace-view";
import { useChartDefaults } from "../features/chart/chart-defaults";
import { carKey, carNo } from "../features/chart/car-number";
import { gapClock, lapsAndSeconds, leaderGaps, type LeaderGap } from "../features/chart/live-gaps";
import { LiveClockContext, LiveRaceContext } from "../features/chart/live-zoom";
import { hasTeamAccess } from "../lib/utils";
import { fetchLiveSessions, getPublic, useLiveChartData, type LiveListing, type LiveSessionListing, type UpcomingListed } from "../hooks/useLiveChartData";
import { countdownText, goesLiveText, sessionFor } from "../features/live/banner";
import type { RaceChartData } from "@shared/types";
import { readLiveCar, saveLiveCar } from "../features/live/my-car";

const RT = { line: "#1e1e38", border: "#3a3a5c", card: "#12122a", text: "#e0e0e8", soft: "#cbd5e1", muted: "#9a9ab4", accent: "#F48C34", live: "#ef4444" };

const FLAG_COLORS: Record<string, string> = {
  Green: "#22c55e",
  Yellow: "#facc15",
  "Code 35": "#a855f7",
  "Code 60": "#a855f7",
  Red: "#ef4444",
  White: "#e5e7eb",
  Checkered: "#e5e7eb",
  Black: "#9ca3af",
};

function ago(ms: number | null, now: number): string {
  if (ms === null) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`;
}

/** "7:35:12"-style span → seconds. */
function spanSec(s: string | null | undefined): number | null {
  const m = String(s ?? "").match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return m ? Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]) : null;
}

function hms(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Race time and time to go, counting every second between updates from the last values the
 * timing gave (`at` = when they were true on this device's clock). Frozen under a red flag, at
 * the finish, or when `frozen`. Its own timer, so the charts do not re-render each second.
 */
function RaceClock({ run, ttg, at, frozen }: { run: string | null | undefined; ttg: string | null | undefined; at: number | null; frozen: boolean }) {
  const now = useNow(1000);
  const runSec = spanSec(run);
  const ttgSec = spanSec(ttg);
  const elapsed = !frozen && at !== null ? Math.max(0, (now - at) / 1000) : 0;
  return (
    <>
      {runSec !== null && <span style={{ color: RT.soft }}>Race time {hms(runSec + elapsed)}</span>}
      {ttgSec !== null && <span style={{ color: RT.soft }}>{hms(ttgSec - elapsed)} to go</span>}
    </>
  );
}

function useNow(every = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-24 text-center" style={{ background: "#0b0b18", color: RT.text }}>
      {children}
    </div>
  );
}

/** Flags under which the gap to the leader matters most (the field bunches; the gap is time to make up at the restart). */
const CAUTION_FLAGS = new Set(["Yellow", "Code 35", "Code 60", "Red"]);

function gapPart(g: LeaderGap, label: string) {
  // "54.1 (+1L)": whole laps at the car's average lap, and the rest in seconds.
  const text = g.pace !== null ? lapsAndSeconds(g.laps, g.pace) : g.sec !== null ? gapClock(g.sec) : `${g.laps.toFixed(1)} L`;
  return (
    <span className="whitespace-nowrap">
      <b>{text}</b> behind {label}
    </span>
  );
}

/**
 * The focus car's gap to the overall and class leaders, in laps and seconds of its recent green
 * pace. Under a caution it stands out: the gap is what the car has to make up at the restart.
 */
function LeaderGapBadge({ data, focusNum, flag, drift }: { data: Parameters<typeof leaderGaps>[0]; focusNum: number; flag: string | null; drift: () => number | null }) {
  useNow(1000); // moves on every second between updates
  if (!focusNum || !data.cars[String(focusNum)]) return null;
  const g = leaderGaps(data, focusNum, drift());
  const caution = !!flag && CAUTION_FLAGS.has(flag);
  const num = carNo(data, focusNum);
  const parts = [g.overall && gapPart(g.overall, "the leader"), g.cls && gapPart(g.cls, `the ${g.clsName} leader`)].filter(Boolean);
  return (
    <span
      className={caution ? "flex flex-wrap items-center gap-x-2 rounded-md border px-2 py-0.5 text-[15px] font-medium" : "flex flex-wrap items-center gap-x-2"}
      style={caution ? { borderColor: "#facc15", background: "rgba(250,204,21,0.12)", color: "#fde68a" } : { color: RT.soft }}
      title="Behind the leader: whole laps at the car's average lap (its last 5 green laps), and the rest in seconds; 54.1 (+1L) = a lap and 54.1 s. Under a caution it is the time to make up once racing resumes. Between updates it moves on at each car's pace (an estimate); under a caution it holds the last timed gap."
    >
      <span className="font-mono font-semibold" style={{ color: caution ? "#fde68a" : RT.accent }}>
        #{num}
      </span>
      {parts.length ? parts.map((x, i) => <span key={i}>{i > 0 ? "· " : ""}{x}</span>) : <span>leads the race</span>}
    </span>
  );
}

function LiveDot() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: RT.live }} />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: RT.live }} />
    </span>
  );
}

// ─── Before the first lap ─────────────────────────────────────────────────────

type Entry = { car: string; team: string; cls: string };

/** A chart with every entry and no laps: the controls (focus, class, compare) work before the race. */
function entriesChart(entries: Entry[]): RaceChartData {
  const cars: RaceChartData["cars"] = {};
  const classGroups: Record<string, number[]> = {};
  const used = new Set<number>();
  entries.forEach((e, i) => {
    let key = parseInt(e.car, 10);
    if (!Number.isFinite(key) || key <= 0 || used.has(key) || String(key) !== e.car) key = 100_000 + i;
    used.add(key);
    cars[String(key)] = { num: key, team: e.team, cls: e.cls, finishPos: 0, finishPosClass: 0, laps: [], ...(String(key) !== e.car ? { label: e.car } : {}) } as RaceChartData["cars"][string];
    (classGroups[e.cls] ??= []).push(key);
  });
  return {
    maxLap: 0,
    totalCars: entries.length,
    greenPaceCutoff: 0,
    cars,
    fcy: [],
    classGroups,
    classCarCounts: Object.fromEntries(Object.entries(classGroups).map(([k, v]) => [k, v.length])),
  } as RaceChartData;
}

/** "Green flag 8:00 AM EDT · in 40 min" */
function greenText(startsAt: string | null, now: number): string | null {
  if (!startsAt) return null;
  const t = new Date(startsAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const left = countdownText(startsAt, now);
  return `Green flag ${t}${left === "Starting now" ? " · starting now" : ` · in ${left}`}`;
}

/**
 * The live page before its first lap: the whole layout, every control working. The header says the
 * race is not live yet and when it starts; focus car, class and compare can be set now (the car is
 * kept for the live page); the track map shows the circuit, and the cars once the timing places
 * them; the trace, lap details, pit stops and lap times fill in from the first completed lap.
 */
function PreRaceLayout({
  slug,
  sessionName,
  eventName,
  track,
  startsAt,
  entries,
  note,
}: {
  /** The live session once the timing has it (the track map uses it); null before. */
  slug: string | null;
  sessionName: string;
  eventName: string;
  track: string;
  startsAt: string | null;
  entries: Entry[];
  note?: string | null;
}) {
  const now = useNow(1000);
  const data = useMemo(() => entriesChart(entries), [entries]);
  const [tab, setTab] = useState<"position" | "map" | "pitanalysis" | "laptimes">("position");
  const [headSlot, setHeadSlot] = useState<HTMLDivElement | null>(null);
  const [focusNum, setFocusNumRaw] = useState(0);
  const [compSet, setCompSet] = useState<Set<number>>(new Set());
  const [classView, setClassView] = useState("");
  const setFocusNum = useCallback(
    (n: number) => {
      setFocusNumRaw(n);
      saveLiveCar(eventName, n ? carNo(data, n) : null);
    },
    [data, eventName]
  );
  // Open on the car picked before (on this device), else the first entry.
  useEffect(() => {
    if (focusNum && data.cars[String(focusNum)]) return;
    const saved = readLiveCar(eventName);
    const key = saved ? carKey(data, saved) : null;
    setFocusNumRaw(key !== null && data.cars[String(key)] ? key : Number(Object.keys(data.cars)[0] ?? 0));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const traceView = useTraceView({ data, focusNum, setFocusNum, setCompSet, classView, setClassView, raceKey: `pre:${eventName}:${sessionName}` });
  const focus = data.cars[String(focusNum)];
  const green = greenText(startsAt, now);
  const tabs = [
    { id: "position" as const, label: "Position Trace" },
    { id: "map" as const, label: "Track Map" },
    { id: "pitanalysis" as const, label: "Pit Stops" },
    { id: "laptimes" as const, label: "Lap Times" },
  ];
  const panel = "rounded-lg border p-4 text-sm";
  const waitText = (what: string) => (
    <div className="flex min-h-[260px] flex-1 items-center justify-center px-6 text-center md:min-h-0" style={{ color: RT.muted }}>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: RT.accent }}>
          Not live yet
        </div>
        <p className="mt-2 max-w-md">{what}</p>
      </div>
    </div>
  );
  return (
    <div className="flex h-full flex-col overflow-y-auto custom-scroll md:overflow-hidden" style={{ background: "#0b0b18", color: RT.text }}>
      <section className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-1.5 pt-2.5 text-sm sm:px-6 sm:pt-3" role="status" aria-live="polite">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="self-center rounded border px-1.5 text-[11px] font-semibold tracking-[0.04em]" style={{ borderColor: RT.border, color: RT.text }}>
            WRL
          </span>
          <span className="text-lg font-semibold sm:text-xl">{sessionName}</span>
          <span style={{ color: RT.soft }}>{[eventName, eventName.includes(track) ? null : track].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider" style={{ borderColor: RT.accent, color: RT.accent }}>
          Not live yet
        </span>
        {green && <span>{green}</span>}
        <span>{entries.length} cars</span>
        {note && (
          <span className="text-xs" style={{ color: RT.muted }}>
            {note}
          </span>
        )}
      </section>

      <div className="mt-0.5 flex shrink-0 flex-wrap items-stretch gap-x-4 border-b px-2 sm:px-6" style={{ borderColor: RT.line }}>
        <nav aria-label="Race views" className="no-scrollbar flex min-w-0 items-end gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(t.id)}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm"
                style={{ color: active ? RT.text : RT.muted, fontWeight: active ? 600 : 400, borderBottom: `2px solid ${active ? RT.accent : "transparent"}`, marginBottom: -1 }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
        <div ref={setHeadSlot} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1.5 empty:hidden" />
      </div>

      {tab !== "pitanalysis" && entries.length > 0 && (
        <TraceControls data={data} focusNum={focusNum} onFocus={setFocusNum} classView={classView} compSet={compSet} view={traceView} headSlot={headSlot} />
      )}

      {tab === "map" ? (
        slug ? (
          <TrackMap slug={slug} data={data} focusNum={focusNum} setFocusNum={setFocusNum} compSet={compSet} classView={classView} />
        ) : (
          waitText("The track map shows the circuit and every car on it once the timing opens the session, about an hour before the start.")
        )
      ) : tab === "pitanalysis" ? (
        waitText("Pit stops fill in from the first stop: time lost, the class pit cycles and the leaderboard.")
      ) : (
        <div className="flex flex-col md:min-h-0 md:flex-1 md:flex-row">
          <div className="flex min-w-0 flex-1 flex-col px-2 py-2 sm:px-6 sm:py-3 md:min-h-0">
            <figure className="m-0 flex flex-1 flex-col rounded-lg border" style={{ background: RT.card, borderColor: RT.line }}>
              {waitText(
                tab === "laptimes"
                  ? "Lap times draw here from the first completed lap."
                  : "The position trace draws here from the first completed lap: every car's position, lap by lap."
              )}
            </figure>
          </div>
          <aside className="flex flex-col border-t md:min-h-0 md:w-[360px] md:shrink-0 md:border-l md:border-t-0 lg:w-[400px]" style={{ borderColor: RT.line }}>
            <div className="flex gap-4 border-b px-4 text-sm" style={{ borderColor: RT.line }}>
              <span className="border-b-2 py-2 font-semibold" style={{ borderColor: RT.accent }}>
                Lap details
              </span>
              <span className="py-2" style={{ color: RT.muted }}>
                Gaps
              </span>
            </div>
            <div className="flex flex-col gap-3 p-4">
              {focus && (
                <div>
                  <div className="font-semibold">
                    <span className="font-mono" style={{ color: RT.accent }}>
                      #{carNo(data, focusNum)}
                    </span>{" "}
                    {focus.team} · {focus.cls}
                  </div>
                  <div className="text-[13px]" style={{ color: RT.muted }}>
                    Your car: live timing opens on it.
                  </div>
                </div>
              )}
              <div className={panel} style={{ background: RT.card, borderColor: RT.line, color: RT.muted }}>
                Lap details, the gaps to the cars around you and the gap to the leader fill in from the first completed lap.
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// ─── /live/next/:id ───────────────────────────────────────────────────────────

/** When to start asking whether the timing has opened the session: the timing opens about an hour before the start. */
const OPENS_BEFORE_MS = 2 * 3600_000;
const CHECK_MS = 60_000;

/**
 * A scheduled race before its timing opens: the whole live layout (not live yet), every control
 * working. It asks whether the timing has the session only from two hours before the start (once a
 * minute), then turns into the live race page on the viewer's car.
 */
export function UpcomingRacePage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<UpcomingListed | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    getPublic<{ session: UpcomingListed; entries: Entry[] }>(`/live/next/${encodeURIComponent(id)}`)
      .then(({ body }) => {
        if (!alive) return;
        setSession(body.session);
        setEntries(body.entries);
      })
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [id]);
  // On the schedule: nothing until two hours before the start, then once a minute until it is live.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      fetchLiveSessions()
        .then((r) => {
          if (!alive) return;
          const live = sessionFor(session, r);
          if (live) {
            const car = readLiveCar(session.eventName);
            navigate(`/live/${live.slug}${car ? `?car=${encodeURIComponent(car)}` : ""}`, { replace: true });
            return;
          }
          timer = setTimeout(check, CHECK_MS);
        })
        .catch(() => alive && (timer = setTimeout(check, CHECK_MS)));
    };
    const wait = Date.parse(session.startsAt) - OPENS_BEFORE_MS - Date.now();
    timer = setTimeout(check, Math.max(0, wait));
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [session, navigate]);

  if (missing) {
    return (
      <Centered>
        <p style={{ color: RT.soft }}>
          This session is not on the schedule any more. <Link to="/live" className="underline" style={{ color: RT.accent }}>See what is live</Link>.
        </p>
      </Centered>
    );
  }
  if (!session) return <Centered><p style={{ color: RT.muted }}>Loading…</p></Centered>;
  return (
    <PreRaceLayout
      slug={null}
      sessionName={session.sessionName}
      eventName={session.eventName}
      track={session.track}
      startsAt={session.startsAt}
      entries={entries}
    />
  );
}

// ─── /live ────────────────────────────────────────────────────────────────────

export function LiveListPage() {
  const [list, setList] = useState<LiveListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchLiveSessions()
        .then((r) => alive && setList(r))
        .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load live sessions"));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const sessions = list?.sessions ?? null;
  const upcoming = list?.upcoming ?? [];
  const recent = list?.recent ?? [];

  if (sessions && sessions.length === 1 && upcoming.length === 0) {
    const s = sessions[0];
    return <Navigate to={`/live/${s.slug}`} replace />;
  }
  const kindLabel = (k: LiveSessionListing["kind"]) => (k === "qualify" ? "Qualifying" : k === "practice" ? "Practice" : "Race");
  const card = "flex items-center justify-between gap-3 rounded-lg border px-4 py-3";
  return (
    <div className="min-h-full px-4 py-10 sm:px-8" style={{ background: "#0b0b18", color: RT.text }}>
      <div className="mx-auto max-w-2xl">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <LiveDot /> RaceTrace Live
        </h1>
        <p className="mt-1 text-sm" style={{ color: RT.muted }}>
          WRL sessions lap by lap from the timing: races, qualifying and practice.
        </p>
        {error && <p className="mt-6 text-sm" style={{ color: RT.soft }}>{error}</p>}
        {!list && !error && <p className="mt-6 text-sm" style={{ color: RT.muted }}>Looking for live sessions…</p>}
        {list && sessions?.length === 0 && upcoming.length === 0 && (
          <p className="mt-6 text-sm" style={{ color: RT.soft }}>
            Nothing is running right now. <Link to="/races" className="underline" style={{ color: RT.accent }}>Browse finished races</Link>.
          </p>
        )}
        <ul className="mt-6 space-y-2">
          {(sessions ?? []).map((s) => (
            <li key={s.slug}>
              <Link to={`/live/${s.slug}`} className={`${card} hover:brightness-125`} style={{ background: RT.card, borderColor: RT.border }}>
                <span>
                  <span className="block font-medium">{s.sessionName}</span>
                  <span className="block text-sm" style={{ color: RT.muted }}>
                    {kindLabel(s.kind)} · {s.eventName}
                    {s.status?.leaderLap ? ` · Lap ${s.status.leaderLap}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs font-semibold tracking-wider" style={{ color: RT.live }}>
                  <LiveDot /> LIVE
                </span>
              </Link>
            </li>
          ))}
          {upcoming.map((u) => (
            <li key={u.id}>
              <Link to={`/live/next/${encodeURIComponent(u.id)}`} className={`${card} hover:brightness-125`} style={{ background: RT.card, borderColor: RT.border }}>
                <span>
                  <span className="block font-medium">{u.sessionName}</span>
                  <span className="block text-sm" style={{ color: RT.muted }}>
                    {u.series} · {u.eventName} · {new Date(u.startsAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
                  </span>
                  <span className="mt-1 block text-xs" style={{ color: RT.muted }}>
                    Live timing opens here when the session starts.
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold tracking-wider" style={{ color: RT.accent }}>
                  {goesLiveText(u.startsAt, now)} ›
                </span>
              </Link>
            </li>
          ))}
          {recent.map((s) => (
            <li key={s.slug}>
              <Link to={`/live/${s.slug}`} className={`${card} hover:brightness-125`} style={{ background: RT.card, borderColor: RT.border }}>
                <span>
                  <span className="block font-medium">{s.sessionName}</span>
                  <span className="block text-sm" style={{ color: RT.muted }}>
                    {kindLabel(s.kind)} · {s.eventName}
                  </span>
                </span>
                <span className="text-xs font-semibold tracking-wider" style={{ color: RT.muted }}>
                  FINISHED
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── /live/:slug ──────────────────────────────────────────────────────────────

export function LiveRacePage() {
  const { slug } = useParams<{ slug: string }>();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const chartDefaults = useChartDefaults(isAuthenticated, authLoading);
  const { data, annotations, race, live, checkedAt, clockAt, error, isLoading, saver } = useLiveChartData(slug);
  const now = useNow();
  const [tab, setTab] = useState<"position" | "map" | "pitanalysis" | "laptimes">("position");
  /** The tab row's slot for the focus car and class picker (TraceControls, wider than a phone). */
  const [headSlot, setHeadSlot] = useState<HTMLDivElement | null>(null);

  const [focusNum, setFocusNum] = useState(0);
  const [compSet, setCompSet] = useState<Set<number>>(new Set());
  const [classView, setClassView] = useState("");
  const [activeLap, setActiveLap] = useState<number | null>(null);
  /** The first chart sets focus and compare; later updates keep the viewer's choices. */
  const initialised = useRef(false);
  /** The car the page opened on (the leader, ?car= or the saved car). */
  const openedOn = useRef(0);

  useEffect(() => {
    if (!data) return;
    const nums = Object.keys(data.cars).map(Number);
    if (!initialised.current) {
      initialised.current = true;
      // First chart: focus on the leader (or ?car=), compare against the field.
      let lead = 0;
      for (const [n, c] of Object.entries(data.cars)) if (c.finishPos === 1) lead = Number(n);
      lead = lead || nums[0] || 0;
      const param = new URLSearchParams(window.location.search).get("car") ?? readLiveCar(live?.eventName);
      const named = param ? carKey(data, param) : null;
      if (named !== null && named > 0 && data.cars[String(named)]) lead = named;
      setFocusNum(lead);
      openedOn.current = lead;
      setClassView(chartDefaults.classView === "focus_class" ? (data.cars[String(lead)]?.cls ?? "") : "");
      setCompSet(new Set(nums.filter((n) => n !== lead)));
      return;
    }
    // A car can drop out of the data (its laps re-scored): keep the focus on a car that exists.
    if (focusNum && !data.cars[String(focusNum)]) setFocusNum(nums[0] ?? 0);
    // Compare keeps the viewer's picks; "All cars" (trace-view) takes in cars that appear mid-race.
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // The car the viewer follows at this event, for the next visit (and its next race's pre-race
  // page): only a car they chose, not the leader the page opened on.
  useEffect(() => {
    if (initialised.current && focusNum && focusNum !== openedOn.current && data?.cars[String(focusNum)]) saveLiveCar(live?.eventName, carNo(data, focusNum));
  }, [focusNum]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFocusChange = useCallback((num: number) => {
    setFocusNum(num);
    setCompSet((prev) => {
      const next = new Set(prev);
      next.delete(num);
      return next;
    });
    setActiveLap(null);
  }, []);

  // ── Moving gaps on between updates ──────────────────────────────
  // Seconds since this data arrived: each pair of cars is moved on at their paces from the later of
  // their last crossings (live-gaps.ts). Held under a caution, red or at the finish (the field
  // bunches in ways green pace does not predict), and never more than 90 s past the data.
  const dataAt = useMemo(() => Date.now(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pit Stops: the live chart's own stops, rebuilt on each update while the tab is open.
  const pitAnalysis = useMemo(
    () => (tab === "pitanalysis" && data ? pitAnalysisFromChart(data, annotations, race?.track ?? "") : null),
    [tab, data, annotations, race?.track]
  );
  const flagNow = live?.status?.flag ?? null;
  const holdGaps = !!live?.ended || (!!flagNow && CAUTION_FLAGS.has(flagNow));
  const drift = useCallback(() => (holdGaps || !data ? null : Math.min(90, (Date.now() - dataAt) / 1000)), [holdGaps, data, dataAt]);

  const traceView = useTraceView({ data: data ?? null, focusNum, setFocusNum: handleFocusChange, setCompSet, classView, setClassView, raceKey: slug });

  // Before the first lap: the entry list and the scheduled start, for the full layout.
  const [preRace, setPreRace] = useState<{ entries: Entry[]; startsAt: string | null; sessionName: string | null } | null>(null);
  const waiting = !data && !!live?.waiting;
  useEffect(() => {
    if (!waiting || !slug) return;
    let alive = true;
    const load = () =>
      getPublic<{ entries: Entry[]; startsAt: string | null; sessionName: string | null }>(`/live/${encodeURIComponent(slug)}/entries`)
        .then(({ body }) => alive && body.entries.length > 0 && setPreRace(body))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [waiting, slug]);

  if (!slug) return <Navigate to="/live" replace />;

  if (isLoading && !data) {
    return (
      <Centered>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: RT.accent, borderTopColor: "transparent" }} />
        <p style={{ color: RT.muted }}>Connecting to the live timing…</p>
      </Centered>
    );
  }

  if ((!data || !annotations || !race) && !error && live && !live.ended && preRace) {
    return (
      <PreRaceLayout
        slug={slug}
        sessionName={preRace.sessionName ?? live.sessionName ?? "Live race"}
        eventName={live.eventName ?? ""}
        track={live.track ?? ""}
        startsAt={preRace.startsAt}
        entries={preRace.entries}
        note={live.waiting}
      />
    );
  }

  if (!data || !annotations || !race) {
    return (
      <Centered>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <LiveDot /> {live?.sessionName ?? "Live race"}
        </h1>
        {live?.eventName && <p style={{ color: RT.soft }}>{[live.eventName, live.track].filter(Boolean).join(" · ")}</p>}
        <p className="max-w-md" style={{ color: RT.muted }}>
          {error ?? live?.waiting ?? "Waiting for the timing."} This page checks again every few seconds.
        </p>
      </Centered>
    );
  }

  const st = live?.status;
  const flag = st?.flag ?? null;
  const serverAge = live?.updatedAt ? now - Date.parse(live.updatedAt) : 0;
  const delayed = !!live?.delayed || !!error || serverAge > 3 * 60_000;
  const isTeam = hasTeamAccess(user);
  const tabs = [
    { id: "position" as const, label: "Position Trace", locked: false },
    { id: "map" as const, label: "Track Map", locked: false },
    { id: "pitanalysis" as const, label: "Pit Stops", locked: !isTeam },
    { id: "laptimes" as const, label: "Lap Times", locked: !isTeam },
  ];

  return (
    // No RaceMetaContext: the race-card share image describes a finished result.
    <LiveRaceContext.Provider value={!live?.ended}>
    <LiveClockContext.Provider value={drift}>
      <div className="flex h-full flex-col overflow-y-auto custom-scroll md:overflow-hidden" style={{ background: "#0b0b18", color: RT.text }}>
        {/* One line: series, race, event, then the live status (wraps on a phone). */}
        <section
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-1.5 pt-2.5 text-sm sm:px-6 sm:pt-3"
          role="status"
          aria-live="polite"
        >
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="self-center rounded border px-1.5 text-[11px] font-semibold tracking-[0.04em]" style={{ borderColor: RT.border, color: RT.text }}>
              WRL
            </span>
            <h1 className="m-0 text-xl font-semibold sm:text-2xl">{live?.sessionName ?? race.name}</h1>
            <span style={{ color: RT.soft }}>
              {[live?.eventName, live?.eventName?.includes(race.track) ? null : race.track].filter(Boolean).join(" · ")}
            </span>
          </span>
          <Link
            to="/live"
            className="flex items-center gap-2 font-semibold tracking-wider"
            style={{ color: live?.ended ? RT.muted : RT.live }}
            title="Positions are as of each completed lap and may change when results are official. The full race analysis follows after the finish."
          >
            {!live?.ended && <LiveDot />}
            {live?.ended ? "FINISHED" : "LIVE"}
          </Link>
          <span>
            Lap <b>{st?.leaderLap ?? data.maxLap}</b>
          </span>
          {flag && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: FLAG_COLORS[flag] ?? RT.muted }} aria-hidden />
              {flag}
            </span>
          )}
          <RaceClock run={st?.runningRaceTime} ttg={live?.ended ? null : st?.timeToGo} at={clockAt} frozen={!!live?.ended || flag === "Red" || flag === "Checkered"} />
          <span>{st?.carCount ?? Object.keys(data.cars).length} cars</span>
          <LeaderGapBadge data={data} focusNum={focusNum} flag={flag} drift={drift} />
          <span className="flex-1" />
          <span className="text-xs" style={{ color: delayed ? "#fab219" : RT.muted }}>
            {delayed ? "Timing feed delayed · " : ""}
            {saver ? <span title="Your phone is saving data, so this page checks every 30 seconds instead of every 5.">Data saver · </span> : null}
            checked {ago(checkedAt, now)}
          </span>
        </section>

        {/* The tabs, and (wider than a phone) the focus car and class picker on the same row. */}
        <div className="mt-0.5 flex shrink-0 flex-wrap items-stretch gap-x-4 border-b px-2 sm:px-6" style={{ borderColor: RT.line }}>
        <nav aria-label="Race views" className="no-scrollbar flex min-w-0 items-end gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-current={active ? "page" : undefined}
                disabled={t.locked}
                onClick={() => setTab(t.id)}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm disabled:opacity-60"
                style={{ color: active ? RT.text : RT.muted, fontWeight: active ? 600 : 400, borderBottom: `2px solid ${active ? RT.accent : "transparent"}`, marginBottom: -1 }}
              >
                {t.label}
                {t.locked && (
                  <span className="rounded px-1 text-[10px] font-semibold uppercase tracking-wider" style={{ background: RT.line, color: RT.muted }}>
                    Team
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div ref={setHeadSlot} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1.5 empty:hidden" />
        </div>

        <div className={tab !== "position" ? "hidden" : "flex flex-col md:min-h-0 md:flex-1"}>
          <LapChart
            data={data}
            annotations={annotations}
            watermarkEmail={user?.email}
            focusNum={focusNum}
            setFocusNum={setFocusNum}
            compSet={compSet}
            setCompSet={setCompSet}
            classView={classView}
            setClassView={setClassView}
            activeLap={activeLap}
            setActiveLap={setActiveLap}
            view={traceView}
            // Race time: every running car's trace reaches now. By lap, the leader's runs furthest
            // and each car's stops at its own lap count.
            defaultAxis="hours"
            live
            headSlot={tab === "position" ? headSlot : null}
          />
        </div>
        {tab === "map" && (
          <div className="flex flex-col md:min-h-0 md:flex-1">
            <TraceControls data={data} focusNum={focusNum} onFocus={setFocusNum} classView={classView} compSet={compSet} view={traceView} headSlot={headSlot} />
            <TrackMap slug={slug} data={data} focusNum={focusNum} setFocusNum={setFocusNum} compSet={compSet} classView={classView} />
          </div>
        )}
        {tab === "pitanalysis" && (
          <div className="custom-scroll px-2 py-3 sm:px-6 md:min-h-0 md:flex-1 md:overflow-y-auto">
            <PitAnalysisTab analysis={pitAnalysis} chart={data} focusNum={focusNum} setFocusNum={setFocusNum} onSwitchToTrace={() => setTab("position")} />
          </div>
        )}
        {tab === "laptimes" && (
          <div className="flex flex-col md:min-h-0 md:flex-1">
            <LapTimeChart
              data={data}
              annotations={annotations}
              watermarkEmail={user?.email}
              focusNum={focusNum}
              setFocusNum={handleFocusChange}
              compSet={compSet}
              classView={classView}
              activeLap={activeLap}
              setActiveLap={setActiveLap}
              view={traceView}
              live
              headSlot={headSlot}
            />
          </div>
        )}
      </div>
    </LiveClockContext.Provider>
    </LiveRaceContext.Provider>
  );
}
